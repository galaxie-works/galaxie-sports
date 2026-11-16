/**
 * Banco das Comunidades (épico #936, #939): escopo do cliente, Comunidades por Âncora, termos com versão, membros,
 * pedidos de entrada e convites. Toda consulta filtra por `tenant_id`; a chave composta do schema garante o resto.
 *
 * As regras puras (quem entra, o que o console grava) ficam em `@galaxie/engage` (`community.ts`). Este pacote não
 * depende dele: a entrada recebe a decisão como função (`decide`), chamada dentro da transação com os fatos frescos.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { tenantModuleLimit } from './schema/api.js';
import {
  communityAcceptance,
  communityCommunity,
  communityInvite,
  communityJoinRequest,
  communityMembership,
  communityScopeRule,
  communityTermsVersion,
  type CommunityAnchorType,
  type CommunityJoinMode,
  type CommunityMembershipState,
  type CommunityScopeKind,
  type CommunityState,
  type CommunityTermsBody,
} from './schema/community.js';
import { competition, event, eventParticipant, participant, person, season, sport } from './schema/core.js';
import { MODULE_LIMITS, isValidModuleLimit } from './engage-modules.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Db = Database | Tx;

export interface CommunityAnchor {
  anchorType: CommunityAnchorType;
  anchorId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CommunityError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid_target' | 'stale' | 'duplicate',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'CommunityError';
  }
}

// ---------------------------------------------------------------- escopo

export interface CommunityScopeRuleRow {
  id: string;
  kind: CommunityScopeKind;
  target: string;
  createdBy: string;
  createdAt: Date;
}

export async function listScopeRules(db: Db, tenantId: string): Promise<CommunityScopeRuleRow[]> {
  return db
    .select({
      id: communityScopeRule.id,
      kind: communityScopeRule.kind,
      target: communityScopeRule.target,
      createdBy: communityScopeRule.createdBy,
      createdAt: communityScopeRule.createdAt,
    })
    .from(communityScopeRule)
    .where(and(eq(communityScopeRule.tenantId, tenantId), isNull(communityScopeRule.removedAt)))
    .orderBy(asc(communityScopeRule.createdAt));
}

/** O alvo existe no `core`? (esporte pelo slug; os demais pelo id). */
async function targetExists(db: Db, kind: CommunityScopeKind, target: string): Promise<boolean> {
  if (kind === 'sport') {
    const [row] = await db.select({ x: sport.slug }).from(sport).where(eq(sport.slug, target)).limit(1);
    return Boolean(row);
  }
  if (!UUID.test(target)) return false;
  const table =
    kind === 'person' ? person : kind === 'participant' ? participant : (competition as typeof competition);
  const [row] = await db.select({ x: table.id }).from(table).where(eq(table.id, target)).limit(1);
  return Boolean(row);
}

/** Âncoras de uma regra. `competition_participants` lê os times e atletas dos jogos da temporada atual. */
async function anchorsOfRule(db: Db, kind: CommunityScopeKind, target: string): Promise<CommunityAnchor[]> {
  switch (kind) {
    case 'sport':
      return [{ anchorType: 'sport', anchorId: target }];
    case 'competition':
      return [{ anchorType: 'competition', anchorId: target }];
    case 'participant':
      return [{ anchorType: 'participant', anchorId: target }];
    case 'person':
      return [{ anchorType: 'person', anchorId: target }];
    case 'competition_participants': {
      // temporada atual; sem marcação de atual, a de ano mais alto
      const [s] = await db
        .select({ id: season.id })
        .from(season)
        .where(eq(season.competitionId, target))
        .orderBy(sql`${season.current} desc`, sql`${season.year} desc`)
        .limit(1);
      if (!s) return [];
      const rows = await db
        .selectDistinct({ id: eventParticipant.participantId })
        .from(eventParticipant)
        .innerJoin(event, eq(event.id, eventParticipant.eventId))
        .where(and(eq(event.competitionId, target), eq(event.seasonId, s.id)));
      return rows
        .map((r) => r.id)
        .sort()
        .map((id) => ({ anchorType: 'participant' as const, anchorId: id }));
    }
  }
}

