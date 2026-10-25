import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { publishChange } from './change-feed.js';
import type { Database } from './client.js';
import {
  event,
  relatedChannelRule,
  relatedContent,
  relatedPlaybackBlock,
  relatedPlaybackReport,
  type RelatedAspectRatio,
  type RelatedChannelRuleMode,
  type RelatedContentType,
  type RelatedFormat,
  type RelatedPlaybackBlockCode,
  type RelatedSourceTier,
  type RelatedStatus,
} from './schema/index.js';

/** Tópico do change feed / webhook do conteúdo relacionado (docs/12 §7). */
export const RELATED_CONTENT_TOPIC = 'event.related_content_changed';

/**
 * Canal com este número de vídeos recusados pelo player sai inteiro da vitrine e da pesquisa (ex.: o
 * detentor de direitos que bloqueia o embed de tudo o que tem imagem do jogo). Conta por tenant (os
 * relatos dele e os bloqueios confirmados) para a vitrine dele, e só os confirmados para todos.
 */
export const RELATED_CHANNEL_BLOCK_THRESHOLD = 3;

/**
 * Tenants distintos que precisam relatar a recusa do mesmo vídeo para ele sair da vitrine de todos (e
 * contar para o bloqueio do canal e para a pesquisa). Abaixo disso, sai só da vitrine de quem relatou.
 */
export const RELATED_GLOBAL_BLOCK_TENANTS = 2;

/** Tag de purge das respostas de conteúdo relacionado de um evento. */
export const relatedContentTag = (eventId: string) => `related_content:${eventId}`;

export type RelatedContentRow = typeof relatedContent.$inferSelect;

export interface ReadRelatedOptions {
  types?: readonly RelatedContentType[];
  format?: RelatedFormat;
  /** Proporções do quadro aceitas (ex.: só `9:16`, ou `16:9` e `9:16`). */
  aspectRatios?: readonly RelatedAspectRatio[];
  /** Padrão: só `published` (o que a API mostra). */
  statuses?: readonly RelatedStatus[];
  limit?: number;
  /**
   * Localização: só vídeos deste idioma (`pt`, `es`), com os do país `region` primeiro (es-AR antes de
   * es-MX). Vídeo sem idioma conhecido fica de fora — melhor nada do que o vídeo do país errado.
   */
  language?: string;
  region?: string;
  /** País do público: tira os vídeos que o YouTube não toca nele (`regionRestriction`). */
  country?: string;
  /** Tenant que lê: também ficam de fora os vídeos (e os canais, no limiar) que o player dele recusou. */
  tenantId?: string;
}

export interface RelatedContentPage {
  rows: RelatedContentRow[];
  /** Total publicado por tipo, antes dos filtros de tipo/formato (para as abas da vitrine). */
  counts: Partial<Record<RelatedContentType, number>>;
  /** Última verificação entre as linhas vigentes publicadas. */
  updatedAt: Date | null;
}

/**
 * Versões vigentes do conteúdo relacionado de um evento, ordenadas por `rank_score` (desempate por
 * data e id). Leitura compartilhada pelo agente e pela rota `GET /v1/events/{id}/related`.
 */
