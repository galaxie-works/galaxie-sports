/**
 * Antifraude da Gamificação (#934). Três sinais sem dado novo do torcedor (decisão do Wagner, 19/11), todos só
 * como alerta: nada é barrado sem uma pessoa revisar (`feedback-validador-sinaliza-humano-decide`).
 *
 * - `prediction_burst`: Perfis da mesma Conta palpitando o mesmo Palpite no mesmo jogo em segundos.
 * - `simultaneous_presence`: um Perfil com presença em muitos jogos ao mesmo tempo.
 * - `new_profiles_burst`: uma Conta com muitos Perfis novos ganhando Pontos no mesmo dia.
 *
 * Quem revisa (o cliente no painel dele ou a equipe Galaxie): descartar fecha o alerta; confirmar fecha e congela os
 * Perfis do alerta no programa (`game.profile_freeze`): eles não ganham Pontos, Conquistas nem Cartas novas até
 * alguém liberar. O que já têm fica. Cada passo vai para o registro de auditoria.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { appendGameAudit, type GameProgramKey } from './game.js';
import { gameFraudSignal, gameProfileFreeze } from './schema/game.js';

export const FRAUD_SIGNAL_KINDS = [
  'prediction_burst',
  'simultaneous_presence',
  'new_profiles_burst',
] as const;
export type FraudSignalKind = (typeof FRAUD_SIGNAL_KINDS)[number];

/** Limites dos sinais. Conservadores: um alerta a mais custa uma revisão; um a menos, nada é perdido. */
export const FRAUD_THRESHOLDS = {
  /** Perfis da mesma Conta com o mesmo Palpite no mesmo jogo, dentro da janela. */
  burstProfiles: 3,
  burstWindowSeconds: 60,
  /** Jogos diferentes com presença viva ao mesmo tempo. */
  simultaneousEvents: 3,
  /** Perfis novos (24 h) da mesma Conta que ganharam Pontos da Gamificação no dia. */
  newProfiles: 4,
} as const;

export interface FraudDetectResult {
  predictionBurst: number;
  simultaneousPresence: number;
  newProfilesBurst: number;
}

/**
 * Procura os três sinais na janela recente e grava os alertas novos (um por suspeita e dia, pelo `dedupe_key`). Barata
 * de propósito: cada consulta olha só a última hora (ou o último dia), pelos índices de tempo.
 */
