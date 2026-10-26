import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NO_REVIEW_FILTERS, type ReviewFilters } from './types';

// o store fala direto com o Postgres: aqui o pool é falso e só registra o SQL e os parâmetros
const calls: { sql: string; params: unknown[] }[] = [];
vi.mock('@/lib/auth/db', () => ({
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: sql.includes('count(*)::int as n from x') ? [{ n: 1081 }] : [] };
    }),
  },
}));

const { listReviewItems } = await import('./store');

const WORDS = {} as Parameters<typeof listReviewItems>[1];
const f = (over: Partial<ReviewFilters>): ReviewFilters => ({ ...NO_REVIEW_FILTERS, ...over });
/** A consulta da página (a única com `limit`). */
const pageQuery = () => calls.find((c) => /\blimit \$\d+ offset \$\d+/.test(c.sql))!;

beforeEach(() => {
  calls.length = 0;
});

describe('lista da revisão: limite e deslocamento', () => {
  it('padrão: 50 itens a partir do começo', async () => {
    const out = await listReviewItems(f({}), WORDS);
    expect(out.total).toBe(1081);
    const q = pageQuery();
    expect(q.sql).toMatch(/limit \$1 offset \$2/);
    expect(q.params).toEqual([50, 0]);
  });

  it('usa o tamanho pedido e desloca pela página', async () => {
    await listReviewItems(f({ page: 3, per: 100 }), WORDS);
    expect(pageQuery().params).toEqual([100, 200]);
    calls.length = 0;
    await listReviewItems(f({ page: 2, per: 500 }), WORDS);
    expect(pageQuery().params).toEqual([500, 500]);
  });

  it('limite e deslocamento vêm depois dos parâmetros dos filtros', async () => {
    await listReviewItems(
      f({ kind: ['team', 'derby'], market: ['BR'], state: ['draft'], q: '50%', page: 2, per: 25 }),
      WORDS,
    );
    const q = pageQuery();
    expect(q.sql).toContain('kind = any($1)');
    expect(q.sql).toContain('market = any($2)');
    expect(q.sql).toContain('state = any($3)');
    expect(q.sql).toMatch(/limit \$5 offset \$6/);
    expect(q.params).toEqual([['team', 'derby'], ['BR'], ['draft'], '%50\\%%', 25, 25]);
  });

  it('as contagens por status não levam o filtro de status nem a página', async () => {
    await listReviewItems(f({ sport: ['football'], state: ['approved'], page: 4, per: 250 }), WORDS);
    const counts = calls.find((c) => c.sql.includes('group by state'))!;
    expect(counts.sql).not.toContain('state = any');
    expect(counts.sql).not.toMatch(/\blimit\b/);
    expect(counts.params).toEqual([['football']]);
  });
});
