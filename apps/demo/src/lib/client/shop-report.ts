/**
 * Relatório do Shopping para o cliente (#930), só no servidor: os cliques que o widget dele (#925) gerou, por jogo,
 * time, loja, widget, produto e dia, no período e nos filtros da tela. Sempre preso ao tenant da sessão: a consulta
 * filtra por `tenant_id`, e só clique de origem `client` tem tenant. Pedidos, vendas e comissão entram com a
 * conciliação das redes (#929); até lá a tela mostra só os cliques.
 */
import { pool } from '@/lib/auth/db';
import { compareAlpha } from '@/lib/alphabetical';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORE = /^[a-z0-9_]{1,40}$/;

export interface ShopReportFilter {
  from: Date;
  to: Date;
  competitionId?: string | undefined;
  teamId?: string | undefined;
  storeId?: string | undefined;
  /** Fuso de quem olha: os dias do relatório e do CSV são os dele, como o período. */
  timeZone: string;
}

/** Fuso IANA conhecido pelo Intl; senão, UTC. */
const zoneOf = (tz: string | undefined) => {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
};

/** Só os filtros em formato válido (vêm da URL). */
export function shopReportFilter(
  period: { from: Date; to: Date; timeZone?: string | undefined },
  raw: { competition?: string | undefined; team?: string | undefined; store?: string | undefined },
): ShopReportFilter {
  return {
    from: period.from,
    to: period.to,
    timeZone: zoneOf(period.timeZone),
    ...(raw.competition && UUID.test(raw.competition) ? { competitionId: raw.competition } : {}),
    ...(raw.team && UUID.test(raw.team) ? { teamId: raw.team } : {}),
    ...(raw.store && STORE.test(raw.store) ? { storeId: raw.store } : {}),
  };
}

export interface ShopReportRow {
  id: string;
  label: string;
  clicks: number;
}

export interface ShopReport {
  total: number;
  byEvent: Array<ShopReportRow & { startsAt: string | null; competition: string | null }>;
  byTeam: ShopReportRow[];
  byStore: ShopReportRow[];
  byWidget: ShopReportRow[];
  topProducts: Array<ShopReportRow & { store: string }>;
  byDay: Array<{ day: string; clicks: number }>;
  /** Opções dos filtros: o que aparece nos cliques do período, em ordem alfabética. */
  options: { competitions: ShopReportRow[]; teams: ShopReportRow[]; stores: ShopReportRow[] };
}

/** Condições comuns (tenant, período e filtros) e os parâmetros na ordem. */
function where(tenantId: string, f: ShopReportFilter, withFilters = true) {
  const params: unknown[] = [tenantId, f.from, f.to];
  const conds = ['c.tenant_id = $1', 'c.clicked_at >= $2', 'c.clicked_at < $3'];
  if (withFilters && f.competitionId) {
    params.push(f.competitionId);
    // o jogo do campeonato ou a página do próprio campeonato (widget sem jogo)
    conds.push(`${COMPETITION} = $${params.length}`);
  }
  if (withFilters && f.teamId) {
    params.push(f.teamId);
    conds.push(`c.entity_kind = 'participant' and c.entity_id = $${params.length}`);
  }
  if (withFilters && f.storeId) {
    params.push(f.storeId);
    conds.push(`c.store_id = $${params.length}`);
  }
  return { sql: conds.join(' and '), params };
}

const FROM = `engage.shop_click c left join core.event e on e.id = c.event_id`;

/** Campeonato do clique: o do jogo ou, na página do campeonato, a própria entidade. */
const COMPETITION = `coalesce(e.competition_id, case when c.entity_kind = 'competition' then c.entity_id end)`;

/** Dia do clique no fuso de quem olha (`$n` = o fuso). */
const DAY = (n: number) => `to_char(c.clicked_at at time zone $${n}, 'YYYY-MM-DD')`;

const n = (v: string | number) => Number(v);

