import { randomUUID } from 'node:crypto';
import { runMigrations } from '@galaxie/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuthTestDb, type AuthTestDb } from './support/auth-db';

/*
 * Relatório do Shopping no painel do cliente (#930): só os cliques do widget do próprio tenant, com os filtros da
 * tela, e o CSV sem fórmula de planilha.
 */

let db: AuthTestDb;
let report: typeof import('../src/lib/client/shop-report');
const T1 = randomUUID();
const T2 = randomUUID();
const W1 = randomUUID();
const productA = randomUUID();
const productB = randomUUID();
const team = randomUUID();
const now = Date.now();
const period = { from: new Date(now - 7 * 86_400_000), to: new Date(now + 86_400_000) };

beforeAll(async () => {
  db = await createAuthTestDb();
  await runMigrations(process.env.DEMO_DATABASE_URL!);
  report = await import('../src/lib/client/shop-report');
  await db.sql.query(
    `insert into engage.shop_store (id, name, country, network, active, updated_by)
     values ('loja_a', 'Loja A', 'BR', 'awin', true, 'teste'), ('loja_b', '=Loja B', 'BR', 'awin', true, 'teste')`,
  );
  const click = (tenant: string | null, store: string, product: string, entity: string, ago = 0) =>
    db.sql.query(
      `insert into engage.shop_click (clicked_at, entity_kind, entity_id, product_id, store_id, origin, tenant_id, widget_id)
       values (now() - make_interval(hours => $1), 'participant', $2, $3, $4, $5, $6, $7)`,
      [ago, entity, product, store, tenant ? 'client' : 'galaxie_site', tenant, tenant ? W1 : null],
    );
  await click(T1, 'loja_a', productA, team);
  await click(T1, 'loja_a', productA, team, 30);
  await click(T1, 'loja_b', productB, randomUUID());
  await click(T2, 'loja_a', productA, team);
  await click(null, 'loja_a', productA, team);
  // fora do período
  await click(T1, 'loja_a', productA, team, 24 * 30);
}, 120_000);

afterAll(async () => {
  await db?.drop();
});

describe('relatório do Shopping do cliente (#930)', () => {
  it('só os cliques do tenant, no período', async () => {
    const r = await report.shopClientReport(T1, report.shopReportFilter(period, {}));
    expect(r.total).toBe(3);
    expect(r.byStore.map((s) => [s.id, s.clicks])).toEqual([
      ['loja_a', 2],
      ['loja_b', 1],
    ]);
    expect(r.byWidget).toEqual([{ id: W1, label: '', clicks: 3 }]);
    expect(r.options.stores.map((s) => s.label)).toEqual(['=Loja B', 'Loja A']);
    expect((await report.shopClientReport(T2, report.shopReportFilter(period, {}))).total).toBe(1);
  });

  it('filtros de loja e time; filtro fora do formato é ignorado', async () => {
    const byStore = await report.shopClientReport(T1, report.shopReportFilter(period, { store: 'loja_b' }));
    expect(byStore.total).toBe(1);
    const byTeam = await report.shopClientReport(T1, report.shopReportFilter(period, { team }));
    expect(byTeam.total).toBe(2);
    expect(report.shopReportFilter(period, { team: 'x', store: "a'; drop" })).toEqual(period);
    // as opções seguem com tudo do período (o filtro não esconde as outras escolhas)
    expect(byStore.options.stores).toHaveLength(2);
  });

  it('CSV: uma linha por grupo, sem fórmula de planilha', async () => {
    const rows = await report.shopClientReportRows(T1, report.shopReportFilter(period, {}));
    expect(rows.reduce((a, r) => a + r.clicks, 0)).toBe(3);
    const csv = report.shopReportCsv(
      ['Dia', 'Jogo', 'Comp', 'Time', 'Loja', 'Widget', 'Produto', 'Cliques'],
      rows,
    );
    expect(csv.split('\n')[0]).toBe('"Dia","Jogo","Comp","Time","Loja","Widget","Produto","Cliques"');
    expect(csv).toContain(`"'=Loja B"`);
    expect(csv).not.toContain(T2);
  });
});