export async function readRelatedContent(
  db: Pick<Database, 'select'>,
  eventId: string,
  options: ReadRelatedOptions = {},
): Promise<RelatedContentPage> {
  const statuses = options.statuses ?? ['published'];
  const base = [
    eq(relatedContent.eventId, eventId),
    isNull(relatedContent.supersededBy),
    inArray(relatedContent.status, [...statuses]),
  ];
  const tenant = options.tenantId ?? null;
  // fora da vitrine: o vídeo que o player oficial recusou (bloqueio confirmado, em qualquer jogo, ou o
  // relato do próprio tenant)
  base.push(
    sql`not exists (select 1 from ${relatedPlaybackBlock} b where b.provider = ${relatedContent.provider} and b.external_id = ${relatedContent.externalId})`,
    ...(tenant
      ? [
          sql`not exists (select 1 from ${relatedPlaybackReport} p where p.provider = ${relatedContent.provider} and p.external_id = ${relatedContent.externalId} and p.tenant_id = ${tenant})`,
        ]
      : []),
    // o canal bloqueado no painel, ou o que já acumulou recusas (todos os formatos) sem ter sido liberado:
    // os bloqueios confirmados e, para o tenant, também os relatos dele
    sql`coalesce(
      (select r.mode = 'allow' from ${relatedChannelRule} r where r.provider = ${relatedContent.provider} and r.channel_id = ${relatedContent.channelId}),
      (select count(*) from (
        select b.external_id from ${relatedPlaybackBlock} b where b.provider = ${relatedContent.provider} and b.channel_id = ${relatedContent.channelId}
        ${tenant ? sql`union select p.external_id from ${relatedPlaybackReport} p where p.provider = ${relatedContent.provider} and p.channel_id = ${relatedContent.channelId} and p.tenant_id = ${tenant}` : sql``}
      ) refused) < ${RELATED_CHANNEL_BLOCK_THRESHOLD}
    )`,
  );
  if (options.country) {
    const c = options.country.toUpperCase();
    base.push(
      sql`(${relatedContent.regionAllowed} is null or ${c} = any(${relatedContent.regionAllowed}))`,
      sql`not (${c} = any(${relatedContent.regionBlocked}))`,
    );
  }
  if (options.language) {
    const lang = options.language.slice(0, 2).toLowerCase();
    base.push(sql`split_part(${relatedContent.language}, '-', 1) = ${lang}`);
  }
  const filters = [...base];
  if (options.types?.length) filters.push(inArray(relatedContent.contentType, [...options.types]));
  if (options.format) filters.push(eq(relatedContent.format, options.format));
  if (options.aspectRatios?.length)
    filters.push(inArray(relatedContent.aspectRatio, [...options.aspectRatios]));
  const region = options.language && options.region ? options.region.toUpperCase() : null;
  const rows = await db
    .select()
    .from(relatedContent)
    .where(and(...filters))
    .orderBy(
      ...(region ? [sql`(split_part(${relatedContent.language}, '-', 2) = ${region}) desc`] : []),
      desc(relatedContent.rankScore),
      desc(relatedContent.publishedAt),
      relatedContent.id,
    )
    .limit(options.limit ?? 50);
  const agg = await db
    .select({
      type: relatedContent.contentType,
      n: sql<number>`count(*)::int`,
      checked: sql<Date | null>`max(${relatedContent.lastCheckedAt})`,
    })
    .from(relatedContent)
    .where(and(...base))
    .groupBy(relatedContent.contentType);
  const counts: Partial<Record<RelatedContentType, number>> = {};
  let updatedAt: Date | null = null;
  for (const a of agg) {
    counts[a.type] = Number(a.n);
    const checked = a.checked ? new Date(a.checked) : null;
    if (checked && (!updatedAt || checked > updatedAt)) updatedAt = checked;
  }
  return { rows, counts, updatedAt };
}

export interface PlaybackBlockInput {
  /** Linha do conteúdo relacionado que o player recusou (`RelatedItem.id`). */
  itemId: string;
  code: RelatedPlaybackBlockCode;
  /** Tenant que relatou: o vídeo sai na hora da vitrine dele. */
  tenantId: string;
  /**
   * Conta para o bloqueio de todos (padrão true). false = o tenant avisa que o relato vem de usuário não
   * verificado (ex.: visitante da demo): o vídeo sai só da vitrine dele.
   */
  quorum?: boolean;
  now?: Date;
}

/** Vídeos que saíram da vitrine de um jogo. */
export interface PlaybackRemoval {
  eventId: string;
  sport: string;
  competitionId: string | null;
  removed: string[];
}

export interface PlaybackBlockResult {
  externalId: string;
  /** Primeiro relato deste tenant para o vídeo (o repetido só soma `reports`). */
  first: boolean;
  /** Este relato confirmou o bloqueio para todos (`RELATED_GLOBAL_BLOCK_TENANTS` tenants distintos que contam). */
  global: boolean;
  /** Jogos em que o vídeo saiu da vitrine do tenant que relatou (com o canal inteiro, no limiar dele). */
  tenantRemovals: PlaybackRemoval[];
  /** Jogos em que o vídeo saiu da vitrine de todos (com o canal inteiro, no limiar global). */
  globalRemovals: PlaybackRemoval[];
}