export async function shopClientReport(tenantId: string, f: ShopReportFilter): Promise<ShopReport> {
  const w = where(tenantId, f);
  const all = where(tenantId, f, false);
  const day = [...w.params, f.timeZone];
  // uma conexão só, em sequência: o pool da demo é pequeno e serve também ao login e aos outros painéis
  const client = await pool.connect();
  const q = <T extends object>(sql: string, params = w.params) =>
    client.query<T>(sql, params).then((r) => r.rows);
  const run = async <T extends readonly (() => Promise<unknown>)[]>(fns: T) => {
    const out: unknown[] = [];
    for (const fn of fns) out.push(await fn());
    return out as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
  };
  let results;
  try {
    results = await run([
      () =>
        q<{
          id: string;
          starts_at: Date | null;
          competition: string | null;
          title: string | null;
          clicks: string;
        }>(
          `select c.event_id as id, e.starts_at, co.name as competition,
                (select string_agg(p.name, ' x ' order by (ep.side = 'away')) from core.event_participant ep
                   join core.participant p on p.id = ep.participant_id
                  where ep.event_id = c.event_id and ep.side in ('home', 'away')) as title,
                count(*) as clicks
           from ${FROM} left join core.competition co on co.id = e.competition_id
          where ${w.sql} and c.event_id is not null
          group by c.event_id, e.starts_at, co.name order by count(*) desc, e.starts_at desc limit 20`,
        ),
      () =>
        q<{ id: string; label: string | null; clicks: string }>(
          `select c.entity_id as id, p.name as label, count(*) as clicks
           from ${FROM} left join core.participant p on p.id = c.entity_id
          where ${w.sql} and c.entity_kind = 'participant'
          group by c.entity_id, p.name order by count(*) desc limit 20`,
        ),
      () =>
        q<{ id: string; label: string | null; clicks: string }>(
          `select c.store_id as id, s.name as label, count(*) as clicks
           from ${FROM} left join engage.shop_store s on s.id = c.store_id
          where ${w.sql} group by c.store_id, s.name order by count(*) desc`,
        ),
      () =>
        q<{ id: string | null; label: string | null; clicks: string }>(
          `select c.widget_id as id, wd.name as label, count(*) as clicks
           from ${FROM} left join ops.widget wd on wd.id::text = c.widget_id and wd.tenant_id = c.tenant_id
          where ${w.sql} group by c.widget_id, wd.name order by count(*) desc`,
        ),
      () =>
        q<{ id: string; label: string | null; store: string | null; clicks: string }>(
          `select c.product_id as id, pr.title as label, s.name as store, count(*) as clicks
           from ${FROM} left join engage.shop_product pr on pr.id = c.product_id
                        left join engage.shop_store s on s.id = c.store_id
          where ${w.sql} group by c.product_id, pr.title, s.name order by count(*) desc limit 10`,
        ),
      () =>
        q<{ day: string; clicks: string }>(
          `select ${DAY(day.length)} as day, count(*) as clicks
           from ${FROM} where ${w.sql} group by 1 order by 1`,
          day,
        ),
      () =>
        q<{ id: string; label: string }>(
          `select distinct co.id, co.name as label
           from ${FROM} join core.competition co on co.id = ${COMPETITION} where ${all.sql}`,
          all.params,
        ),
      () =>
        q<{ id: string; label: string }>(
          `select distinct p.id, p.name as label
           from ${FROM} join core.participant p on p.id = c.entity_id
          where ${all.sql} and c.entity_kind = 'participant'`,
          all.params,
        ),
      () =>
        q<{ id: string; label: string | null }>(
          `select distinct c.store_id as id, s.name as label
           from ${FROM} left join engage.shop_store s on s.id = c.store_id where ${all.sql}`,
          all.params,
        ),
    ] as const);
  } finally {
    client.release();
  }
  const [events, teams, stores, widgets, products, days, competitions, teamOptions, storeOptions] = results;
  const row = (r: { id: string | null; label: string | null; clicks?: string }) => ({
    id: r.id ?? '',
    label: r.label ?? r.id ?? '',
    clicks: n(r.clicks ?? 0),
  });
  const alpha = (rows: { id: string | null; label: string | null }[]) =>
    rows.map(row).sort((a, b) => compareAlpha(a.label, b.label));
  const byStore = stores.map(row);
  return {
    total: byStore.reduce((a, s) => a + s.clicks, 0),
    byEvent: events.map((r) => ({
      ...row({ id: r.id, label: r.title, clicks: r.clicks }),
      startsAt: r.starts_at?.toISOString() ?? null,
      competition: r.competition,
    })),
    byTeam: teams.map(row),
    byStore,
    // widget apagado: sem nome (a tela mostra "Widget removido"), nunca o id solto
    byWidget: widgets.map((r) => ({ ...row(r), label: r.label ?? '' })),
    topProducts: products.map((r) => ({ ...row(r), store: r.store ?? '' })),
    byDay: days.map((r) => ({ day: r.day, clicks: n(r.clicks) })),
    options: { competitions: alpha(competitions), teams: alpha(teamOptions), stores: alpha(storeOptions) },
  };
}

/** Uma linha por clique agrupado (dia × jogo × time × loja × widget × produto), para o CSV. */
export async function shopClientReportRows(tenantId: string, f: ShopReportFilter, limit = 20_000) {
  const w = where(tenantId, f);
  const params = [...w.params, f.timeZone];
  const { rows } = await pool.query<{
    day: string;
    event: string | null;
    competition: string | null;
    team: string | null;
    store: string | null;
    widget: string | null;
    product: string | null;
    clicks: string;
  }>(
    `select ${DAY(params.length)} as day,
            (select string_agg(p.name, ' x ' order by (ep.side = 'away')) from core.event_participant ep
               join core.participant p on p.id = ep.participant_id
              where ep.event_id = c.event_id and ep.side in ('home', 'away')) as event,
            co.name as competition, tp.name as team, s.name as store, wd.name as widget, pr.title as product,
            count(*) as clicks
       from ${FROM}
       left join core.competition co on co.id = ${COMPETITION}
       left join core.participant tp on c.entity_kind = 'participant' and tp.id = c.entity_id
       left join engage.shop_store s on s.id = c.store_id
       left join ops.widget wd on wd.id::text = c.widget_id and wd.tenant_id = c.tenant_id
       left join engage.shop_product pr on pr.id = c.product_id
      where ${w.sql}
      group by 1, c.event_id, co.name, tp.name, s.name, wd.name, pr.title
      order by 1, count(*) desc
      limit ${Math.max(1, Math.min(50_000, Math.floor(limit)))}`,
    params,
  );
  return rows.map((r) => ({ ...r, clicks: n(r.clicks) }));
}

const cell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  // fórmula no início vira texto (planilha não executa), aspas dobradas
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replaceAll('"', '""')}"`;
};

/** CSV com cabeçalho no idioma da tela. */
export function shopReportCsv(
  header: readonly string[],
  rows: Awaited<ReturnType<typeof shopClientReportRows>>,
): string {
  const lines = [header.map(cell).join(',')];
  for (const r of rows)
    lines.push(
      [r.day, r.event, r.competition, r.team, r.store, r.widget, r.product, r.clicks].map(cell).join(','),
    );
  return `${lines.join('\n')}\n`;
}