export async function detectFraudSignals(
  db: Pick<Database, 'execute'>,
  now = new Date(),
): Promise<FraudDetectResult> {
  const day = now.toISOString().slice(0, 10);
  const t = FRAUD_THRESHOLDS;
  const burst = await db.execute<{ n: number }>(sql`
    with recent as (
      select p.tenant_id, p.program_country, p.event_id, p.kind, p.value, p.created_at, p.profile_id, f.account_id
        from game.prediction p
        join fan.profile f on f.tenant_id = p.tenant_id and f.id = p.profile_id
       where p.created_at > ${now}::timestamptz - interval '1 hour'
    ), grouped as (
      select tenant_id, program_country, account_id, event_id, kind, value,
             array_agg(distinct profile_id) as profiles, max(created_at) - min(created_at) as spread
        from recent
       group by tenant_id, program_country, account_id, event_id, kind, value
      having count(distinct profile_id) >= ${t.burstProfiles}
         and max(created_at) - min(created_at) <= make_interval(secs => ${t.burstWindowSeconds})
    ), ins as (
      insert into game.fraud_signal (tenant_id, program_country, account_id, kind, detail, dedupe_key)
      select tenant_id, program_country, account_id, 'prediction_burst',
             jsonb_build_object('event_id', event_id, 'prediction_kind', kind, 'profile_ids', to_jsonb(profiles),
                                'seconds', extract(epoch from spread)),
             'prediction_burst:' || account_id || ':' || event_id || ':' || ${day}
        from grouped
      on conflict (tenant_id, dedupe_key) do nothing
      returning 1
    )
    select count(*)::int as n from ins`);
  const presence = await db.execute<{ n: number }>(sql`
    with live as (
      select w.tenant_id, w.profile_id, count(distinct w.event_id) as events,
             array_agg(distinct w.event_id) as event_ids
        from fan.presence_window w
       where w.last_seen_at > ${now}::timestamptz - interval '10 minutes'
       group by w.tenant_id, w.profile_id
      having count(distinct w.event_id) >= ${t.simultaneousEvents}
    ), ins as (
      insert into game.fraud_signal (tenant_id, program_country, profile_id, account_id, kind, detail, dedupe_key)
      select l.tenant_id, g.program_country, l.profile_id, f.account_id, 'simultaneous_presence',
             jsonb_build_object('events', l.events, 'event_ids', to_jsonb(l.event_ids)),
             'simultaneous_presence:' || l.profile_id || ':' || ${day}
        from live l
        join fan.profile f on f.tenant_id = l.tenant_id and f.id = l.profile_id
        join game.program g on g.tenant_id = l.tenant_id and g.program_country = upper(f.country)
      on conflict (tenant_id, dedupe_key) do nothing
      returning 1
    )
    select count(*)::int as n from ins`);
  const fresh = await db.execute<{ n: number }>(sql`
    with scored as (
      select f.tenant_id, l.program_country, f.account_id, array_agg(distinct f.id) as profiles
        from fan.profile f
        join fan.points_ledger l on l.tenant_id = f.tenant_id and l.profile_id = f.id
       where f.created_at > ${now}::timestamptz - interval '24 hours'
         and f.deleted_at is null
         and l.source = 'gamification' and l.points_delta > 0
         and l.created_at > ${now}::timestamptz - interval '24 hours'
       group by f.tenant_id, l.program_country, f.account_id
      having count(distinct f.id) >= ${t.newProfiles}
    ), ins as (
      insert into game.fraud_signal (tenant_id, program_country, account_id, kind, detail, dedupe_key)
      select s.tenant_id, s.program_country, s.account_id, 'new_profiles_burst',
             jsonb_build_object('profile_ids', to_jsonb(s.profiles)),
             'new_profiles_burst:' || s.account_id || ':' || ${day}
        from scored s
        join game.program g on g.tenant_id = s.tenant_id and g.program_country = s.program_country
      on conflict (tenant_id, dedupe_key) do nothing
      returning 1
    )
    select count(*)::int as n from ins`);
  return {
    predictionBurst: burst[0]?.n ?? 0,
    simultaneousPresence: presence[0]?.n ?? 0,
    newProfilesBurst: fresh[0]?.n ?? 0,
  };
}

export interface FraudSignalView {
  id: string;
  programCountry: string;
  kind: string;
  accountId: string | null;
  profileId: string | null;
  /** Perfis envolvidos (o do alerta ou os do detalhe). */
  profileIds: string[];
  detail: Record<string, unknown>;
  status: 'open' | 'dismissed' | 'confirmed';
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

function profilesOf(row: { profileId: string | null; detail: Record<string, unknown> }): string[] {
  const fromDetail = Array.isArray(row.detail.profile_ids)
    ? (row.detail.profile_ids as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  return [...new Set([...(row.profileId ? [row.profileId] : []), ...fromDetail])];
}

/** Alertas do cliente, os abertos primeiro e os mais novos antes. */
export async function listFraudSignals(
  db: Pick<Database, 'select'>,
  input: { tenantId: string; status?: 'open' | 'dismissed' | 'confirmed' | undefined; limit?: number },
): Promise<FraudSignalView[]> {
  const rows = await db
    .select()
    .from(gameFraudSignal)
    .where(
      and(
        eq(gameFraudSignal.tenantId, input.tenantId),
        input.status ? eq(gameFraudSignal.status, input.status) : undefined,
      ),
    )
    .orderBy(sql`${gameFraudSignal.status} = 'open' desc`, desc(gameFraudSignal.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 200));
  return rows.map((r) => ({
    id: r.id,
    programCountry: r.programCountry,
    kind: r.kind,
    accountId: r.accountId,
    profileId: r.profileId,
    profileIds: profilesOf(r),
    detail: r.detail,
    status: r.status as FraudSignalView['status'],
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt,
    createdAt: r.createdAt,
  }));
}

/**
 * Revisão humana de um alerta aberto. `dismissed` fecha; `confirmed` fecha e congela os Perfis dele no programa.
 * Devolve null se o alerta não existe ou já foi revisado (outra pessoa chegou antes).
 */
export async function reviewFraudSignal(
  db: Database,
  input: {
    tenantId: string;
    signalId: string;
    decision: 'confirmed' | 'dismissed';
    actor: string;
    reason?: string;
  },
): Promise<{ frozen: string[] } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(gameFraudSignal)
      .set({ status: input.decision, reviewedBy: input.actor, reviewedAt: sql`now()` })
      .where(
        and(
          eq(gameFraudSignal.tenantId, input.tenantId),
          eq(gameFraudSignal.id, input.signalId),
          eq(gameFraudSignal.status, 'open'),
        ),
      )
      .returning();
    if (!row) return null;
    const key: GameProgramKey = { tenantId: input.tenantId, programCountry: row.programCountry };
    const frozen: string[] = [];
    if (input.decision === 'confirmed') {
      for (const profileId of profilesOf(row)) {
        const [ins] = await tx
          .insert(gameProfileFreeze)
          .values({
            ...key,
            profileId,
            signalId: row.id,
            frozenBy: input.actor,
            reason: input.reason?.slice(0, 500) ?? null,
          })
          .onConflictDoNothing()
          .returning({ profileId: gameProfileFreeze.profileId });
        if (ins) frozen.push(ins.profileId);
      }
    }
    // o registro de auditoria só aceita os tipos que já existem: a revisão vai como `fraud.flagged`, com a ação
    await appendGameAudit(tx, {
      ...key,
      kind: 'fraud.flagged',
      subject: `fraud:${input.decision}:${row.id}`,
      profileId: row.profileId,
      detail: { action: input.decision, signal_kind: row.kind, actor: input.actor, frozen },
    });
    return { frozen };
  });
}