/**
 * Tópico interno do change feed: só purga o cache dos jogos (o vídeo saiu da vitrine de um tenant). Não é
 * tópico de tempo real, então não chega ao SSE nem aos webhooks dos outros tenants.
 */
export const RELATED_CONTENT_PURGE_TOPIC = 'related_content.purge';

/** Versões vigentes publicadas do vídeo ou do canal, por jogo, com o esporte e a competição do jogo. */
async function publishedIn(
  db: Pick<Database, 'select'>,
  provider: string,
  where: { externalId: string } | { channelId: string },
): Promise<PlaybackRemoval[]> {
  const rows = await db
    .select({
      eventId: relatedContent.eventId,
      externalId: relatedContent.externalId,
      sport: event.sport,
      competitionId: event.competitionId,
    })
    .from(relatedContent)
    .innerJoin(event, eq(event.id, relatedContent.eventId))
    .where(
      and(
        eq(relatedContent.provider, provider),
        'externalId' in where
          ? eq(relatedContent.externalId, where.externalId)
          : eq(relatedContent.channelId, where.channelId),
        isNull(relatedContent.supersededBy),
        eq(relatedContent.status, 'published'),
      ),
    )
    .orderBy(relatedContent.eventId, relatedContent.externalId);
  return mergeRemovals(
    rows.map((r) => ({
      eventId: r.eventId,
      sport: r.sport,
      competitionId: r.competitionId,
      removed: [r.externalId],
    })),
  );
}

function mergeRemovals(...lists: PlaybackRemoval[][]): PlaybackRemoval[] {
  const byEvent = new Map<string, PlaybackRemoval>();
  for (const r of lists.flat()) {
    const cur = byEvent.get(r.eventId);
    if (!cur) byEvent.set(r.eventId, { ...r, removed: [...new Set(r.removed)] });
    else cur.removed = [...new Set([...cur.removed, ...r.removed])];
  }
  return [...byEvent.values()];
}

/**
 * Registra o vídeo que o player oficial recusou (erro 100, 101 ou 150) e avisa os jogos em que ele
 * aparece. O relato vale na hora só para o tenant que relatou (o 101/150 pode depender do domínio do
 * embed, e um tenant não pode esvaziar a vitrine dos outros); o bloqueio de todos exige relatos de
 * `RELATED_GLOBAL_BLOCK_TENANTS` tenants distintos. O mesmo vale para o canal: `RELATED_CHANNEL_BLOCK_THRESHOLD`
 * vídeos recusados tiram o canal da vitrine do tenant, e o mesmo número de bloqueios confirmados tira o canal de
 * todos. Ao cruzar o limiar, todos os jogos com vídeo do canal são avisados, não só os do vídeo relatado.
 *
 * A vitrine de quem relatou é purgada pelo tópico interno `RELATED_CONTENT_PURGE_TOPIC`; o bloqueio de
 * todos sai em `event.related_content_changed` (SSE e webhook), com esporte e competição para os filtros.
 * null quando o item não existe. Rode numa transação: o lock serializa os relatos do mesmo canal.
 */
