/**
 * Grade de canais e ofertas das operadoras e streamings (onde assistir): em que plataforma e em que
 * plano está cada canal, e quais streamings vêm inclusos num plano.
 *
 * - A pesquisa (`lineups-research`, em services/ai-agents) grava tudo como `draft` por
 *   `upsertLineupDraft`, sempre com fonte; item sem fonte não entra.
 * - O painel aprova (`setLineupReviewStatus`). Item já revisado ou aprovado nunca volta a rascunho só
 *   por ser revisto: a mudança encontrada fica em `proposed_change` até alguém aprovar ou descartar.
 * - A operadora cliente só pede revisão pelo portal (`createLineupReviewRequest`); aceito com `apply`,
 *   o pedido vira dado oficial com a fonte "informado pela operadora".
 * - A leitura pública (`availabilityForChannels`) usa só o que está aprovado (padrão `minReview`).
 */
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  LINEUP_ACCESS,
  LINEUP_REQUEST_STATUSES,
  LINEUP_REVIEW_STATUSES,
  LINEUP_TARGET_TYPES,
  lineupReviewRequest,
  planChannel,
  planService,
  platform,
  platformPlan,
  PLATFORM_KINDS,
  tenant,
  type LineupAccess,
  type LineupProposedChange,
  type LineupRequestStatus,
  type LineupReviewStatus,
  type LineupSource,
  type LineupTargetType,
  type PlatformKind,
} from './schema/index.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

// ─── tipos ───────────────────────────────────────────────────────────────────────────────────────

export type LineupPlatform = typeof platform.$inferSelect;
export type LineupPlan = typeof platformPlan.$inferSelect;
export type LineupPlanChannel = typeof planChannel.$inferSelect;
export type LineupPlanService = typeof planService.$inferSelect;
export type LineupReviewRequest = typeof lineupReviewRequest.$inferSelect;

/** Item da grade: plataforma, plano ou vínculo plano × canal / plano × streaming. */
export type LineupTarget =
  | { type: 'platform'; id: string }
  | { type: 'plan'; id: string }
  | { type: 'plan_channel'; planId: string; channelId: string }
  | { type: 'plan_service'; planId: string; serviceId: string };

/** Nível mínimo de revisão de uma leitura (`rejected` nunca conta como nível). */
export type LineupMinReview = Exclude<LineupReviewStatus, 'rejected'>;

export interface LineupReadOptions {
  /** Padrão `approved` (o que a API pública mostra). O painel usa `draft`. */
  minReview?: LineupMinReview;
  /** Inclui os itens `rejected` (painel). */
  includeRejected?: boolean;
}

/** Fonte de entrada: URL (pesquisa) ou a fonte completa. */
export type LineupSourceInput = string | LineupSource;

export interface LineupChannelDraft {
  /** Id da biblioteca de emissoras (enrich.broadcaster.id). */
  channelId: string;
  access?: LineupAccess;
  sources: LineupSourceInput[];
}

export interface LineupServiceDraft {
  /** Id da biblioteca de emissoras (enrich.broadcaster.id) do streaming. */
  serviceId: string;
  access?: LineupAccess;
  sources: LineupSourceInput[];
}

export interface LineupPlanDraft {
  name: string;
  /** Padrão: `lineupSlug(name)`. */
  slug?: string;
  priceText?: string | null;
  url?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  sources: LineupSourceInput[];
  channels?: LineupChannelDraft[];
  services?: LineupServiceDraft[];
}

export interface LineupDraftInput {
  platform: {
    name: string;
    kind: PlatformKind;
    /** ISO2. */
    country: string;
    /** Padrão: `platformSlug(country, name)`. */
    slug?: string;
    website?: string | null;
    broadcasterId?: string | null;
    sources: LineupSourceInput[];
  };
  plans?: LineupPlanDraft[];
  /** Quando a pesquisa viu os dados (padrão: agora). */
  seenAt?: Date;
  /**
   * A entrada traz a grade inteira da plataforma (revisita): planos e vínculos gravados que não vieram
   * ficam com `proposed_change.removed` (nada é apagado; o painel decide).
   */
  complete?: boolean;
}

export interface LineupChange {
  target: LineupTarget;
  /** Campos que mudaram (ou `removed`). */
  fields: string[];
}

export interface LineupUpsertResult {
  platformId: string;
  /** slug do plano → id. */
  planIds: Record<string, string>;
  created: number;
  /** Rascunhos atualizados com dados novos. */
  updated: number;
  /** Só a fonte e o `seen_at` renovados. */
  unchanged: number;
  /** Itens sem fonte (ou plano sem nome): não entram. */
  skipped: number;
  /** Itens marcados como não vistos na revisita (`complete`). */
  removed: number;
  /** Mudanças em itens revisados/aprovados, guardadas em `proposed_change`. */
  changes: LineupChange[];
}

/** Campos que um pedido de revisão (ou uma mudança pendente) pode propor, por tipo de item. */
export interface LineupProposal {
  name?: string;
  website?: string | null;
  kind?: PlatformKind;
  priceText?: string | null;
  url?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  access?: LineupAccess;
  /** Tirar o item da grade (plano: encerra a vigência hoje; vínculo: apaga). */
  removed?: boolean;
}

export interface ChannelAvailabilityPlan {
  plan: LineupPlan;
  /** Canais pedidos que estão no plano. */
  viaChannels: { channelId: string; access: LineupAccess }[];
  /** Streamings pedidos que o plano inclui (ou o próprio streaming, quando a plataforma é ele). */
  services: { serviceId: string; access: LineupAccess }[];
}

export interface ChannelAvailability {
  platform: LineupPlatform;
  plans: ChannelAvailabilityPlan[];
}

export interface AvailabilityOptions extends LineupReadOptions {
  /** Ids da biblioteca de emissoras (os canais/streamings que transmitem o jogo). */
  channelIds: string[];
  /** ISO2. */
  country: string;
  /** Só esta plataforma (cliente operadora que não mostra as outras). */
  onlyPlatformId?: string | null;
  /**
   * Inclui os planos que dão acesso por um streaming incluso (plano × serviço) e as plataformas de
   * streaming que são o próprio serviço pedido. Padrão: true.
   */
  includeStreaming?: boolean;
  /** Data de vigência dos planos (padrão: hoje, UTC). */
  at?: Date;
}