/** Teto de Comunidades ativas do tenant (`communities.max_communities`): o valor gravado ou o padrão. */
export async function communityLimit(db: Db, tenantId: string): Promise<number> {
  const key = 'communities.max_communities' as const;
  const [row] = await db
    .select({ value: tenantModuleLimit.value })
    .from(tenantModuleLimit)
    .where(and(eq(tenantModuleLimit.tenantId, tenantId), eq(tenantModuleLimit.key, key)))
    .limit(1);
  return row && isValidModuleLimit(key, row.value) ? row.value : MODULE_LIMITS[key].default;
}

/**
 * O que o escopo pede contra as Comunidades que já existem: criar, arquivar (saiu do escopo) e reativar (voltou).
 * Suspensa pela Galaxie não volta nem sai por aqui. Criar respeita o teto do tenant, na ordem das regras.
 */
export function planScopeSync<A extends CommunityAnchor>(input: {
  wanted: readonly A[];
  existing: readonly { id: string; anchorType: string; anchorId: string; state: CommunityState }[];
  limit: number;
}): { create: A[]; archive: string[]; reactivate: string[]; overLimit: A[] } {
  const key = (a: { anchorType: string; anchorId: string }) => `${a.anchorType}:${a.anchorId}`;
  const wantedKeys = new Set(input.wanted.map(key));
  const byKey = new Map(input.existing.map((c) => [key(c), c]));
  const archive = input.existing
    .filter((c) => c.state === 'active' && !wantedKeys.has(key(c)))
    .map((c) => c.id);
  let active = input.existing.filter((c) => c.state === 'active' && wantedKeys.has(key(c))).length;
  const create: A[] = [];
  const reactivate: string[] = [];
  const overLimit: A[] = [];
  const seen = new Set<string>();
  for (const a of input.wanted) {
    const k = key(a);
    if (seen.has(k)) continue;
    seen.add(k);
    const cur = byKey.get(k);
    if (cur?.state === 'active' || cur?.state === 'suspended') continue;
    if (active >= input.limit) {
      overLimit.push(a);
      continue;
    }
    active += 1;
    if (cur) reactivate.push(cur.id);
    else create.push(a);
  }
  return { create, archive, reactivate, overLimit };
}

export interface CommunitySyncResult {
  created: number;
  archived: number;
  reactivated: number;
  /** Âncoras que ficaram de fora pelo teto do tenant. */
  overLimit: CommunityAnchor[];
}

/**
 * Recalcula as Comunidades do tenant a partir do escopo. Uma sincronização por tenant de cada vez (trava da
 * transação); a restrição única faz a repetição ser inofensiva.
 */