export async function recordPlaybackBlock(
  db: Pick<Database, 'select' | 'insert' | 'execute'>,
  input: PlaybackBlockInput,
): Promise<PlaybackBlockResult | null> {
  const [row] = await db
    .select({
      provider: relatedContent.provider,
      externalId: relatedContent.externalId,
      channelId: relatedContent.channelId,
      format: relatedContent.format,
      contentType: relatedContent.contentType,
    })
    .from(relatedContent)
    .where(eq(relatedContent.id, input.itemId))
    .limit(1);
  if (!row) return null;
  const { provider, externalId, channelId } = row;
  const now = input.now ?? new Date();
  // relatos concorrentes do mesmo canal (ou vídeo) contam um de cada vez: senão dois tenants ao mesmo
  // tempo nunca confirmariam o bloqueio, e o limiar do canal poderia passar sem aviso
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`related_playback:${provider}:${channelId ?? externalId}`}))`,
  );
  const quorum = input.quorum ?? true;
  const key = and(
    eq(relatedPlaybackReport.provider, provider),
    eq(relatedPlaybackReport.externalId, externalId),
    eq(relatedPlaybackReport.tenantId, input.tenantId),
  );
  const [prev] = await db
    .select({ quorum: relatedPlaybackReport.quorum })
    .from(relatedPlaybackReport)
    .where(key)
    .limit(1);
  await db
    .insert(relatedPlaybackReport)
    .values({
      provider,
      externalId,
      tenantId: input.tenantId,
      code: input.code,
      channelId,
      format: row.format,
      quorum,
      firstReportedAt: now,
      lastReportedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        relatedPlaybackReport.provider,
        relatedPlaybackReport.externalId,
        relatedPlaybackReport.tenantId,
      ],
      set: {
        code: input.code,
        reports: sql`${relatedPlaybackReport.reports} + 1`,
        // um relato que conta não deixa de contar
        quorum: sql`${relatedPlaybackReport.quorum} or excluded.quorum`,
        lastReportedAt: now,
      },
    });
  const result: PlaybackBlockResult = {
    externalId,
    first: !prev,
    global: false,
    tenantRemovals: [],
    globalRemovals: [],
  };
  // o tenant passou a contar para o bloqueio de todos agora (primeiro relato que conta)
  const counts = quorum && !prev?.quorum;
  if (!result.first && !counts) return result;

  const [already] = await db
    .select({ code: relatedPlaybackBlock.code })
    .from(relatedPlaybackBlock)
    .where(and(eq(relatedPlaybackBlock.provider, provider), eq(relatedPlaybackBlock.externalId, externalId)))
    .limit(1);
  // bloqueado para todos antes (inclusive as linhas de antes da 0043): a vitrine de ninguém muda
  if (already) return result;

  const allowed =
    channelId != null &&
    (
      await db
        .select({ mode: relatedChannelRule.mode })
        .from(relatedChannelRule)
        .where(and(eq(relatedChannelRule.provider, provider), eq(relatedChannelRule.channelId, channelId)))
        .limit(1)
    )[0]?.mode === 'allow';

  // confirmação: tenants distintos que relataram o vídeo (só os relatos que contam)
  const [tenants] = counts
    ? await db
        .select({
          n: sql<number>`count(*)::int`,
          firstTenant: sql<string>`(array_agg(${relatedPlaybackReport.tenantId} order by ${relatedPlaybackReport.firstReportedAt}))[1]`,
          firstAt: sql<string>`min(${relatedPlaybackReport.firstReportedAt})`,
          reports: sql<number>`sum(${relatedPlaybackReport.reports})::int`,
        })
        .from(relatedPlaybackReport)
        .where(
          and(
            eq(relatedPlaybackReport.provider, provider),
            eq(relatedPlaybackReport.externalId, externalId),
            eq(relatedPlaybackReport.quorum, true),
          ),
        )
    : [];
  if (Number(tenants?.n ?? 0) >= RELATED_GLOBAL_BLOCK_TENANTS) {
    // a versão anterior da API (durante o deploy) grava a mesma linha direto: quem chegou primeiro avisa
    const inserted = await db
      .insert(relatedPlaybackBlock)
      .values({
        ...row,
        code: input.code,
        reports: Number(tenants!.reports),
        tenantId: tenants!.firstTenant,
        firstReportedAt: new Date(tenants!.firstAt),
        lastReportedAt: now,
      })
      .onConflictDoNothing()
      .returning({ externalId: relatedPlaybackBlock.externalId });
    if (!inserted.length) return result;
    result.global = true;
    const lists = [await publishedIn(db, provider, { externalId })];
    if (channelId && !allowed) {
      const [blocked] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(relatedPlaybackBlock)
        .where(
          and(eq(relatedPlaybackBlock.provider, provider), eq(relatedPlaybackBlock.channelId, channelId)),
        );
      if (Number(blocked?.n ?? 0) === RELATED_CHANNEL_BLOCK_THRESHOLD)
        lists.push(await publishedIn(db, provider, { channelId }));
    }
    result.globalRemovals = mergeRemovals(...lists);
  }

  // vitrine de quem relatou (só no primeiro relato dele): o vídeo (se não saiu para todos) e, no limiar do
  // tenant, o canal inteiro
  const lists = result.global || !result.first ? [] : [await publishedIn(db, provider, { externalId })];
  if (result.first && channelId && !allowed) {
    const refused = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from (
        select b.external_id from ${relatedPlaybackBlock} b where b.provider = ${provider} and b.channel_id = ${channelId}
        union
        select p.external_id from ${relatedPlaybackReport} p
         where p.provider = ${provider} and p.channel_id = ${channelId} and p.tenant_id = ${input.tenantId}
      ) x`);
    if (Number([...refused][0]?.n ?? 0) === RELATED_CHANNEL_BLOCK_THRESHOLD)
      lists.push(await publishedIn(db, provider, { channelId }));
  }
  result.tenantRemovals = mergeRemovals(...lists);

  for (const r of result.globalRemovals)
    await publishChange(db, {
      topic: RELATED_CONTENT_TOPIC,
      entityType: 'related_content',
      entityId: r.eventId,
      payload: {
        event_id: r.eventId,
        sport: r.sport,
        competition_id: r.competitionId,
        changed: ['related_content'],
        data: { added: [], removed: r.removed, changed: [] },
        tags: [relatedContentTag(r.eventId), `event:${r.eventId}`],
      },
    });
  const announced = new Set(result.globalRemovals.map((r) => r.eventId));
  for (const r of result.tenantRemovals)
    if (!announced.has(r.eventId))
      await publishChange(db, {
        topic: RELATED_CONTENT_PURGE_TOPIC,
        entityType: 'related_content',
        entityId: r.eventId,
        // só a vitrine de vídeos: `event:<id>` purgaria o jogo inteiro (placar, onde assistir...) para todos
        payload: { event_id: r.eventId, tenant_id: input.tenantId, tags: [relatedContentTag(r.eventId)] },
      });
  return result;
}