export interface PlatformLineup {
  platform: LineupPlatform;
  plans: { plan: LineupPlan; channels: LineupPlanChannel[]; services: LineupPlanService[] }[];
}

export interface TenantOperator {
  tenantId: string;
  platformId: string | null;
  showOtherOperators: boolean;
  emailDomains: string[];
  platform: LineupPlatform | null;
}

export type LineupErrorCode =
  | 'invalid_input'
  | 'target_not_found'
  | 'forbidden_target'
  | 'request_not_found'
  | 'already_resolved'
  | 'tenant_not_found';

export class LineupError extends Error {
  constructor(
    readonly code: LineupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LineupError';
  }
}

/** Rótulo da fonte do dado informado pela operadora. */
export const OPERATOR_SOURCE_NOTE = 'informado pela operadora';
/** Fontes guardadas por item (as mais recentes). */
export const MAX_LINEUP_SOURCES = 10;

// ─── utilitários ─────────────────────────────────────────────────────────────────────────────────

/** Nome → slug (sem acento, minúsculas, `+` = "plus", hífens). */
export function lineupSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** Slug da plataforma: `<iso2>-<nome>`. */
export function platformSlug(country: string, name: string): string {
  return `${country.trim().toLowerCase()}-${lineupSlug(name)}`;
}

/** `target_id` do pedido de revisão. */
export function lineupTargetId(target: LineupTarget): string {
  switch (target.type) {
    case 'platform':
    case 'plan':
      return target.id;
    case 'plan_channel':
      return `${target.planId}:${target.channelId}`;
    case 'plan_service':
      return `${target.planId}:${target.serviceId}`;
  }
}

/** (target_type, target_id) → alvo. */
export function parseLineupTarget(type: string, id: string): LineupTarget {
  if (type === 'platform' || type === 'plan') return { type, id };
  if (type === 'plan_channel' || type === 'plan_service') {
    const i = id.indexOf(':');
    if (i <= 0 || i === id.length - 1) throw new LineupError('invalid_input', `target_id inválido: ${id}`);
    const planId = id.slice(0, i);
    const other = id.slice(i + 1);
    return type === 'plan_channel' ? { type, planId, channelId: other } : { type, planId, serviceId: other };
  }
  throw new LineupError('invalid_input', `target_type inválido: ${type}`);
}

