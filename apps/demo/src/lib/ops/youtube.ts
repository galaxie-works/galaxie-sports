/**
 * Cota do YouTube do Conteúdo relacionado no painel de Operação: o orçamento do dia de cota que o `related:run`
 * grava em `enrich.related_budget` (dois baldes: busca em consultas, com a reserva para os jogos que ainda vão
 * acontecer, e geral em unidades), o rendimento por competição dos últimos 14 dias e os jogos pulados por cota.
 * Sem as tabelas (migration 0039 pendente), null: o resto do painel continua.
 */
import { pool } from '@/lib/auth/db';

import type { OpsSetting, YoutubeSnapshot } from './types';

const YIELD_DAYS = 14;

/** Dia de cota do YouTube (meia-noite do Pacífico), YYYY-MM-DD. */
export function youtubeQuotaDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

const intSetting = (settings: OpsSetting[], key: string, fallback: number) => {
  const raw = settings.find((s) => s.key === key)?.value ?? null;
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export async function readYoutube(now: Date, settings: OpsSetting[]): Promise<YoutubeSnapshot | null> {
  const quotaDay = youtubeQuotaDay(now);
  try {
    const [budget, used, yields, channels] = await Promise.all([
      pool.query<{
        search_limit: number;
        search_used: number;
        search_reserved: number;
        api_limit: number;
        api_used: number;
        skipped: YoutubeSnapshot['skipped'];
        updated_at: Date;
      }>('select * from enrich.related_budget where quota_day = $1', [quotaDay]),
      pool.query<{ search: string | null; api: string | null }>(
        'select sum(searches)::text as search, sum(api_units)::text as api from enrich.related_run where quota_day = $1',
        [quotaDay],
      ),
      pool.query<{
        slug: string;
        games: number;
        searches: string;
        api_units: string;
        search_videos: number;
        channel_videos: number;
      }>(
        `with runs as (
           select e.competition_id, count(distinct r.event_id) filter (where r.mode = 'full')::int as games,
                  sum(r.searches) as searches, sum(r.api_units) as api_units
             from enrich.related_run r join core.event e on e.id = r.event_id
            where r.started_at >= now() - make_interval(days => $1) group by e.competition_id
         ), vids as (
           select e.competition_id,
                  (count(*) filter (where exists (select 1 from unnest(rc.queries) q where q not like 'channel:%')))::int as search_videos,
                  (count(*) filter (where exists (select 1 from unnest(rc.queries) q where q like 'channel:%')))::int as channel_videos
             from enrich.related_content rc join core.event e on e.id = rc.event_id
            where rc.superseded_by is null and rc.status = 'published'
              and rc.first_seen_at >= now() - make_interval(days => $1)
            group by e.competition_id
         )
         select c.slug, runs.games, runs.searches::text, runs.api_units::text,
                coalesce(vids.search_videos, 0) as search_videos, coalesce(vids.channel_videos, 0) as channel_videos
           from runs join core.competition c on c.id = runs.competition_id
           left join vids on vids.competition_id = runs.competition_id
          order by runs.searches desc, c.slug limit 40`,
        [YIELD_DAYS],
      ),
      pool.query<{ kind: string; n: number }>(
        'select kind, count(distinct channel_id)::int as n from enrich.related_channel where active group by kind',
      ),
    ]);
    const b = budget.rows[0];
    const keep = 1 - intSetting(settings, 'YOUTUBE_QUOTA_RESERVE_PERCENT', 10) / 100;
    const count = (kind: string) => channels.rows.find((r) => r.kind === kind)?.n ?? 0;
    return {
      quotaDay,
      updatedAt: b ? new Date(b.updated_at).toISOString() : null,
      search: {
        limit: b?.search_limit ?? Math.floor(intSetting(settings, 'YOUTUBE_SEARCH_DAILY_QUOTA', 100) * keep),
        used: Math.max(b?.search_used ?? 0, Number(used.rows[0]?.search ?? 0)),
        reserved: b?.search_reserved ?? 0,
      },
      api: {
        limit: b?.api_limit ?? Math.floor(intSetting(settings, 'YOUTUBE_DAILY_QUOTA', 10_000) * keep),
        used: Math.max(b?.api_used ?? 0, Number(used.rows[0]?.api ?? 0)),
      },
      channels: { club: count('club'), competition: count('competition'), broadcaster: count('broadcaster') },
      yields: yields.rows.map((r) => ({
        slug: r.slug,
        games: Number(r.games),
        searches: Number(r.searches ?? 0),
        apiUnits: Number(r.api_units ?? 0),
        searchVideos: Number(r.search_videos),
        channelVideos: Number(r.channel_videos),
      })),
      skipped: (b?.skipped ?? []).slice(0, 50),
    };
  } catch (err) {
    const code = (err as { code?: string }).code;
    // tabela ou coluna da 0039 ainda não existe
    if (code === '42P01' || code === '42703') return null;
    throw err;
  }
}