/** Bloqueios por canal e formato (o vídeo recusado e quantos do mesmo canal e formato já foram). */
export interface PlaybackBlockIndex {
  videos: Set<string>;
  /** Canais fora da pesquisa: bloqueados no painel, ou com `RELATED_CHANNEL_BLOCK_THRESHOLD` recusas e não liberados. */
  channels: Set<string>;
  /** `${channelId}|${format}` → vídeos bloqueados. */
  byChannelFormat: Map<string, number>;
}

export async function readPlaybackBlocks(
  db: Pick<Database, 'select'>,
  provider = 'youtube',
): Promise<PlaybackBlockIndex> {
  const rows = await db
    .select({
      externalId: relatedPlaybackBlock.externalId,
      channelId: relatedPlaybackBlock.channelId,
      format: relatedPlaybackBlock.format,
    })
    .from(relatedPlaybackBlock)
    .where(eq(relatedPlaybackBlock.provider, provider));
  const rules = await db
    .select({ channelId: relatedChannelRule.channelId, mode: relatedChannelRule.mode })
    .from(relatedChannelRule)
    .where(eq(relatedChannelRule.provider, provider));
  const allowed = new Set(rules.filter((r) => r.mode === 'allow').map((r) => r.channelId));
  const index: PlaybackBlockIndex = { videos: new Set(), channels: new Set(), byChannelFormat: new Map() };
  const perChannel = new Map<string, number>();
  for (const r of rows) {
    index.videos.add(r.externalId);
    if (r.channelId) {
      const n = (perChannel.get(r.channelId) ?? 0) + 1;
      perChannel.set(r.channelId, n);
      if (n >= RELATED_CHANNEL_BLOCK_THRESHOLD && !allowed.has(r.channelId)) index.channels.add(r.channelId);
    }
    if (!r.channelId || !r.format) continue;
    const key = `${r.channelId}|${r.format}`;
    index.byChannelFormat.set(key, (index.byChannelFormat.get(key) ?? 0) + 1);
  }
  for (const r of rules) if (r.mode === 'block') index.channels.add(r.channelId);
  return index;
}

// ─── controle por canal (Ajustes → Vídeos relacionados) ─────────────────────────────────────────

export interface RelatedChannelSummary {
  channelId: string;
  title: string;
  handle: string | null;
  sourceTier: RelatedSourceTier | null;
  /** Vídeos publicados (versão vigente) do canal, em todos os jogos. */
  published: number;
  /** Vídeos do canal com a recusa do player confirmada (bloqueados para todos). */
  refused: number;
  /** Vídeos do canal relatados por algum tenant (saíram só da vitrine de quem relatou, até confirmar). */
  reported: number;
  /** Vídeos distintos com recusa, confirmada ou relatada: o que "Limpar recusas" devolve à vitrine. */
  refusedVideos: number;
  lastRefusedAt: Date | null;
  rule: RelatedChannelRuleMode | null;
  ruleBy: string | null;
  ruleAt: Date | null;
  note: string | null;
  /** Fora dos relacionados agora: regra `block`, ou as recusas do automático sem `allow`. */
  blocked: boolean;
}