/** Status aceitos numa leitura com `minReview`. */
export function reviewStatusesFor(opts: LineupReadOptions = {}): LineupReviewStatus[] {
  const min = opts.minReview ?? 'approved';
  const levels: LineupMinReview[] = ['draft', 'reviewed', 'approved'];
  const i = levels.indexOf(min);
  if (i < 0) throw new LineupError('invalid_input', `minReview inválido: ${String(min)}`);
  const out: LineupReviewStatus[] = levels.slice(i);
  if (opts.includeRejected) out.push('rejected');
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO2_RE = /^[A-Z]{2}$/;

const isUuid = (v: string) => UUID_RE.test(v);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

function normalizeCountry(country: string): string {
  const c = country.trim().toUpperCase();
  if (!ISO2_RE.test(c)) throw new LineupError('invalid_input', `País inválido: ${country}`);
  return c;
}

function cleanText(v: string | null | undefined, max: number): string | null {
  if (v === null || v === undefined) return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

function cleanUrl(v: string | null | undefined): string | null {
  const t = cleanText(v, 1000);
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function cleanDay(v: string | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (!DAY_RE.test(v) || !Number.isFinite(Date.parse(v)))
    throw new LineupError('invalid_input', `Data inválida (YYYY-MM-DD): ${v}`);
  return v;
}

/** Fontes de entrada → fontes válidas (http(s) ou informadas sem URL com `kind`). */
export function normalizeSources(input: readonly LineupSourceInput[], seenAt: Date): LineupSource[] {
  const out: LineupSource[] = [];
  for (const s of input) {
    if (typeof s === 'string') {
      const url = cleanUrl(s);
      if (url) out.push({ url, seen_at: seenAt.toISOString(), kind: 'research' });
      continue;
    }
    const url = s.url === null ? null : cleanUrl(s.url);
    if (!url && !(s.url === null && s.kind && s.kind !== 'research')) continue;
    out.push({ ...s, url, seen_at: s.seen_at || seenAt.toISOString() });
  }
  return mergeSources([], out);
}

/** Junta fontes por URL (a mais recente vence) e guarda as `MAX_LINEUP_SOURCES` mais recentes. */
export function mergeSources(prev: readonly LineupSource[], next: readonly LineupSource[]): LineupSource[] {
  const key = (s: LineupSource) => s.url ?? `${s.kind ?? ''}:${s.request_id ?? s.note ?? ''}`;
  const byKey = new Map<string, LineupSource>();
  for (const s of [...prev, ...next]) {
    const k = key(s);
    const cur = byKey.get(k);
    if (!cur || cur.seen_at <= s.seen_at) byKey.set(k, cur ? { ...cur, ...s } : s);
  }
  return [...byKey.values()]
    .sort((a, b) => (a.seen_at < b.seen_at ? 1 : a.seen_at > b.seen_at ? -1 : 0))
    .slice(0, MAX_LINEUP_SOURCES);
}

/** Campos de `next` (definidos e não nulos) que diferem de `cur`. */
function diffFields<T extends Record<string, unknown>>(cur: T, next: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(next) as [keyof T, T[keyof T]][]) {
    if (v === undefined || v === null) continue;
    if (cur[k] !== v) out[k] = v;
  }
  return out;
}

const PROPOSAL_KEYS: Record<LineupTargetType, (keyof LineupProposal)[]> = {
  platform: ['name', 'website', 'kind'],
  plan: ['name', 'priceText', 'url', 'validFrom', 'validTo', 'removed'],
  plan_channel: ['access', 'removed'],
  plan_service: ['access', 'removed'],
};

/** Mantém só os campos válidos para o tipo de item, já normalizados. */
export function sanitizeProposal(type: LineupTargetType, raw: unknown): LineupProposal {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw new LineupError('invalid_input', 'proposed precisa ser um objeto.');
  const src = raw as Record<string, unknown>;
  const out: LineupProposal = {};
  for (const k of PROPOSAL_KEYS[type]) {
    if (!(k in src) || src[k] === undefined) continue;
    const v = src[k];
    switch (k) {
      case 'name': {
        const t = typeof v === 'string' ? cleanText(v, 160) : null;
        if (!t) throw new LineupError('invalid_input', 'name vazio.');
        out.name = t;
        break;
      }
      case 'website':
      case 'url': {
        if (v !== null && typeof v !== 'string') throw new LineupError('invalid_input', `${k} inválido.`);
        const u = v === null ? null : cleanUrl(v);
        if (v !== null && !u) throw new LineupError('invalid_input', `${k} precisa ser uma URL http(s).`);
        out[k] = u;
        break;
      }
      case 'kind':
        if (!PLATFORM_KINDS.includes(v as PlatformKind))
          throw new LineupError('invalid_input', `kind inválido: ${String(v)}`);
        out.kind = v as PlatformKind;
        break;
      case 'priceText':
        if (v !== null && typeof v !== 'string')
          throw new LineupError('invalid_input', 'priceText inválido.');
        out.priceText = v === null ? null : cleanText(v, 120);
        break;
      case 'validFrom':
      case 'validTo':
        if (v !== null && typeof v !== 'string') throw new LineupError('invalid_input', `${k} inválido.`);
        out[k] = cleanDay(v as string | null);
        break;
      case 'access':
        if (!LINEUP_ACCESS.includes(v as LineupAccess))
          throw new LineupError('invalid_input', `access inválido: ${String(v)}`);
        out.access = v as LineupAccess;
        break;
      case 'removed':
        if (typeof v !== 'boolean') throw new LineupError('invalid_input', 'removed precisa ser booleano.');
        if (v) out.removed = true;
        break;
    }
  }
  return out;
}

// ─── leitura ─────────────────────────────────────────────────────────────────────────────────────

const KIND_ORDER: Record<PlatformKind, number> = {
  pay_tv_operator: 0,
  vmvpd: 1,
  telco_bundle: 2,
  streaming: 3,
};

const byPlatform = (a: LineupPlatform, b: LineupPlatform) =>
  KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, 'pt-BR');
const byPlan = (a: LineupPlan, b: LineupPlan) => a.name.localeCompare(b.name, 'pt-BR');

/** Plano vigente na data (YYYY-MM-DD). */
function planCurrentAt(day: string): SQL {
  return sql`(${platformPlan.validFrom} is null or ${platformPlan.validFrom} <= ${day}) and (${platformPlan.validTo} is null or ${platformPlan.validTo} >= ${day})`;
}

/** Plataformas (de um país e/ou tipo), por tipo e nome. */
export async function listPlatforms(
  db: Database,
  opts: LineupReadOptions & { country?: string; kind?: PlatformKind } = {},
): Promise<LineupPlatform[]> {
  const where: SQL[] = [inArray(platform.reviewStatus, reviewStatusesFor(opts))];
  if (opts.country) where.push(eq(platform.country, normalizeCountry(opts.country)));
  if (opts.kind) where.push(eq(platform.kind, opts.kind));
  const rows = await db
    .select()
    .from(platform)
    .where(and(...where))
    .orderBy(asc(platform.country), asc(platform.name));
  return rows.sort((a, b) => a.country.localeCompare(b.country) || byPlatform(a, b));
}

/**
 * Plataforma com os planos (todos, inclusive fora de vigência), canais e serviços, filtrados pelo
 * nível de revisão. null se a plataforma não existe ou está abaixo do nível.
 */
export async function getPlatformLineup(
  db: Database,
  platformId: string,
  opts: LineupReadOptions = {},
): Promise<PlatformLineup | null> {
  if (!isUuid(platformId)) return null;
  const statuses = reviewStatusesFor(opts);
  const [p] = await db
    .select()
    .from(platform)
    .where(and(eq(platform.id, platformId), inArray(platform.reviewStatus, statuses)));
  if (!p) return null;
  const plans = await db
    .select()
    .from(platformPlan)
    .where(and(eq(platformPlan.platformId, platformId), inArray(platformPlan.reviewStatus, statuses)));
  const ids = plans.map((pl) => pl.id);
  const [channels, services] = ids.length
    ? await Promise.all([
        db
          .select()
          .from(planChannel)
          .where(and(inArray(planChannel.planId, ids), inArray(planChannel.reviewStatus, statuses)))
          .orderBy(asc(planChannel.channelId)),
        db
          .select()
          .from(planService)
          .where(and(inArray(planService.planId, ids), inArray(planService.reviewStatus, statuses)))
          .orderBy(asc(planService.serviceId)),
      ])
    : [[], []];
  return {
    platform: p,
    plans: plans.sort(byPlan).map((plan) => ({
      plan,
      channels: channels.filter((c) => c.planId === plan.id),
      services: services.filter((s) => s.planId === plan.id),
    })),
  };
}

/**
 * Onde estão os canais de um jogo: plataformas do país cujos planos vigentes têm algum dos canais
 * (e, com `includeStreaming`, algum dos streamings inclusos, ou que são o próprio streaming). Plataforma,
 * plano e vínculo precisam estar no nível de revisão pedido (padrão: aprovado).
 */
export async function availabilityForChannels(
  db: Database,
  opts: AvailabilityOptions,
): Promise<ChannelAvailability[]> {
  const ids = [...new Set(opts.channelIds.filter(Boolean))];
  if (!ids.length) return [];
  const country = normalizeCountry(opts.country);
  const statuses = reviewStatusesFor(opts);
  const day = dayOf(opts.at ?? new Date());
  const includeStreaming = opts.includeStreaming ?? true;
  if (opts.onlyPlatformId !== undefined && opts.onlyPlatformId !== null && !isUuid(opts.onlyPlatformId))
    return [];
  const platformWhere = (): SQL[] => {
    const w: SQL[] = [eq(platform.country, country), inArray(platform.reviewStatus, statuses)];
    if (opts.onlyPlatformId) w.push(eq(platform.id, opts.onlyPlatformId));
    return w;
  };
  const planWhere = (): SQL[] => [inArray(platformPlan.reviewStatus, statuses), planCurrentAt(day)];

  const viaChannel = await db
    .select({ platform, plan: platformPlan, channelId: planChannel.channelId, access: planChannel.access })
    .from(planChannel)
    .innerJoin(platformPlan, eq(platformPlan.id, planChannel.planId))
    .innerJoin(platform, eq(platform.id, platformPlan.platformId))
    .where(
      and(
        inArray(planChannel.channelId, ids),
        inArray(planChannel.reviewStatus, statuses),
        ...planWhere(),
        ...platformWhere(),
      ),
    );
  const viaService = includeStreaming
    ? await db
        .select({
          platform,
          plan: platformPlan,
          serviceId: planService.serviceId,
          access: planService.access,
        })
        .from(planService)
        .innerJoin(platformPlan, eq(platformPlan.id, planService.planId))
        .innerJoin(platform, eq(platform.id, platformPlan.platformId))
        .where(
          and(
            inArray(planService.serviceId, ids),
            inArray(planService.reviewStatus, statuses),
            ...planWhere(),
            ...platformWhere(),
          ),
        )
    : [];
  const selfStreaming = includeStreaming
    ? await db
        .select()
        .from(platform)
        .where(and(eq(platform.kind, 'streaming'), inArray(platform.broadcasterId, ids), ...platformWhere()))
    : [];
  const selfPlans = selfStreaming.length
    ? await db
        .select()
        .from(platformPlan)
        .where(
          and(
            inArray(
              platformPlan.platformId,
              selfStreaming.map((p) => p.id),
            ),
            ...planWhere(),
          ),
        )
    : [];

  const order = new Map(ids.map((id, i) => [id, i]));
  const out = new Map<string, { platform: LineupPlatform; plans: Map<string, ChannelAvailabilityPlan> }>();
  const entry = (p: LineupPlatform) => {
    let e = out.get(p.id);
    if (!e) out.set(p.id, (e = { platform: p, plans: new Map() }));
    return e;
  };
  const planEntry = (p: LineupPlatform, plan: LineupPlan) => {
    const e = entry(p);
    let pe = e.plans.get(plan.id);
    if (!pe) e.plans.set(plan.id, (pe = { plan, viaChannels: [], services: [] }));
    return pe;
  };
  for (const r of viaChannel)
    planEntry(r.platform, r.plan).viaChannels.push({ channelId: r.channelId, access: r.access });
  for (const r of viaService)
    planEntry(r.platform, r.plan).services.push({ serviceId: r.serviceId, access: r.access });
  for (const p of selfStreaming) {
    entry(p);
    for (const plan of selfPlans.filter((pl) => pl.platformId === p.id)) {
      const pe = planEntry(p, plan);
      if (!pe.services.some((s) => s.serviceId === p.broadcasterId))
        pe.services.push({ serviceId: p.broadcasterId!, access: 'included' });
    }
  }
  const rank = (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...out.values()]
    .map((e) => ({
      platform: e.platform,
      plans: [...e.plans.values()]
        .map((pe) => ({
          plan: pe.plan,
          viaChannels: pe.viaChannels.sort((a, b) => rank(a.channelId) - rank(b.channelId)),
          services: pe.services.sort((a, b) => rank(a.serviceId) - rank(b.serviceId)),
        }))
        .sort((a, b) => byPlan(a.plan, b.plan)),
    }))
    .sort((a, b) => byPlatform(a.platform, b.platform));
}

// ─── gravação da pesquisa ────────────────────────────────────────────────────────────────────────

interface UpsertCtx {
  tx: Tx;
  now: Date;
  seenAt: Date;
  result: LineupUpsertResult;
}

/**
 * Decide o que fazer com um item já gravado visto de novo pela pesquisa: rascunho recebe os dados
 * novos; revisado/aprovado só guarda a mudança em `proposed_change`; rejeitado só renova a fonte.
 */
function reconcile<T extends Record<string, unknown>>(
  ctx: UpsertCtx,
  target: LineupTarget,
  cur: T & {
    reviewStatus: LineupReviewStatus;
    sources: LineupSource[];
    proposedChange: LineupProposedChange | null;
  },
  next: Partial<T>,
  sources: LineupSource[],
): Record<string, unknown> {
  const merged = mergeSources(cur.sources, sources);
  const diff = diffFields(cur, next);
  const keys = Object.keys(diff);
  const set: Record<string, unknown> = { sources: merged, seenAt: ctx.seenAt, updatedAt: ctx.now };
  const pending = cur.proposedChange;
  if (cur.reviewStatus === 'draft') {
    Object.assign(set, diff);
    set.proposedChange = null;
    if (keys.length) ctx.result.updated++;
    else ctx.result.unchanged++;
  } else if (cur.reviewStatus === 'rejected') {
    ctx.result.unchanged++;
  } else if (keys.length) {
    set.proposedChange = { ...diff, seen_at: ctx.seenAt.toISOString() };
    ctx.result.changes.push({ target, fields: keys });
  } else {
    // visto de novo igual ao aprovado: a mudança pendente (ou o "não visto") perde o sentido
    if (pending) set.proposedChange = null;
    ctx.result.unchanged++;
  }
  return set;
}

async function markRemoved(
  ctx: UpsertCtx,
  target: LineupTarget,
  row: { reviewStatus: LineupReviewStatus; proposedChange: LineupProposedChange | null },
): Promise<void> {
  if (row.reviewStatus === 'rejected' || row.proposedChange?.removed) return;
  const change: LineupProposedChange = { removed: true, seen_at: ctx.seenAt.toISOString() };
  const set = { proposedChange: change, updatedAt: ctx.now };
  if (target.type === 'plan')
    await ctx.tx.update(platformPlan).set(set).where(eq(platformPlan.id, target.id));
  else if (target.type === 'plan_channel')
    await ctx.tx
      .update(planChannel)
      .set(set)
      .where(and(eq(planChannel.planId, target.planId), eq(planChannel.channelId, target.channelId)));
  else if (target.type === 'plan_service')
    await ctx.tx
      .update(planService)
      .set(set)
      .where(and(eq(planService.planId, target.planId), eq(planService.serviceId, target.serviceId)));
  ctx.result.removed++;
  ctx.result.changes.push({ target, fields: ['removed'] });
}

async function upsertLink(
  ctx: UpsertCtx,
  kind: 'channel' | 'service',
  planId: string,
  refId: string,
  access: LineupAccess,
  sources: LineupSource[],
): Promise<void> {
  const table = kind === 'channel' ? planChannel : planService;
  const refCol = kind === 'channel' ? planChannel.channelId : planService.serviceId;
  const planCol = kind === 'channel' ? planChannel.planId : planService.planId;
  const target: LineupTarget =
    kind === 'channel'
      ? { type: 'plan_channel', planId, channelId: refId }
      : { type: 'plan_service', planId, serviceId: refId };
  const [cur] = await ctx.tx
    .select()
    .from(table)
    .where(and(eq(planCol, planId), eq(refCol, refId)));
  if (!cur) {
    const base = { planId, access, sources, seenAt: ctx.seenAt, reviewStatus: 'draft' as const };
    if (kind === 'channel') await ctx.tx.insert(planChannel).values({ ...base, channelId: refId });
    else await ctx.tx.insert(planService).values({ ...base, serviceId: refId });
    ctx.result.created++;
    return;
  }
  const set = reconcile(ctx, target, cur, { access }, sources);
  await ctx.tx
    .update(table)
    .set(set)
    .where(and(eq(planCol, planId), eq(refCol, refId)));
}

/**
 * Grava (ou revê) a grade de uma plataforma vinda da pesquisa. Idempotente por slug e país: rodar de
 * novo com os mesmos dados só renova a fonte e o `seen_at`. Item novo entra como `draft`; item
 * revisado/aprovado nunca volta a rascunho (a mudança fica em `proposed_change`); item rejeitado
 * continua rejeitado. Item sem fonte não entra.
 */
export async function upsertLineupDraft(db: Database, input: LineupDraftInput): Promise<LineupUpsertResult> {
  const now = new Date();
  const seenAt = input.seenAt ?? now;
  const country = normalizeCountry(input.platform.country);
  const name = cleanText(input.platform.name, 160);
  if (!name) throw new LineupError('invalid_input', 'Plataforma sem nome.');
  if (!PLATFORM_KINDS.includes(input.platform.kind))
    throw new LineupError('invalid_input', `kind inválido: ${String(input.platform.kind)}`);
  const slug = input.platform.slug ? lineupSlug(input.platform.slug) : platformSlug(country, name);
  if (!slug) throw new LineupError('invalid_input', 'Slug da plataforma vazio.');
  const platformSources = normalizeSources(input.platform.sources, seenAt);
  if (!platformSources.length) throw new LineupError('invalid_input', `Plataforma sem fonte: ${slug}`);

  return db.transaction(async (tx) => {
    const result: LineupUpsertResult = {
      platformId: '',
      planIds: {},
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      removed: 0,
      changes: [],
    };
    const ctx: UpsertCtx = { tx, now, seenAt, result };
    const fields = {
      name,
      kind: input.platform.kind,
      website: cleanUrl(input.platform.website),
      broadcasterId: input.platform.broadcasterId?.trim() || null,
    };
    const [cur] = await tx.select().from(platform).where(eq(platform.slug, slug));
    let platformId: string;
    if (!cur) {
      const [row] = await tx
        .insert(platform)
        .values({ slug, country, ...fields, sources: platformSources, seenAt, reviewStatus: 'draft' })
        .returning({ id: platform.id });
      platformId = row!.id;
      result.created++;
    } else {
      if (cur.country !== country)
        throw new LineupError('invalid_input', `Slug ${slug} já existe em outro país (${cur.country}).`);
      platformId = cur.id;
      const set = reconcile(ctx, { type: 'platform', id: cur.id }, cur, fields, platformSources);
      await tx.update(platform).set(set).where(eq(platform.id, cur.id));
    }
    result.platformId = platformId;

    const seenPlans = new Set<string>();
    for (const p of input.plans ?? []) {
      const planName = cleanText(p.name, 160);
      const planSlug = planName ? lineupSlug(p.slug ?? planName) : '';
      const planSources = normalizeSources(p.sources, seenAt);
      if (!planName || !planSlug || !planSources.length || seenPlans.has(planSlug)) {
        result.skipped++;
        continue;
      }
      seenPlans.add(planSlug);
      const planFields = {
        name: planName,
        priceText: cleanText(p.priceText, 120),
        url: cleanUrl(p.url),
        validFrom: cleanDay(p.validFrom),
        validTo: cleanDay(p.validTo),
      };
      const [curPlan] = await tx
        .select()
        .from(platformPlan)
        .where(and(eq(platformPlan.platformId, platformId), eq(platformPlan.slug, planSlug)));
      let planId: string;
      if (!curPlan) {
        const [row] = await tx
          .insert(platformPlan)
          .values({
            platformId,
            slug: planSlug,
            country,
            ...planFields,
            sources: planSources,
            seenAt,
            reviewStatus: 'draft',
          })
          .returning({ id: platformPlan.id });
        planId = row!.id;
        result.created++;
      } else {
        planId = curPlan.id;
        const set = reconcile(ctx, { type: 'plan', id: planId }, curPlan, planFields, planSources);
        await tx.update(platformPlan).set(set).where(eq(platformPlan.id, planId));
      }
      result.planIds[planSlug] = planId;

      const seenChannels = new Set<string>();
      for (const c of p.channels ?? []) {
        const id = c.channelId?.trim();
        const sources = normalizeSources(c.sources, seenAt);
        if (!id || !sources.length || seenChannels.has(id)) {
          result.skipped++;
          continue;
        }
        seenChannels.add(id);
        await upsertLink(ctx, 'channel', planId, id, c.access ?? 'included', sources);
      }
      const seenServices = new Set<string>();
      for (const s of p.services ?? []) {
        const id = s.serviceId?.trim();
        const sources = normalizeSources(s.sources, seenAt);
        if (!id || !sources.length || seenServices.has(id)) {
          result.skipped++;
          continue;
        }
        seenServices.add(id);
        await upsertLink(ctx, 'service', planId, id, s.access ?? 'included', sources);
      }
      if (input.complete && curPlan) {
        const links = await tx.select().from(planChannel).where(eq(planChannel.planId, planId));
        for (const l of links.filter((l) => !seenChannels.has(l.channelId)))
          await markRemoved(ctx, { type: 'plan_channel', planId, channelId: l.channelId }, l);
        const svcs = await tx.select().from(planService).where(eq(planService.planId, planId));
        for (const l of svcs.filter((l) => !seenServices.has(l.serviceId)))
          await markRemoved(ctx, { type: 'plan_service', planId, serviceId: l.serviceId }, l);
      }
    }
    if (input.complete && cur) {
      const today = dayOf(seenAt);
      const plans = await tx.select().from(platformPlan).where(eq(platformPlan.platformId, platformId));
      for (const pl of plans.filter((pl) => !seenPlans.has(pl.slug) && !(pl.validTo && pl.validTo < today)))
        await markRemoved(ctx, { type: 'plan', id: pl.id }, pl);
    }
    return result;
  });
}

// ─── revisão no painel ───────────────────────────────────────────────────────────────────────────

/** Aplica campos oficiais a um item (pedido aceito ou mudança pendente aprovada). */
async function applyToTarget(
  tx: Tx,
  target: LineupTarget,
  proposal: LineupProposal,
  opts: { by: string; now: Date; source?: LineupSource; status: LineupReviewStatus },
): Promise<boolean> {
  const { by, now, status } = opts;
  const review = {
    reviewStatus: status,
    reviewedBy: by,
    reviewedAt: now,
    proposedChange: null,
    updatedAt: now,
  };
  const withSource = (prev: LineupSource[]) => (opts.source ? mergeSources(prev, [opts.source]) : prev);
  switch (target.type) {
    case 'platform': {
      if (!isUuid(target.id)) return false;
      const [cur] = await tx.select().from(platform).where(eq(platform.id, target.id));
      if (!cur) return false;
      const { name, website, kind } = proposal;
      await tx
        .update(platform)
        .set({
          ...review,
          ...(name !== undefined ? { name } : {}),
          ...(website !== undefined ? { website } : {}),
          ...(kind !== undefined ? { kind } : {}),
          sources: withSource(cur.sources),
          ...(opts.source ? { seenAt: now } : {}),
        })
        .where(eq(platform.id, cur.id));
      return true;
    }
    case 'plan': {
      if (!isUuid(target.id)) return false;
      const [cur] = await tx.select().from(platformPlan).where(eq(platformPlan.id, target.id));
      if (!cur) return false;
      const { name, priceText, url, validFrom, removed } = proposal;
      let { validTo } = proposal;
      if (removed && validTo === undefined)
        validTo = cur.validTo && cur.validTo < dayOf(now) ? cur.validTo : dayOf(now);
      await tx
        .update(platformPlan)
        .set({
          ...review,
          ...(name !== undefined ? { name } : {}),
          ...(priceText !== undefined ? { priceText } : {}),
          ...(url !== undefined ? { url } : {}),
          ...(validFrom !== undefined ? { validFrom } : {}),
          ...(validTo !== undefined ? { validTo } : {}),
          sources: withSource(cur.sources),
          ...(opts.source ? { seenAt: now } : {}),
        })
        .where(eq(platformPlan.id, cur.id));
      return true;
    }
    case 'plan_channel':
    case 'plan_service': {
      const isChannel = target.type === 'plan_channel';
      const refId = isChannel ? target.channelId : target.serviceId;
      if (!isUuid(target.planId) || !refId) return false;
      const table = isChannel ? planChannel : planService;
      const planCol = isChannel ? planChannel.planId : planService.planId;
      const refCol = isChannel ? planChannel.channelId : planService.serviceId;
      const where = and(eq(planCol, target.planId), eq(refCol, refId));
      const [cur] = await tx.select().from(table).where(where);
      if (proposal.removed) {
        if (cur) await tx.delete(table).where(where);
        return true;
      }
      if (!cur) {
        // vínculo novo (pedido da operadora): o plano precisa existir
        if (!opts.source) return false;
        const [plan] = await tx
          .select({ id: platformPlan.id })
          .from(platformPlan)
          .where(eq(platformPlan.id, target.planId));
        if (!plan) return false;
        const base = {
          planId: target.planId,
          access: proposal.access ?? ('included' as const),
          sources: [opts.source],
          seenAt: now,
          reviewStatus: status,
          reviewedBy: by,
          reviewedAt: now,
        };
        if (isChannel) await tx.insert(planChannel).values({ ...base, channelId: refId });
        else await tx.insert(planService).values({ ...base, serviceId: refId });
        return true;
      }
      await tx
        .update(table)
        .set({
          ...review,
          ...(proposal.access !== undefined ? { access: proposal.access } : {}),
          sources: withSource(cur.sources),
          ...(opts.source ? { seenAt: now } : {}),
        })
        .where(where);
      return true;
    }
  }
}

async function readTarget(
  tx: Tx,
  target: LineupTarget,
): Promise<{ reviewStatus: LineupReviewStatus; proposedChange: LineupProposedChange | null } | null> {
  const pick = { reviewStatus: platform.reviewStatus, proposedChange: platform.proposedChange };
  switch (target.type) {
    case 'platform':
      if (!isUuid(target.id)) return null;
      return (await tx.select(pick).from(platform).where(eq(platform.id, target.id)))[0] ?? null;
    case 'plan':
      if (!isUuid(target.id)) return null;
      return (
        (
          await tx
            .select({ reviewStatus: platformPlan.reviewStatus, proposedChange: platformPlan.proposedChange })
            .from(platformPlan)
            .where(eq(platformPlan.id, target.id))
        )[0] ?? null
      );
    case 'plan_channel':
      if (!isUuid(target.planId)) return null;
      return (
        (
          await tx
            .select({ reviewStatus: planChannel.reviewStatus, proposedChange: planChannel.proposedChange })
            .from(planChannel)
            .where(and(eq(planChannel.planId, target.planId), eq(planChannel.channelId, target.channelId)))
        )[0] ?? null
      );
    case 'plan_service':
      if (!isUuid(target.planId)) return null;
      return (
        (
          await tx
            .select({ reviewStatus: planService.reviewStatus, proposedChange: planService.proposedChange })
            .from(planService)
            .where(and(eq(planService.planId, target.planId), eq(planService.serviceId, target.serviceId)))
        )[0] ?? null
      );
  }
}

/** Converte a mudança pendente (chaves das colunas) nos campos da proposta. */
function pendingToProposal(type: LineupTargetType, change: LineupProposedChange): LineupProposal {
  const { seen_at: _seenAt, ...rest } = change;
  void _seenAt;
  return sanitizeProposal(type, rest);
}

/**
 * Muda o status de revisão de um item. Aprovar um item com mudança pendente (`proposed_change`)
 * aplica a mudança (`removed`: plano sai de vigência hoje, vínculo é apagado). Devolve false se o
 * item não existe.
 */
export async function setLineupReviewStatus(
  db: Database,
  target: LineupTarget,
  status: LineupReviewStatus,
  by: string,
): Promise<boolean> {
  if (!LINEUP_REVIEW_STATUSES.includes(status))
    throw new LineupError('invalid_input', `review_status inválido: ${String(status)}`);
  return db.transaction(async (tx) => {
    const cur = await readTarget(tx, target);
    if (!cur) return false;
    const now = new Date();
    if (status === 'approved' && cur.proposedChange)
      return applyToTarget(tx, target, pendingToProposal(target.type, cur.proposedChange), {
        by,
        now,
        status,
      });
    const set = { reviewStatus: status, reviewedBy: by, reviewedAt: now, updatedAt: now };
    switch (target.type) {
      case 'platform':
        await tx.update(platform).set(set).where(eq(platform.id, target.id));
        break;
      case 'plan':
        await tx.update(platformPlan).set(set).where(eq(platformPlan.id, target.id));
        break;
      case 'plan_channel':
        await tx
          .update(planChannel)
          .set(set)
          .where(and(eq(planChannel.planId, target.planId), eq(planChannel.channelId, target.channelId)));
        break;
      case 'plan_service':
        await tx
          .update(planService)
          .set(set)
          .where(and(eq(planService.planId, target.planId), eq(planService.serviceId, target.serviceId)));
        break;
    }
    return true;
  });
}

/** Descarta a mudança pendente de um item (o dado aprovado fica como está). */
export async function dismissLineupChange(db: Database, target: LineupTarget, by: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const cur = await readTarget(tx, target);
    if (!cur) return false;
    const now = new Date();
    const set = { proposedChange: null, reviewedBy: by, reviewedAt: now, updatedAt: now };
    switch (target.type) {
      case 'platform':
        await tx.update(platform).set(set).where(eq(platform.id, target.id));
        break;
      case 'plan':
        await tx.update(platformPlan).set(set).where(eq(platformPlan.id, target.id));
        break;
      case 'plan_channel':
        await tx
          .update(planChannel)
          .set(set)
          .where(and(eq(planChannel.planId, target.planId), eq(planChannel.channelId, target.channelId)));
        break;
      case 'plan_service':
        await tx
          .update(planService)
          .set(set)
          .where(and(eq(planService.planId, target.planId), eq(planService.serviceId, target.serviceId)));
        break;
    }
    return true;
  });
}

