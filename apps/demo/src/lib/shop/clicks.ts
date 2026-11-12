/**
 * Painel interno de cliques do Shopping (#921), só no servidor: os últimos 30 dias por loja, por dia e os jogos que
 * mais renderam clique. Lê `engage.shop_click` (#918), que não guarda dado pessoal nenhum.
 */
import { pool } from '@/lib/auth/db';

export const SHOP_CLICK_DAYS = 30;

export interface ShopClickSummary {
  total: number;
  byStore: Array<{ storeId: string; storeName: string; clicks: number }>;
  byDay: Array<{ day: string; clicks: number }>;
  topEvents: Array<{ eventId: string; title: string; startsAt: string | null; clicks: number }>;
  byOrigin: Array<{ origin: string; clicks: number }>;
}

export async function shopClickSummary(days = SHOP_CLICK_DAYS): Promise<ShopClickSummary> {
  const since = `now() - make_interval(days => ${Math.max(1, Math.min(90, Math.floor(days)))})`;
  const [stores, perDay, events, origins] = await Promise.all([
    pool.query<{ store_id: string; name: string | null; clicks: string }>(
      `select c.store_id, s.name, count(*) as clicks
         from engage.shop_click c left join engage.shop_store s on s.id = c.store_id
        where c.clicked_at >= ${since}
        group by c.store_id, s.name order by count(*) desc, c.store_id`,
    ),
    pool.query<{ day: string; clicks: string }>(
      `select to_char(date_trunc('day', clicked_at), 'YYYY-MM-DD') as day, count(*) as clicks
         from engage.shop_click where clicked_at >= ${since}
        group by 1 order by 1`,
    ),
    pool.query<{ event_id: string; title: string | null; starts_at: Date | null; clicks: string }>(
      `select c.event_id, e.starts_at,
              (select string_agg(p.name, ' x ' order by ep.side) from core.event_participant ep
                 join core.participant p on p.id = ep.participant_id
                where ep.event_id = c.event_id and ep.side in ('home', 'away')) as title,
              count(*) as clicks
         from engage.shop_click c left join core.event e on e.id = c.event_id
        where c.clicked_at >= ${since} and c.event_id is not null
        group by c.event_id, e.starts_at order by count(*) desc limit 10`,
    ),
    pool.query<{ origin: string; clicks: string }>(
      `select origin, count(*) as clicks from engage.shop_click where clicked_at >= ${since}
        group by origin order by count(*) desc`,
    ),
  ]);
  const byStore = stores.rows.map((r) => ({
    storeId: r.store_id,
    storeName: r.name ?? r.store_id,
    clicks: Number(r.clicks),
  }));
  return {
    total: byStore.reduce((a, s) => a + s.clicks, 0),
    byStore,
    byDay: perDay.rows.map((r) => ({ day: r.day, clicks: Number(r.clicks) })),
    topEvents: events.rows.map((r) => ({
      eventId: r.event_id,
      title: r.title ?? r.event_id,
      startsAt: r.starts_at?.toISOString() ?? null,
      clicks: Number(r.clicks),
    })),
    byOrigin: origins.rows.map((r) => ({ origin: r.origin, clicks: Number(r.clicks) })),
  };
}