export async function syncCommunities(
  db: Database,
  tenantId: string,
  actor: string,
): Promise<CommunitySyncResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`community.sync:${tenantId}`}, 0))`);
    const rules = await listScopeRules(tx, tenantId);
    const wanted: CommunityAnchor[] = [];
    for (const r of rules) wanted.push(...(await anchorsOfRule(tx, r.kind, r.target)));
    const existing = await tx
      .select({
        id: communityCommunity.id,
        anchorType: communityCommunity.anchorType,
        anchorId: communityCommunity.anchorId,
        state: communityCommunity.state,
      })
      .from(communityCommunity)
      .where(eq(communityCommunity.tenantId, tenantId));
    const plan = planScopeSync({ wanted, existing, limit: await communityLimit(tx, tenantId) });
    const at = new Date();
    if (plan.create.length)
      await tx
        .insert(communityCommunity)
        .values(plan.create.map((a) => ({ tenantId, ...a, stateBy: actor, stateAt: at })))
        .onConflictDoNothing({
          target: [communityCommunity.tenantId, communityCommunity.anchorType, communityCommunity.anchorId],
        });
    const move = async (ids: string[], state: CommunityState) => {
      if (!ids.length) return;
      await tx
        .update(communityCommunity)
        .set({ state, stateBy: actor, stateAt: at })
        .where(and(eq(communityCommunity.tenantId, tenantId), inArray(communityCommunity.id, ids)));
    };
    await move(plan.archive, 'archived');
    await move(plan.reactivate, 'active');
    return {
      created: plan.create.length,
      archived: plan.archive.length,
      reactivated: plan.reactivate.length,
      overLimit: plan.overLimit,
    };
  });
}

/** Liga uma regra de escopo (repetir a mesma não duplica) e sincroniza. */
export async function addScopeRule(
  db: Database,
  input: { tenantId: string; kind: CommunityScopeKind; target: string; actor: string },
): Promise<CommunitySyncResult> {
  if (!(await targetExists(db, input.kind, input.target))) throw new CommunityError('invalid_target');
  await db
    .insert(communityScopeRule)
    .values({ tenantId: input.tenantId, kind: input.kind, target: input.target, createdBy: input.actor })
    .onConflictDoNothing();
  return syncCommunities(db, input.tenantId, input.actor);
}

/** Desliga uma regra de escopo e sincroniza (as Comunidades que só ela sustentava são arquivadas, sem apagar). */
export async function removeScopeRule(
  db: Database,
  input: { tenantId: string; ruleId: string; actor: string },
): Promise<CommunitySyncResult> {
  const done = await db
    .update(communityScopeRule)
    .set({ removedAt: new Date(), removedBy: input.actor })
    .where(
      and(
        eq(communityScopeRule.tenantId, input.tenantId),
        eq(communityScopeRule.id, input.ruleId),
        isNull(communityScopeRule.removedAt),
      ),
    )
    .returning({ id: communityScopeRule.id });
  if (!done.length) throw new CommunityError('not_found');
  return syncCommunities(db, input.tenantId, input.actor);
}

// ---------------------------------------------------------------- leitura

export interface CommunityRow {
  id: string;
  anchorType: CommunityAnchorType;
  anchorId: string;
  /** Nome da Âncora no idioma pedido (nome de competição e de time não se traduz). */
  name: string | null;
  /** Esporte da Âncora (slug). */
  sport: string | null;
  joinMode: CommunityJoinMode;
  memberPosts: boolean;
  chatEnabled: boolean;
  historyDays: number | null;
  state: CommunityState;
  termsVersion: number | null;
  version: number;
  members: number;
  createdAt: Date;
}

export interface CommunityFanView {
  membership: CommunityMembershipState | null;
  pendingRequest: boolean;
  /** Última versão dos termos que o Perfil aceitou. */
  acceptedTermsVersion: number | null;
}

const communityCols = {
  id: communityCommunity.id,
  anchorType: communityCommunity.anchorType,
  anchorId: communityCommunity.anchorId,
  joinMode: communityCommunity.joinMode,
  memberPosts: communityCommunity.memberPosts,
  chatEnabled: communityCommunity.chatEnabled,
  historyDays: communityCommunity.historyDays,
  state: communityCommunity.state,
  termsVersion: communityCommunity.termsVersion,
  version: communityCommunity.version,
  createdAt: communityCommunity.createdAt,
  members: sql<number>`(select count(*)::int from ${communityMembership} m
    where m.tenant_id = ${communityCommunity.tenantId} and m.community_id = ${communityCommunity.id}
      and m.state = 'active')`,
};

/** Nome e esporte de cada Âncora, em lote por tipo. */
async function anchorNames(
  db: Db,
  anchors: readonly CommunityAnchor[],
  locale: string,
): Promise<Map<string, { name: string | null; sport: string | null }>> {
  const out = new Map<string, { name: string | null; sport: string | null }>();
  const ids = (type: CommunityAnchorType) => [
    ...new Set(anchors.filter((a) => a.anchorType === type).map((a) => a.anchorId)),
  ];
  const uuids = (type: CommunityAnchorType) => ids(type).filter((id) => UUID.test(id));
  const sports = ids('sport');
  const pickI18n = (v: Record<string, string> | null | undefined): string | null => {
    if (!v) return null;
    const lang = locale.slice(0, 2);
    return (
      v[locale] ??
      Object.entries(v).find(([k]) => k.startsWith(lang))?.[1] ??
      v['en'] ??
      v['pt-BR'] ??
      Object.values(v)[0] ??
      null
    );
  };
  if (sports.length)
    for (const r of await db
      .select({ slug: sport.slug, name: sport.name })
      .from(sport)
      .where(inArray(sport.slug, sports)))
      out.set(`sport:${r.slug}`, { name: pickI18n(r.name as Record<string, string>), sport: r.slug });
  const comps = uuids('competition');
  if (comps.length)
    for (const r of await db
      .select({ id: competition.id, name: competition.name, sport: competition.sport })
      .from(competition)
      .where(inArray(competition.id, comps)))
      out.set(`competition:${r.id}`, { name: r.name, sport: r.sport });
  const parts = uuids('participant');
  if (parts.length)
    for (const r of await db
      .select({ id: participant.id, name: participant.name, sport: participant.sport })
      .from(participant)
      .where(inArray(participant.id, parts)))
      out.set(`participant:${r.id}`, { name: r.name, sport: r.sport });
  const people = uuids('person');
  if (people.length)
    for (const r of await db
      .select({ id: person.id, name: person.name })
      .from(person)
      .where(inArray(person.id, people)))
      out.set(`person:${r.id}`, { name: r.name, sport: null });
  return out;
}

type RawCommunity = Omit<CommunityRow, 'name' | 'sport'>;

async function withNames(db: Db, rows: RawCommunity[], locale: string): Promise<CommunityRow[]> {
  const names = await anchorNames(db, rows, locale);
  return rows
    .map((r) => ({ ...r, ...(names.get(`${r.anchorType}:${r.anchorId}`) ?? { name: null, sport: null }) }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', locale) || a.id.localeCompare(b.id));
}

/** Comunidades do tenant, em ordem alfabética do idioma. Sem `states`, todas. */
export async function listCommunities(
  db: Db,
  tenantId: string,
  opts: { states?: readonly CommunityState[]; locale?: string } = {},
): Promise<CommunityRow[]> {
  const rows = await db
    .select(communityCols)
    .from(communityCommunity)
    .where(
      and(
        eq(communityCommunity.tenantId, tenantId),
        opts.states?.length ? inArray(communityCommunity.state, [...opts.states]) : undefined,
      ),
    );
  return withNames(db, rows, opts.locale ?? 'pt-BR');
}

export async function readCommunity(
  db: Db,
  tenantId: string,
  id: string,
  locale = 'pt-BR',
): Promise<CommunityRow | null> {
  if (!UUID.test(id)) return null;
  const rows = await db
    .select(communityCols)
    .from(communityCommunity)
    .where(and(eq(communityCommunity.tenantId, tenantId), eq(communityCommunity.id, id)))
    .limit(1);
  return (await withNames(db, rows, locale))[0] ?? null;
}

/** O que o torcedor tem em cada Comunidade (vínculo, pedido aberto e último Aceite). */
export async function fanCommunityViews(
  db: Db,
  tenantId: string,
  profileId: string,
  communityIds: readonly string[],
): Promise<Map<string, CommunityFanView>> {
  const out = new Map<string, CommunityFanView>();
  if (!communityIds.length) return out;
  const ids = [...communityIds];
  for (const id of ids) out.set(id, { membership: null, pendingRequest: false, acceptedTermsVersion: null });
  const [members, requests, accepted] = await Promise.all([
    db
      .select({ id: communityMembership.communityId, state: communityMembership.state })
      .from(communityMembership)
      .where(
        and(
          eq(communityMembership.tenantId, tenantId),
          eq(communityMembership.profileId, profileId),
          inArray(communityMembership.communityId, ids),
        ),
      ),
    db
      .select({ id: communityJoinRequest.communityId })
      .from(communityJoinRequest)
      .where(
        and(
          eq(communityJoinRequest.tenantId, tenantId),
          eq(communityJoinRequest.profileId, profileId),
          eq(communityJoinRequest.state, 'pending'),
          inArray(communityJoinRequest.communityId, ids),
        ),
      ),
    db
      .select({
        id: communityAcceptance.communityId,
        version: sql<number>`max(${communityAcceptance.version})::int`,
      })
      .from(communityAcceptance)
      .where(
        and(
          eq(communityAcceptance.tenantId, tenantId),
          eq(communityAcceptance.profileId, profileId),
          inArray(communityAcceptance.communityId, ids),
        ),
      )
      .groupBy(communityAcceptance.communityId),
  ]);
  for (const m of members) out.get(m.id)!.membership = m.state;
  for (const r of requests) out.get(r.id)!.pendingRequest = true;
  for (const a of accepted) out.get(a.id)!.acceptedTermsVersion = a.version;
  return out;
}

export async function readTerms(
  db: Db,
  tenantId: string,
  communityId: string,
  version: number,
): Promise<{ version: number; body: CommunityTermsBody; publishedAt: Date } | null> {
  const [row] = await db
    .select({
      version: communityTermsVersion.version,
      body: communityTermsVersion.body,
      publishedAt: communityTermsVersion.publishedAt,
    })
    .from(communityTermsVersion)
    .where(
      and(
        eq(communityTermsVersion.tenantId, tenantId),
        eq(communityTermsVersion.communityId, communityId),
        eq(communityTermsVersion.version, version),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------- configuração (console e Galaxie)

export interface CommunityConfigPatch {
  joinMode?: CommunityJoinMode;
  memberPosts?: boolean;
  chatEnabled?: boolean;
  historyDays?: number | null;
}

/** Muda a configuração com versão otimista. Arquivada e suspensa também guardam (valem quando voltarem). */
export async function updateCommunityConfig(
  db: Database,
  input: { tenantId: string; id: string; expectedVersion: number; patch: CommunityConfigPatch },
): Promise<number> {
  const [row] = await db
    .update(communityCommunity)
    .set({ ...input.patch, version: sql`${communityCommunity.version} + 1` })
    .where(
      and(
        eq(communityCommunity.tenantId, input.tenantId),
        eq(communityCommunity.id, input.id),
        eq(communityCommunity.version, input.expectedVersion),
      ),
    )
    .returning({ version: communityCommunity.version });
  if (row) return row.version;
  const exists = await readCommunity(db, input.tenantId, input.id);
  throw new CommunityError(exists ? 'stale' : 'not_found');
}

/**
 * Suspende ou reativa (só a Galaxie). Reativar volta a `active` se a Âncora ainda está no escopo; senão, `archived`.
 */
export async function setCommunitySuspended(
  db: Database,
  input: { tenantId: string; id: string; suspended: boolean; actor: string },
): Promise<CommunityState> {
  const current = await readCommunity(db, input.tenantId, input.id);
  if (!current) throw new CommunityError('not_found');
  let state: CommunityState = 'suspended';
  if (!input.suspended) {
    const rules = await listScopeRules(db, input.tenantId);
    const wanted = new Set<string>();
    for (const r of rules)
      for (const a of await anchorsOfRule(db, r.kind, r.target)) wanted.add(`${a.anchorType}:${a.anchorId}`);
    state = wanted.has(`${current.anchorType}:${current.anchorId}`) ? 'active' : 'archived';
  }
  await db
    .update(communityCommunity)
    .set({ state, stateBy: input.actor, stateAt: new Date() })
    .where(and(eq(communityCommunity.tenantId, input.tenantId), eq(communityCommunity.id, input.id)));
  return state;
}

/** Publica uma versão nova dos termos e a põe em vigor. Membros aceitam de novo antes da próxima escrita. */
export async function publishTerms(
  db: Database,
  input: { tenantId: string; communityId: string; body: CommunityTermsBody; actor: string },
): Promise<number> {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({ termsVersion: communityCommunity.termsVersion })
      .from(communityCommunity)
      .where(
        and(eq(communityCommunity.tenantId, input.tenantId), eq(communityCommunity.id, input.communityId)),
      )
      .for('update');
    if (!c) throw new CommunityError('not_found');
    const [last] = await tx
      .select({ v: sql<number>`coalesce(max(${communityTermsVersion.version}), 0)::int` })
      .from(communityTermsVersion)
      .where(
        and(
          eq(communityTermsVersion.tenantId, input.tenantId),
          eq(communityTermsVersion.communityId, input.communityId),
        ),
      );
    const version = (last?.v ?? 0) + 1;
    await tx.insert(communityTermsVersion).values({
      tenantId: input.tenantId,
      communityId: input.communityId,
      version,
      body: input.body,
      publishedBy: input.actor,
    });
    await tx
      .update(communityCommunity)
      .set({ termsVersion: version })
      .where(
        and(eq(communityCommunity.tenantId, input.tenantId), eq(communityCommunity.id, input.communityId)),
      );
    return version;
  });
}

// ---------------------------------------------------------------- convites

export const hashInviteCode = (code: string) => createHash('sha256').update(code.trim()).digest('hex');

/** Cria um convite; o código sai só aqui (o banco guarda o hash). */
export async function createInvite(
  db: Database,
  input: {
    tenantId: string;
    communityId: string;
    actor: string;
    maxUses?: number | null;
    expiresAt?: Date | null;
  },
): Promise<{ id: string; code: string }> {
  const code = randomBytes(12).toString('base64url');
  const [row] = await db
    .insert(communityInvite)
    .values({
      tenantId: input.tenantId,
      communityId: input.communityId,
      codeHash: hashInviteCode(code),
      maxUses: input.maxUses ?? null,
      expiresAt: input.expiresAt ?? null,
      createdBy: input.actor,
    })
    .returning({ id: communityInvite.id });
  return { id: row!.id, code };
}

export async function revokeInvite(db: Database, tenantId: string, inviteId: string): Promise<boolean> {
  const rows = await db
    .update(communityInvite)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(communityInvite.tenantId, tenantId),
        eq(communityInvite.id, inviteId),
        isNull(communityInvite.revokedAt),
      ),
    )
    .returning({ id: communityInvite.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------- entrada e saída do torcedor

/** Os fatos que a decisão de entrada recebe (iguais aos de `decideJoin` de `@galaxie/engage`). */
export interface CommunityJoinFacts {
  community: { state: CommunityState; joinMode: CommunityJoinMode; termsVersion: number | null };
  membership: CommunityMembershipState | null;
  pendingRequest: boolean;
  acceptedTermsVersion: number | null;
  invite: { valid: boolean } | null;
}

export type CommunityJoinDecision =
  | { ok: true; result: 'joined' | 'already_member' | 'requested' | 'already_requested' }
  | { ok: false; refusal: string };

/**
 * Entrada do torcedor. Lê os fatos dentro da transação (trava a linha do vínculo), chama `decide` e grava: o Aceite
 * da versão em vigor, o vínculo, o pedido ou o uso do convite. `inviteUsable` diz se o convite achado vale agora.
 */
export async function joinCommunity(
  db: Database,
  input: {
    tenantId: string;
    communityId: string;
    profileId: string;
    acceptedTermsVersion: number | null;
    inviteCode: string | null;
    now: Date;
  },
  decide: (facts: CommunityJoinFacts) => CommunityJoinDecision,
  inviteUsable: (
    inv: { revokedAt: Date | null; expiresAt: Date | null; maxUses: number | null; uses: number },
    now: Date,
  ) => boolean,
): Promise<CommunityJoinDecision> {
  const { tenantId, communityId, profileId } = input;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`community.member:${tenantId}:${communityId}:${profileId}`}, 0))`,
    );
    const [c] = await tx
      .select({
        state: communityCommunity.state,
        joinMode: communityCommunity.joinMode,
        termsVersion: communityCommunity.termsVersion,
      })
      .from(communityCommunity)
      .where(and(eq(communityCommunity.tenantId, tenantId), eq(communityCommunity.id, communityId)))
      .limit(1);
    if (!c) throw new CommunityError('not_found');
    const view = (await fanCommunityViews(tx, tenantId, profileId, [communityId])).get(communityId)!;
    let invite: { id: string; valid: boolean } | null = null;
    if (input.inviteCode) {
      const [inv] = await tx
        .select({
          id: communityInvite.id,
          communityId: communityInvite.communityId,
          revokedAt: communityInvite.revokedAt,
          expiresAt: communityInvite.expiresAt,
          maxUses: communityInvite.maxUses,
          uses: communityInvite.uses,
        })
        .from(communityInvite)
        .where(
          and(
            eq(communityInvite.tenantId, tenantId),
            eq(communityInvite.codeHash, hashInviteCode(input.inviteCode)),
          ),
        )
        .for('update')
        .limit(1);
      invite = inv
        ? { id: inv.id, valid: inv.communityId === communityId && inviteUsable(inv, input.now) }
        : { id: '', valid: false };
    }
    // o Aceite que vale é o deste pedido ou um já gravado para a versão em vigor
    const accepted =
      input.acceptedTermsVersion ??
      (c.termsVersion !== null && view.acceptedTermsVersion === c.termsVersion ? c.termsVersion : null);
    const decision = decide({
      community: c,
      membership: view.membership,
      pendingRequest: view.pendingRequest,
      acceptedTermsVersion: accepted,
      invite: invite ? { valid: invite.valid } : null,
    });
    if (!decision.ok || decision.result === 'already_member' || decision.result === 'already_requested')
      return decision;
    if (c.termsVersion !== null)
      await tx
        .insert(communityAcceptance)
        .values({ tenantId, communityId, profileId, version: c.termsVersion, acceptedAt: input.now })
        .onConflictDoNothing();
    if (decision.result === 'requested') {
      await tx
        .insert(communityJoinRequest)
        .values({ tenantId, communityId, profileId, createdAt: input.now })
        .onConflictDoNothing();
      return decision;
    }
    await tx
      .insert(communityMembership)
      .values({ tenantId, communityId, profileId, state: 'active', joinedAt: input.now })
      .onConflictDoUpdate({
        target: [
          communityMembership.tenantId,
          communityMembership.communityId,
          communityMembership.profileId,
        ],
        set: { state: 'active', joinedAt: input.now, leftAt: null, removedBy: null },
      });
    if (invite?.valid)
      await tx
        .update(communityInvite)
        .set({ uses: sql`${communityInvite.uses} + 1` })
        .where(and(eq(communityInvite.tenantId, tenantId), eq(communityInvite.id, invite.id)));
    // entrou por outro caminho com pedido aberto: o pedido sai da fila
    await tx
      .update(communityJoinRequest)
      .set({ state: 'withdrawn', decidedAt: input.now, decidedBy: 'system' })
      .where(
        and(
          eq(communityJoinRequest.tenantId, tenantId),
          eq(communityJoinRequest.communityId, communityId),
          eq(communityJoinRequest.profileId, profileId),
          eq(communityJoinRequest.state, 'pending'),
        ),
      );
    return decision;
  });
}