// ─── pedidos de revisão da operadora ─────────────────────────────────────────────────────────────

/** Plataforma dona do item (o vínculo pode ainda não existir; o plano, sim). null = item inexistente. */
export async function lineupTargetPlatformId(
  db: Database | Tx,
  target: LineupTarget,
): Promise<string | null> {
  const q = db as Database;
  if (target.type === 'platform') {
    if (!isUuid(target.id)) return null;
    const [r] = await q.select({ id: platform.id }).from(platform).where(eq(platform.id, target.id));
    return r?.id ?? null;
  }
  const planId = target.type === 'plan' ? target.id : target.planId;
  if (!isUuid(planId)) return null;
  const [r] = await q
    .select({ id: platformPlan.platformId })
    .from(platformPlan)
    .where(eq(platformPlan.id, planId));
  return r?.id ?? null;
}

export interface CreateLineupReviewRequestInput {
  tenantId: string;
  /** Usuário do portal (id do Better Auth). */
  userId: string;
  target: LineupTarget;
  message: string;
  /** Campos propostos (ver `LineupProposal`); os que não valem para o tipo de item são ignorados. */
  proposed?: LineupProposal | Record<string, unknown> | null;
  /**
   * Exige que o item seja da plataforma do tenant (`operator_platform_id`). Padrão: true — a
   * operadora só pede revisão da própria grade.
   */
  enforceOwnership?: boolean;
}

