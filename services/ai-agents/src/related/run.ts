/**
 * Execução do agente de Conteúdo relacionado (docs/12 §5): jogos encerrados nas últimas horas (ou um
 * evento), consultas montadas dos fatos do core, busca na YouTube Data API dentro da cota do dia,
 * relevância e política em código, classificação pelo LLM `light` (fallback por regras) e gravação
 * versionada em enrich.related_content.
 */
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  competition,
  event,
  participant,
  relatedRun,
  type Database,
  type RelatedContentRow,
} from '@galaxie/db';
import type { WtwConfig } from '@galaxie/where-to-watch';
import {
  competitionName,
  loadEventCore,
  stageName,
  teamName,
  type EventCore,
} from '../context/event-core.js';
import { eventMatchLabel } from '../context/run.js';
import { findForbiddenTerms, sanitizeExcerpt } from '../guardrails/index.js';
import { sanitizeText } from '../llm/hygiene.js';
import type { LlmClient } from '../llm/types.js';
import { buildGoals, loadIncidents } from '../recap/facts.js';
import { rightsHoldersFor, type ChannelAllowlist } from './channels.js';
import { classifyVideos, detectFormat, RULES_CLASSIFIER, type ClassifyFacts } from './classify.js';
import { checkRelevance, decidePublication, rankScore } from './policy.js';
import { buildRelatedQueries, languagesFor, type RelatedQuery } from './queries.js';
import {
  currentRelatedRows,
  expireStaleRelated,
  quotaUnitsUsed,
  saveRelatedContent,
  type RelatedItemInput,
} from './store.js';
import { YOUTUBE_UNITS, youtubeQuotaDay, type VideoDetail, type YoutubeClient } from './youtube.js';

export const DEFAULT_YOUTUBE_DAILY_QUOTA = 10_000;
export const DEFAULT_QUOTA_RESERVE_PERCENT = 10;
export const DEFAULT_RESEARCH_HOURS = 12;

export interface RelatedRunOptions {
  now?: Date;
  /** Um evento específico (ignora janela e tier). */
  eventId?: string;
  /** Janela para trás a partir do início do jogo, em horas (padrão 48). */
  lookbackHours?: number;
  maxTier?: number;
  limit?: number;
  /** Só mostra candidatos, consultas e unidades estimadas (nada é chamado nem gravado). */
  plan?: boolean;
  /** Busca completa mesmo dentro da janela de revalidação. */
  force?: boolean;
  llm: LlmClient | null;
  /** Obrigatório fora do --plan. */
  youtube: YoutubeClient | null;
  allowlist: ChannelAllowlist;
  wtw: WtwConfig;
  dailyQuota?: number;
  reservePercent?: number;
  /** Busca completa no máximo a cada N horas por evento (padrão 12); no meio, só revalida. */
  researchHours?: number;
  maxSearchesPerLanguage?: number;
  requestedBy?: string;
}

export interface RelatedRunItem {
  eventId: string;
  label: string;
  startsAt: string;
  action: 'searched' | 'revalidated' | 'planned' | 'skipped' | 'error';
  mode?: 'full' | 'revalidate';
  reason?: string;
  queries?: string[];
  units?: number;
  candidates?: number;
  published?: number;
  pending?: number;
  rejected?: number;
  /** tipo → quantidade publicada nesta execução. */
  types?: Record<string, number>;
  llm?: boolean;
}

export interface RelatedRunReport {
  items: RelatedRunItem[];
  quotaDay: string;
  quotaLimit: number;
  unitsUsedBefore: number;
  unitsSpent: number;
  llmCalls: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  expired: number;
}

export async function relatedCandidates(
  db: Database,
  opts: { now: Date; lookbackHours: number; maxTier: number; limit: number },
): Promise<string[]> {
  const since = new Date(opts.now.getTime() - opts.lookbackHours * 3_600_000);
  const rows = await db
    .select({ id: event.id })
    .from(event)
    .innerJoin(competition, eq(competition.id, event.competitionId))
    .where(
      and(
        eq(event.sport, 'football'),
        eq(event.status, 'finished'),
        gte(event.startsAt, since),
        lte(event.startsAt, opts.now),
        lte(competition.tier, opts.maxTier),
      ),
    )
    .orderBy(competition.tier, desc(event.importance), desc(event.startsAt), desc(event.id))
    .limit(opts.limit);
  return rows.map((r) => r.id);
}

async function teamCountries(db: Database, core: EventCore): Promise<(string | null)[]> {
  const rows = await db
    .select({ id: participant.id, country: participant.countryCode })
    .from(participant)
    .where(inArray(participant.id, [core.home.id, core.away.id]));
  return [core.home.id, core.away.id].map((id) => rows.find((r) => r.id === id)?.country ?? null);
}

