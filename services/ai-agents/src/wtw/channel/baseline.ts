/**
 * Linha de base do canal do jogo (`wtw:channel --linha-de-base`): jogos de futebol encerrados nos
 * últimos N dias, em competições do próprio mercado, com
 *   - opção gravada no país (confirmed ou probable, versão vigente) — a medida usada até aqui, que conta
 *     o detentor "a confirmar" como canal;
 *   - canal do jogo de fato: opção publicada (`confirmed` — fonte do jogo, correção editorial ou direito
 *     que garante o jogo; o detentor "a confirmar" é `probable`) ou enrich.match_channel confirmado.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';

export interface BaselineRow {
  country: string;
  competition: string | null;
  total: number;
  withOption: number;
  withMatchChannel: number;
}

export async function channelBaseline(
  db: Database,
  opts: { now: Date; days: number; markets: string[]; byCompetition?: boolean },
): Promise<BaselineRow[]> {
  if (!opts.markets.length) return [];
  const since = new Date(opts.now.getTime() - opts.days * 86_400_000).toISOString();
  const byComp = opts.byCompetition ?? false;
  const rows = await db.execute<{
    country: string;
    competition: string | null;
    total: string;
    with_option: string;
    with_match_channel: string;
  }>(sql`
    select c.country_code as country,
           ${byComp ? sql`c.slug` : sql`null::text`} as competition,
           count(*) as total,
           count(*) filter (where exists (
             select 1 from enrich.broadcast_option bo
              where bo.event_id = e.id and bo.country_code = c.country_code and bo.superseded_by is null
                and bo.status in ('confirmed', 'probable'))) as with_option,
           count(*) filter (where exists (
             select 1 from enrich.broadcast_option bo
              where bo.event_id = e.id and bo.country_code = c.country_code and bo.superseded_by is null
                and bo.status = 'confirmed')
             or exists (
             select 1 from enrich.match_channel mc
              where mc.event_id = e.id and mc.country_code = c.country_code and mc.status = 'confirmed'))
             as with_match_channel
      from core.event e
      join core.competition c on c.id = e.competition_id
     where c.sport = 'football' and e.status = 'finished'
       and e.starts_at >= ${since}::timestamptz and e.starts_at <= ${opts.now.toISOString()}::timestamptz
       and c.country_code in (${sql.join(
         opts.markets.map((m) => sql`${m}`),
         sql`, `,
       )})
     group by 1, 2
     order by 1, 3 desc`);
  return rows.map((r) => ({
    country: r.country,
    competition: r.competition,
    total: Number(r.total),
    withOption: Number(r.with_option),
    withMatchChannel: Number(r.with_match_channel),
  }));
}