/** Abre um pedido de revisão da grade (portal da operadora). */
export async function createLineupReviewRequest(
  db: Database,
  input: CreateLineupReviewRequestInput,
): Promise<LineupReviewRequest> {
  const message = cleanText(input.message, 2000);
  if (!message) throw new LineupError('invalid_input', 'Mensagem vazia.');
  const userId = input.userId?.trim();
  if (!userId) throw new LineupError('invalid_input', 'userId vazio.');
  if (!isUuid(input.tenantId)) throw new LineupError('tenant_not_found', 'Tenant inexistente.');
  if (!LINEUP_TARGET_TYPES.includes(input.target.type))
    throw new LineupError('invalid_input', `target_type inválido: ${String(input.target.type)}`);
  const proposed = sanitizeProposal(input.target.type, input.proposed);
  const [t] = await db
    .select({ id: tenant.id, platformId: tenant.operatorPlatformId })
    .from(tenant)
    .where(eq(tenant.id, input.tenantId));
  if (!t) throw new LineupError('tenant_not_found', 'Tenant inexistente.');
  const owner = await lineupTargetPlatformId(db, input.target);
  if (!owner) throw new LineupError('target_not_found', 'Item da grade inexistente.');
  if ((input.enforceOwnership ?? true) && t.platformId !== owner)
    throw new LineupError('forbidden_target', 'O item não é da plataforma do cliente.');
  const [row] = await db
    .insert(lineupReviewRequest)
    .values({
      tenantId: input.tenantId,
      userId,
      targetType: input.target.type,
      targetId: lineupTargetId(input.target),
      message,
      proposed: Object.keys(proposed).length ? (proposed as Record<string, unknown>) : null,
    })
    .returning();
  return row!;
}