/** Libera um Perfil congelado no programa. false se ele não estava congelado. */
export async function releaseProfileFreeze(
  db: Database,
  input: GameProgramKey & { profileId: string; actor: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const gone = await tx
      .delete(gameProfileFreeze)
      .where(
        and(
          eq(gameProfileFreeze.tenantId, input.tenantId),
          eq(gameProfileFreeze.programCountry, input.programCountry),
          eq(gameProfileFreeze.profileId, input.profileId),
        ),
      )
      .returning({ signalId: gameProfileFreeze.signalId });
    if (gone.length === 0) return false;
    await appendGameAudit(tx, {
      tenantId: input.tenantId,
      programCountry: input.programCountry,
      kind: 'fraud.flagged',
      subject: `fraud:released:${input.profileId}`,
      profileId: input.profileId,
      detail: { action: 'released', actor: input.actor, signal_id: gone[0]!.signalId },
    });
    return true;
  });
}

/** Perfis congelados do cliente (o painel lista para liberar). */
export async function listProfileFreezes(
  db: Pick<Database, 'select'>,
  tenantId: string,
): Promise<
  { programCountry: string; profileId: string; frozenBy: string; reason: string | null; frozenAt: Date }[]
> {
  return db
    .select({
      programCountry: gameProfileFreeze.programCountry,
      profileId: gameProfileFreeze.profileId,
      frozenBy: gameProfileFreeze.frozenBy,
      reason: gameProfileFreeze.reason,
      frozenAt: gameProfileFreeze.frozenAt,
    })
    .from(gameProfileFreeze)
    .where(eq(gameProfileFreeze.tenantId, tenantId))
    .orderBy(desc(gameProfileFreeze.frozenAt));
}

/** Apelidos dos Perfis do cliente (o painel mostra quem está no alerta). */
export async function fanNicknames(
  db: Pick<Database, 'execute'>,
  tenantId: string,
  profileIds: readonly string[],
): Promise<Map<string, string | null>> {
  if (profileIds.length === 0) return new Map();
  const rows = await db.execute<{ id: string; nickname: string | null }>(sql`
    select id, nickname from fan.profile
     where tenant_id = ${tenantId} and id = any(${[...new Set(profileIds)]}::uuid[])`);
  return new Map(rows.map((r) => [r.id, r.nickname]));
}

/** O Perfil está congelado na Gamificação do programa? */
export async function isProfileFrozen(
  db: Pick<Database, 'execute'>,
  key: GameProgramKey & { profileId: string },
): Promise<boolean> {
  const rows = await db.execute<{ x: number }>(sql`
    select 1 as x from game.profile_freeze
     where tenant_id = ${key.tenantId} and program_country = ${key.programCountry} and profile_id = ${key.profileId}
     limit 1`);
  return rows.length > 0;
}