/** Aceite de uma versão dos termos por um membro (versão nova publicada depois da entrada). */
export async function acceptTerms(
  db: Database,
  input: { tenantId: string; communityId: string; profileId: string; version: number; now: Date },
): Promise<boolean> {
  const terms = await readTerms(db, input.tenantId, input.communityId, input.version);
  if (!terms) return false;
  await db
    .insert(communityAcceptance)
    .values({
      tenantId: input.tenantId,
      communityId: input.communityId,
      profileId: input.profileId,
      version: input.version,
      acceptedAt: input.now,
    })
    .onConflictDoNothing();
  return true;
}

/** Saída do torcedor: o vínculo fica como `left`, e o pedido aberto, se houver, é retirado. */
export async function leaveCommunity(
  db: Database,
  input: { tenantId: string; communityId: string; profileId: string; now: Date },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const left = await tx
      .update(communityMembership)
      .set({ state: 'left', leftAt: input.now })
      .where(
        and(
          eq(communityMembership.tenantId, input.tenantId),
          eq(communityMembership.communityId, input.communityId),
          eq(communityMembership.profileId, input.profileId),
          eq(communityMembership.state, 'active'),
        ),
      )
      .returning({ id: communityMembership.profileId });
    const withdrawn = await tx
      .update(communityJoinRequest)
      .set({ state: 'withdrawn', decidedAt: input.now, decidedBy: 'fan' })
      .where(
        and(
          eq(communityJoinRequest.tenantId, input.tenantId),
          eq(communityJoinRequest.communityId, input.communityId),
          eq(communityJoinRequest.profileId, input.profileId),
          eq(communityJoinRequest.state, 'pending'),
        ),
      )
      .returning({ id: communityJoinRequest.id });
    return left.length + withdrawn.length > 0;
  });
}