/** Pedidos de revisão, do mais novo para o mais antigo. */
export async function listLineupReviewRequests(
  db: Database,
  opts: { tenantId?: string; status?: LineupRequestStatus; limit?: number } = {},
): Promise<LineupReviewRequest[]> {
  const where: SQL[] = [];
  if (opts.tenantId) {
    if (!isUuid(opts.tenantId)) return [];
    where.push(eq(lineupReviewRequest.tenantId, opts.tenantId));
  }
  if (opts.status) {
    if (!LINEUP_REQUEST_STATUSES.includes(opts.status))
      throw new LineupError('invalid_input', `status inválido: ${String(opts.status)}`);
    where.push(eq(lineupReviewRequest.status, opts.status));
  }
  return db
    .select()
    .from(lineupReviewRequest)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(lineupReviewRequest.createdAt), desc(lineupReviewRequest.id))
    .limit(Math.min(Math.max(opts.limit ?? 200, 1), 1000));
}

export interface ResolveLineupReviewRequestInput {
  status: Exclude<LineupRequestStatus, 'open'>;
  note?: string | null;
  /** Quem resolveu (handle do painel). */
  by: string;
  /**
   * Com `accepted`, aplica o `proposed` como dado oficial (aprovado), com a fonte "informado pela
   * operadora". Sem `apply`, o pedido só é fechado (o painel corrige à mão).
   */
  apply?: boolean;
}