export interface ListRelatedChannelsOptions {
  provider?: string;
  /** Busca no nome ou no @ do canal. */
  q?: string;
  /** `blocked` = fora dos relacionados; `refused` = com recusas do player (confirmadas ou relatadas). */
  only?: 'blocked' | 'refused';
  limit?: number;
}

/**
 * Canais dos vídeos relacionados com as recusas do player e a regra manual: os bloqueados e os com
 * recusas primeiro, depois os com mais vídeos na vitrine.
 */
export async function listRelatedChannels(
  db: Pick<Database, 'execute'>,
  options: ListRelatedChannelsOptions = {},
): Promise<RelatedChannelSummary[]> {
  const provider = options.provider ?? 'youtube';
  const q = options.q?.trim() ? `%${options.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const rows = await db.execute<{
    channel_id: string;
    title: string | null;
    handle: string | null;
    source_tier: RelatedSourceTier | null;
    published: number;
    refused: number;
    reported: number;
    refused_videos: number;
    last_refused_at: string | null;
    rule: RelatedChannelRuleMode | null;
    rule_by: string | null;
    rule_at: string | null;
    note: string | null;
  }>(sql`
    with vids as (
      select channel_id, max(channel_title) as title, max(channel_handle) as handle,
             max(source_tier) as source_tier,
             count(*) filter (where status = 'published')::int as published
      from ${relatedContent}
      where provider = ${provider} and superseded_by is null
      group by channel_id
    ), blk as (
      select channel_id, count(*)::int as refused, max(last_reported_at) as last_refused_at
      from ${relatedPlaybackBlock}
      where provider = ${provider} and channel_id is not null
      group by channel_id
    ), rep as (
      select channel_id, count(distinct external_id)::int as reported, max(last_reported_at) as last_reported_at
      from ${relatedPlaybackReport}
      where provider = ${provider} and channel_id is not null
      group by channel_id
    ), refs as (
      select channel_id, count(*)::int as refused_videos from (
        select channel_id, external_id from ${relatedPlaybackBlock} where provider = ${provider} and channel_id is not null
        union
        select channel_id, external_id from ${relatedPlaybackReport} where provider = ${provider} and channel_id is not null
      ) u group by channel_id
    ), rules as (
      select channel_id, mode, channel_title, note, updated_by, updated_at
      from ${relatedChannelRule}
      where provider = ${provider}
    ), ids as (
      select channel_id from vids union select channel_id from blk union select channel_id from rep
      union select channel_id from rules
    )
    select ids.channel_id, coalesce(vids.title, rules.channel_title) as title, vids.handle, vids.source_tier,
           coalesce(vids.published, 0) as published, coalesce(blk.refused, 0) as refused,
           coalesce(rep.reported, 0) as reported, coalesce(refs.refused_videos, 0) as refused_videos,
           greatest(blk.last_refused_at, rep.last_reported_at) as last_refused_at, rules.mode as rule, rules.updated_by as rule_by, rules.updated_at as rule_at,
           rules.note
    from ids
    left join vids on vids.channel_id = ids.channel_id
    left join blk on blk.channel_id = ids.channel_id
    left join rep on rep.channel_id = ids.channel_id
    left join refs on refs.channel_id = ids.channel_id
    left join rules on rules.channel_id = ids.channel_id
    where (${q}::text is null or coalesce(vids.title, rules.channel_title, '') ilike ${q} or coalesce(vids.handle, '') ilike ${q})
  `);
  const out = [...rows].map((r) => {
    const refused = Number(r.refused);
    const blocked = r.rule === 'block' || (r.rule !== 'allow' && refused >= RELATED_CHANNEL_BLOCK_THRESHOLD);
    return {
      channelId: r.channel_id,
      title: r.title ?? r.channel_id,
      handle: r.handle,
      sourceTier: r.source_tier,
      published: Number(r.published),
      refused,
      reported: Number(r.reported),
      refusedVideos: Number(r.refused_videos),
      lastRefusedAt: r.last_refused_at ? new Date(r.last_refused_at) : null,
      rule: r.rule,
      ruleBy: r.rule_by,
      ruleAt: r.rule_at ? new Date(r.rule_at) : null,
      note: r.note,
      blocked,
    } satisfies RelatedChannelSummary;
  });
  return out
    .filter((c) =>
      options.only === 'blocked'
        ? c.blocked
        : options.only === 'refused'
          ? c.refused > 0 || c.reported > 0
          : true,
    )
    .sort(
      (a, b) =>
        Number(b.blocked) - Number(a.blocked) ||
        b.refused - a.refused ||
        b.reported - a.reported ||
        b.published - a.published ||
        a.title.localeCompare(b.title),
    )
    .slice(0, options.limit ?? 200);
}

/** Avisa os jogos com vídeo do canal (purga do cache da API, SSE e webhook). */
async function announceChannel(
  tx: Pick<Database, 'select' | 'execute'>,
  provider: string,
  channelId: string,
) {
  const events = await publishedIn(tx, provider, { channelId });
  for (const { eventId, sport, competitionId } of events)
    await publishChange(tx, {
      topic: RELATED_CONTENT_TOPIC,
      entityType: 'related_content',
      entityId: eventId,
      payload: {
        event_id: eventId,
        sport,
        competition_id: competitionId,
        changed: ['related_content'],
        tags: [relatedContentTag(eventId), `event:${eventId}`],
      },
    });
  return events.length;
}

export interface SetRelatedChannelRuleInput {
  provider?: string;
  channelId: string;
  /** null = volta ao automático (apaga a regra). */
  mode: RelatedChannelRuleMode | null;
  channelTitle?: string | null;
  note?: string | null;
  by: string;
}

/** Grava (ou apaga) a regra manual do canal e devolve quantos jogos foram avisados. */
export async function setRelatedChannelRule(
  db: Database,
  input: SetRelatedChannelRuleInput,
): Promise<number> {
  const provider = input.provider ?? 'youtube';
  return db.transaction(async (tx) => {
    const key = and(
      eq(relatedChannelRule.provider, provider),
      eq(relatedChannelRule.channelId, input.channelId),
    );
    if (input.mode === null) await tx.delete(relatedChannelRule).where(key);
    else
      await tx
        .insert(relatedChannelRule)
        .values({
          provider,
          channelId: input.channelId,
          mode: input.mode,
          channelTitle: input.channelTitle ?? null,
          note: input.note ?? null,
          updatedBy: input.by,
        })
        .onConflictDoUpdate({
          target: [relatedChannelRule.provider, relatedChannelRule.channelId],
          set: {
            mode: input.mode,
            note: input.note ?? null,
            updatedBy: input.by,
            updatedAt: new Date(),
            ...(input.channelTitle ? { channelTitle: input.channelTitle } : {}),
          },
        });
    return announceChannel(tx, provider, input.channelId);
  });
}

/**
 * Apaga as recusas do player do canal, confirmadas e relatadas por tenant (ex.: o detentor liberou o
 * embed): os vídeos voltam à vitrine e o automático recomeça a contar. Devolve quantos vídeos saíram da
 * lista de recusas.
 */
export async function clearRelatedChannelRefusals(
  db: Database,
  input: { provider?: string; channelId: string },
): Promise<number> {
  const provider = input.provider ?? 'youtube';
  return db.transaction(async (tx) => {
    const blocks = await tx
      .delete(relatedPlaybackBlock)
      .where(
        and(eq(relatedPlaybackBlock.provider, provider), eq(relatedPlaybackBlock.channelId, input.channelId)),
      )
      .returning({ id: relatedPlaybackBlock.externalId });
    const reports = await tx
      .delete(relatedPlaybackReport)
      .where(
        and(
          eq(relatedPlaybackReport.provider, provider),
          eq(relatedPlaybackReport.channelId, input.channelId),
        ),
      )
      .returning({ id: relatedPlaybackReport.externalId });
    await announceChannel(tx, provider, input.channelId);
    return new Set([...blocks, ...reports].map((r) => r.id)).size;
  });
}