// ---------------------------------------------------------------- fila de aprovação e membros (console)

export interface CommunityJoinRequestRow {
  id: string;
  profileId: string;
  createdAt: Date;
}

export async function listJoinRequests(
  db: Db,
  tenantId: string,
  communityId: string,
  limit = 100,
): Promise<CommunityJoinRequestRow[]> {
  return db
    .select({
      id: communityJoinRequest.id,
      profileId: communityJoinRequest.profileId,
      createdAt: communityJoinRequest.createdAt,
    })
    .from(communityJoinRequest)
    .where(
      and(
        eq(communityJoinRequest.tenantId, tenantId),
        eq(communityJoinRequest.communityId, communityId),
        eq(communityJoinRequest.state, 'pending'),
      ),
    )
    .orderBy(asc(communityJoinRequest.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}

/** Aprova ou recusa um pedido. Aprovar cria o vínculo (o Aceite já foi gravado no pedido). */
export async function decideJoinRequest(
  db: Database,
  input: { tenantId: string; requestId: string; approve: boolean; actor: string; now: Date },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [req] = await tx
      .update(communityJoinRequest)
      .set({ state: input.approve ? 'approved' : 'rejected', decidedAt: input.now, decidedBy: input.actor })
      .where(
        and(
          eq(communityJoinRequest.tenantId, input.tenantId),
          eq(communityJoinRequest.id, input.requestId),
          eq(communityJoinRequest.state, 'pending'),
        ),
      )
      .returning({
        communityId: communityJoinRequest.communityId,
        profileId: communityJoinRequest.profileId,
      });
    if (!req) return false;
    if (input.approve)
      await tx
        .insert(communityMembership)
        .values({ tenantId: input.tenantId, ...req, state: 'active', joinedAt: input.now })
        .onConflictDoUpdate({
          target: [
            communityMembership.tenantId,
            communityMembership.communityId,
            communityMembership.profileId,
          ],
          set: { state: 'active', joinedAt: input.now, leftAt: null, removedBy: null },
        });
    return true;
  });
}

/** A equipe tira um membro; ele só volta com convite. */
export async function removeMember(
  db: Database,
  input: { tenantId: string; communityId: string; profileId: string; actor: string; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(communityMembership)
    .set({ state: 'removed', leftAt: input.now, removedBy: input.actor })
    .where(
      and(
        eq(communityMembership.tenantId, input.tenantId),
        eq(communityMembership.communityId, input.communityId),
        eq(communityMembership.profileId, input.profileId),
        eq(communityMembership.state, 'active'),
      ),
    )
    .returning({ id: communityMembership.profileId });
  return rows.length > 0;
}