/** Fecha um pedido de revisão (e aplica a proposta, se pedido). */
export async function resolveLineupReviewRequest(
  db: Database,
  id: string,
  input: ResolveLineupReviewRequestInput,
): Promise<LineupReviewRequest> {
  if (input.status !== 'accepted' && input.status !== 'rejected')
    throw new LineupError('invalid_input', `status inválido: ${String(input.status)}`);
  const by = input.by?.trim();
  if (!by) throw new LineupError('invalid_input', 'by vazio.');
  if (!isUuid(id)) throw new LineupError('request_not_found', 'Pedido inexistente.');
  return db.transaction(async (tx) => {
    const [req] = await tx
      .select()
      .from(lineupReviewRequest)
      .where(eq(lineupReviewRequest.id, id))
      .for('update');
    if (!req) throw new LineupError('request_not_found', 'Pedido inexistente.');
    if (req.status !== 'open')
      throw new LineupError('already_resolved', `Pedido já resolvido (${req.status}).`);
    const now = new Date();
    if (input.status === 'accepted' && input.apply) {
      const target = parseLineupTarget(req.targetType, req.targetId);
      const proposal = sanitizeProposal(target.type, req.proposed);
      const source: LineupSource = {
        url: null,
        seen_at: now.toISOString(),
        kind: 'operator',
        note: OPERATOR_SOURCE_NOTE,
        request_id: req.id,
      };
      const ok = await applyToTarget(tx, target, proposal, { by, now, source, status: 'approved' });
      if (!ok) throw new LineupError('target_not_found', 'Item da grade inexistente.');
    }
    const [row] = await tx
      .update(lineupReviewRequest)
      .set({
        status: input.status,
        resolutionNote: cleanText(input.note, 2000),
        resolvedBy: by,
        resolvedAt: now,
      })
      .where(eq(lineupReviewRequest.id, id))
      .returning();
    return row!;
  });
}