async function lastFullRun(db: Database, eventId: string): Promise<Date | null> {
  const [row] = await db
    .select({ startedAt: relatedRun.startedAt })
    .from(relatedRun)
    .where(and(eq(relatedRun.eventId, eventId), eq(relatedRun.mode, 'full'), eq(relatedRun.status, 'done')))
    .orderBy(desc(relatedRun.startedAt))
    .limit(1);
  return row?.startedAt ?? null;
}

function classifyFacts(core: EventCore, scorers: string[]): ClassifyFacts {
  const s = core.score;
  return {
    home: teamName(core.home, 'pt-BR'),
    away: teamName(core.away, 'pt-BR'),
    competition: competitionName(core, 'pt-BR'),
    stage: stageName(core, 'pt-BR'),
    kickoff: core.startsAt.toISOString(),
    score: {
      home: typeof s?.home === 'number' ? s.home : null,
      away: typeof s?.away === 'number' ? s.away : null,
      penalties:
        s?.penalty && typeof s.penalty.home === 'number' && typeof s.penalty.away === 'number'
          ? { home: s.penalty.home, away: s.penalty.away }
          : null,
    },
    scorers,
  };
}

const videoUrl = (id: string, format: 'short' | 'long') =>
  format === 'short' ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;

export async function runRelatedAgent(db: Database, opts: RelatedRunOptions): Promise<RelatedRunReport> {
  const now = opts.now ?? new Date();
  const quotaDay = youtubeQuotaDay(now);
  const daily = opts.dailyQuota ?? DEFAULT_YOUTUBE_DAILY_QUOTA;
  const quotaLimit = Math.floor(daily * (1 - (opts.reservePercent ?? DEFAULT_QUOTA_RESERVE_PERCENT) / 100));
  const unitsUsedBefore = await quotaUnitsUsed(db, quotaDay);
  const report: RelatedRunReport = {
    items: [],
    quotaDay,
    quotaLimit,
    unitsUsedBefore,
    unitsSpent: 0,
    llmCalls: 0,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    expired: 0,
  };
  if (!opts.plan) {
    if (!opts.youtube) throw new Error('Cliente do YouTube ausente (YOUTUBE_API_KEY).');
    report.expired = (await expireStaleRelated(db, { now })).rows;
  }
  const ids = opts.eventId
    ? [opts.eventId]
    : await relatedCandidates(db, {
        now,
        lookbackHours: opts.lookbackHours ?? 48,
        maxTier: opts.maxTier ?? 2,
        limit: opts.limit ?? 20,
      });

  for (const id of ids) {
    const core = await loadEventCore(db, id);
    if (!core) {
      report.items.push({
        eventId: id,
        label: '?',
        startsAt: '',
        action: 'skipped',
        reason: 'evento não encontrado',
      });
      continue;
    }
    const item: RelatedRunItem = {
      eventId: id,
      label: eventMatchLabel(core),
      startsAt: core.startsAt.toISOString(),
      action: 'skipped',
    };
    report.items.push(item);
    try {
      if (core.status !== 'finished') {
        item.reason = `evento ainda não encerrado (${core.status})`;
        continue;
      }
      const current = await currentRelatedRows(db, id);
      const last = opts.force ? null : await lastFullRun(db, id);
      const researchMs = (opts.researchHours ?? DEFAULT_RESEARCH_HOURS) * 3_600_000;
      const mode: 'full' | 'revalidate' =
        last && now.getTime() - last.getTime() < researchMs ? 'revalidate' : 'full';
      item.mode = mode;
      const alive = current.filter((r) => r.status !== 'retracted' && r.status !== 'expired');
      if (mode === 'revalidate' && !alive.length) {
        item.reason = 'busca completa recente sem vídeos guardados';
        continue;
      }

      const final =
        core.score && typeof core.score.home === 'number' && typeof core.score.away === 'number'
          ? { home: core.score.home, away: core.score.away }
          : null;
      const goals = final ? buildGoals(await loadIncidents(db, id), core, final) : [];
      const scorers = [
        ...new Set(goals.filter((g) => g.type !== 'own_goal' && g.scorer).map((g) => g.scorer!)),
      ];
      let queries: RelatedQuery[] =
        mode === 'full'
          ? buildRelatedQueries({
              core,
              scorers,
              languages: languagesFor(await teamCountries(db, core)),
              ...(opts.maxSearchesPerLanguage !== undefined
                ? { maxPerLanguage: opts.maxSearchesPerLanguage }
                : {}),
            })
          : [];

      // cota: corta consultas que não cabem no saldo do dia (videos/channels custam 1 por lote)
      const available = quotaLimit - (unitsUsedBefore + report.unitsSpent);
      const fixed = YOUTUBE_UNITS.videos * 2 + YOUTUBE_UNITS.channels * 2;
      const fit = Math.max(0, Math.floor((available - fixed) / YOUTUBE_UNITS.search));
      if (mode === 'full' && fit < queries.length) queries = queries.slice(0, fit);
      if ((mode === 'full' && !queries.length) || available < fixed) {
        item.reason = `cota do YouTube insuficiente (${Math.max(0, available)} unidades livres de ${quotaLimit})`;
        continue;
      }
      item.queries = queries.map((q) => `${q.language}:${q.label}`);
      item.units = queries.length * YOUTUBE_UNITS.search + fixed;
      if (opts.plan) {
        item.action = 'planned';
        item.reason = queries.map((q) => q.params.q).join(' · ') || `revalidar ${alive.length} vídeo(s)`;
        continue;
      }

      const yt = opts.youtube!;
      const unitsStart = yt.units;
      const [run] = await db
        .insert(relatedRun)
        .values({ eventId: id, mode, quotaDay, requestedBy: opts.requestedBy ?? 'cli', startedAt: now })
        .returning({ id: relatedRun.id });
      const runId = run!.id;
      const stats: Record<string, unknown> = { queries: {}, discarded: {} as Record<string, number> };
      const discard = (reason: string) => {
        const d = stats.discarded as Record<string, number>;
        d[reason] = (d[reason] ?? 0) + 1;
      };
      try {
        // 1. descoberta
        const found = new Map<string, { labels: Set<string>; language: string }>();
        let searches = 0;
        for (const q of queries) {
          try {
            const hits = await yt.search(q.params);
            searches++;
            (stats.queries as Record<string, unknown>)[`${q.language}:${q.label}`] = {
              q: q.params.q,
              hits: hits.length,
            };
            for (const h of hits) {
              const f = found.get(h.videoId) ?? { labels: new Set<string>(), language: q.language };
              f.labels.add(`${q.language}:${q.label}`);
              found.set(h.videoId, f);
            }
          } catch (err) {
            if ((err as { quotaExceeded?: boolean }).quotaExceeded) {
              stats.quotaExceeded = true;
              break;
            }
            throw err;
          }
        }
        // 2. detalhe (inclui os vídeos já guardados: o que sumiu vira retracted)
        const prevById = new Map<string, RelatedContentRow>(alive.map((r) => [r.externalId, r]));
        const allIds = [...new Set([...found.keys(), ...prevById.keys()])];
        const videos = allIds.length ? await yt.videos(allIds) : [];
        const returned = new Set(videos.map((v) => v.id));
        const gone = [...prevById.keys()].filter((x) => !returned.has(x));
        const channels = new Map(
          (videos.length ? await yt.channels(videos.map((v) => v.channelId)) : []).map((c) => [c.id, c]),
        );
        const markets = [
          ...new Set([...(await teamCountries(db, core)).filter((c): c is string => !!c), 'BR']),
        ];
        const holders = rightsHoldersFor(opts.wtw, core.competition?.slug, markets, core.startsAt);

        // 3. canal + relevância (código)
        type Cand = {
          v: VideoDetail;
          tier: ReturnType<ChannelAllowlist['classify']>;
          prev?: RelatedContentRow;
        };
        const cands: Cand[] = [];
        for (const v of videos) {
          const ch = channels.get(v.channelId) ?? {
            id: v.channelId,
            title: v.channelTitle,
            handle: null,
            subscribers: null,
          };
          const verdict = opts.allowlist.classify(ch, holders);
          if (verdict.blocked) {
            discard('blocked_channel');
            continue;
          }
          const rel = checkRelevance(core, {
            title: v.title,
            description: v.description,
            tags: v.tags,
            publishedAt: new Date(v.publishedAt),
            privacyStatus: v.privacyStatus,
            embeddable: v.embeddable,
            tier: verdict.tier,
          });
          if (!rel.ok) {
            discard(rel.reason);
            if (prevById.has(v.id)) gone.push(v.id);
            continue;
          }
          cands.push({ v, tier: verdict, ...(prevById.has(v.id) ? { prev: prevById.get(v.id)! } : {}) });
        }

        // 4. classificação: novos, os que mudaram de título e (com LLM) os que só tinham a das regras;
        //    o resto reaproveita a anterior
        const toClassify = cands.filter(
          (c) =>
            !c.prev ||
            c.prev.title !== sanitizeText(c.v.title, 300) ||
            (!!opts.llm && c.prev.classifiedBy === RULES_CLASSIFIER),
        );
        const cls = await classifyVideos({
          llm: opts.llm,
          eventId: id,
          facts: classifyFacts(core, scorers),
          videos: toClassify.map((c) => ({
            id: c.v.id,
            title: c.v.title,
            description: c.v.description,
            channelTitle: c.v.channelTitle,
            durationSeconds: c.v.durationSeconds,
            format: detectFormat(c.v),
            tags: c.v.tags,
          })),
        });
        report.llmCalls += cls.llmCalls;
        report.usage.inputTokens += cls.usage.inputTokens;
        report.usage.outputTokens += cls.usage.outputTokens;
        report.usage.costUsd += cls.usage.costUsd ?? 0;
        item.llm = !!cls.model && !cls.error;
        if (cls.error) stats.llmError = cls.error.slice(0, 300);

        // 5. política + ranking
        const items: RelatedItemInput[] = [];
        for (const c of cands) {
          const { v } = c;
          const ch = channels.get(v.channelId);
          const fresh = cls.byId.get(v.id);
          const prevFlags = (c.prev?.flags ?? []).filter((f) => f === 'injection_signal');
          // reaproveita a classificação anterior (inclusive o "não é deste jogo" do LLM)
          const base = fresh ?? {
            type: c.prev!.contentType,
            confidence: Number(c.prev!.confidence),
            aboutThisEvent: !c.prev!.flags.includes('not_this_event'),
            classifiedBy: c.prev!.classifiedBy,
            flags: prevFlags,
          };
          const language =
            found.get(v.id)?.language ?? c.prev?.language ?? v.defaultLanguage?.slice(0, 2) ?? null;
          const locale = language === 'es' ? 'es-AR' : 'pt-BR';
          const flags = [...base.flags];
          if (findForbiddenTerms(v.title, locale, { allowPhrases: [core.home.name, core.away.name] }).length)
            flags.push('offensive_title');
          const format = detectFormat(v);
          const decision = base.aboutThisEvent
            ? decidePublication({
                tier: c.tier.tier,
                type: base.type,
                confidence: base.confidence,
                format,
                flags,
              })
            : { status: 'rejected' as const, flags: [...flags, 'not_this_event'] };
          const publishedAt = new Date(v.publishedAt);
          items.push({
            externalId: v.id,
            url: videoUrl(v.id, format),
            embedUrl: `https://www.youtube.com/embed/${v.id}`,
            title: sanitizeText(v.title, 300),
            descriptionExcerpt: v.description
              ? sanitizeExcerpt(sanitizeText(v.description, 1000), 200)
              : null,
            channelId: v.channelId,
            channelTitle: sanitizeText(ch?.title || v.channelTitle, 120),
            channelHandle: ch?.handle ?? null,
            sourceTier: c.tier.tier,
            contentType: base.type,
            format,
            durationSeconds: v.durationSeconds,
            publishedAt,
            thumbnailUrl: v.thumbnailUrl,
            language,
            statistics: {
              views: v.views,
              likes: v.likes,
              comments: v.comments,
              fetchedAt: now.toISOString(),
            },
            rankScore: rankScore({
              tier: c.tier.tier,
              type: base.type,
              views: v.views,
              publishedAt,
              kickoff: core.startsAt,
            }),
            confidence: base.confidence,
            classifiedBy: base.classifiedBy,
            status: decision.status,
            flags: decision.flags,
            queries: [...(found.get(v.id)?.labels ?? [])],
          });
        }

        const saved = await saveRelatedContent(db, {
          eventId: id,
          provider: 'youtube',
          items,
          gone: [...new Set(gone)],
          runId,
          sport: core.sport,
          competitionId: core.competition?.id ?? null,
          now,
        });
        const published = items.filter((i) => i.status === 'published');
        item.action = mode === 'full' ? 'searched' : 'revalidated';
        item.candidates = videos.length;
        item.published = published.length;
        item.pending = items.filter((i) => i.status === 'pending').length;
        item.rejected = items.filter((i) => i.status === 'rejected').length;
        item.types = published.reduce<Record<string, number>>((acc, i) => {
          acc[i.contentType] = (acc[i.contentType] ?? 0) + 1;
          return acc;
        }, {});
        item.units = yt.units - unitsStart;
        report.unitsSpent += item.units;
        stats.saved = saved;
        await db
          .update(relatedRun)
          .set({
            status: 'done',
            finishedAt: new Date(),
            quotaUnits: item.units,
            searches,
            candidates: videos.length,
            published: published.length,
            provider: cls.provider,
            model: cls.model,
            inputTokens: cls.usage.inputTokens,
            outputTokens: cls.usage.outputTokens,
            costUsd: cls.usage.costUsd !== undefined ? cls.usage.costUsd.toFixed(6) : null,
            stats,
          })
          .where(eq(relatedRun.id, runId));
      } catch (err) {
        const units = yt.units - unitsStart;
        report.unitsSpent += units;
        await db
          .update(relatedRun)
          .set({
            status: 'failed',
            finishedAt: new Date(),
            quotaUnits: units,
            error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
            stats,
          })
          .where(eq(relatedRun.id, runId));
        throw err;
      }
    } catch (err) {
      item.action = 'error';
      item.reason = err instanceof Error ? err.message : String(err);
    }
  }
  return report;
}