// ─── cliente operadora ───────────────────────────────────────────────────────────────────────────

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Domínios de e-mail normalizados (minúsculas, sem @), sem repetição. */
export function normalizeEmailDomains(domains: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of domains) {
    const d = raw.trim().toLowerCase().replace(/^@+/, '').replace(/\.+$/, '');
    if (!d) continue;
    if (!DOMAIN_RE.test(d)) throw new LineupError('invalid_input', `Domínio de e-mail inválido: ${raw}`);
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

/**
 * Liga o tenant a uma plataforma da grade (cliente operadora). Campo ausente = mantém; `platformId`
 * null = desliga. Devolve o estado novo, ou null se o tenant não existe.
 */
export async function setTenantOperator(
  db: Database,
  tenantId: string,
  input: { platformId?: string | null; showOtherOperators?: boolean; emailDomains?: readonly string[] },
): Promise<TenantOperator | null> {
  if (!isUuid(tenantId)) return null;
  const set: Partial<typeof tenant.$inferInsert> = {};
  if (input.platformId !== undefined) {
    if (input.platformId !== null) {
      if (!isUuid(input.platformId)) throw new LineupError('target_not_found', 'Plataforma inexistente.');
      const [p] = await db
        .select({ id: platform.id })
        .from(platform)
        .where(eq(platform.id, input.platformId));
      if (!p) throw new LineupError('target_not_found', 'Plataforma inexistente.');
    }
    set.operatorPlatformId = input.platformId;
  }
  if (input.showOtherOperators !== undefined) set.showOtherOperators = input.showOtherOperators;
  if (input.emailDomains !== undefined) set.operatorEmailDomains = normalizeEmailDomains(input.emailDomains);
  if (Object.keys(set).length) {
    const rows = await db.update(tenant).set(set).where(eq(tenant.id, tenantId)).returning({ id: tenant.id });
    if (!rows.length) return null;
  }
  return getTenantOperator(db, tenantId);
}

/** Estado de operadora do tenant (plataforma ligada, se mostra as outras, domínios). null = tenant inexistente. */
export async function getTenantOperator(db: Database, tenantId: string): Promise<TenantOperator | null> {
  if (!isUuid(tenantId)) return null;
  const [t] = await db
    .select({
      id: tenant.id,
      platformId: tenant.operatorPlatformId,
      showOtherOperators: tenant.showOtherOperators,
      emailDomains: tenant.operatorEmailDomains,
    })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  if (!t) return null;
  const [p] = t.platformId ? await db.select().from(platform).where(eq(platform.id, t.platformId)) : [];
  return {
    tenantId: t.id,
    platformId: t.platformId,
    showOtherOperators: t.showOtherOperators,
    emailDomains: t.emailDomains,
    platform: p ?? null,
  };
}

/** Tenants cujo domínio de e-mail de operadora casa com o do e-mail (ligar usuário do portal). */
export async function findOperatorTenantsByEmail(db: Database, email: string): Promise<string[]> {
  const at = email.lastIndexOf('@');
  if (at < 0) return [];
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (!DOMAIN_RE.test(domain)) return [];
  const rows = await db
    .select({ id: tenant.id })
    .from(tenant)
    .where(sql`${domain} = any(${tenant.operatorEmailDomains})`);
  return rows.map((r) => r.id);
}
