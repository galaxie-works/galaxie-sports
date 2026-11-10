/**
 * Extrato da Cosmos AI em CSV (#992, #995): o período e os filtros da tela, só do tenant da sessão e na visão
 * do cliente (sem tokens, custo real nem modelo).
 */
import { ledgerCsv, listLedger, type LedgerEntry } from '@galaxie/cosmos';
import { LEDGER_KINDS, type LedgerKind } from '@galaxie/db/schema';

import { builderDb } from '@/lib/builder/store';
import { readClientContext } from '@/lib/client/session';
import { periodFrom } from '@/lib/cosmos/data-utils';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

/** Teto de linhas por exportação (de 500 em 500). */
const MAX_ROWS = 20_000;

const isKind = (v: string): v is LedgerKind => (LEDGER_KINDS as readonly string[]).includes(v);

export async function GET(request: Request) {
  const ctx = await readClientContext();
  const t = getDictionary(await getRequestLocale()).common;
  if (!ctx) return Response.json({ title: t.unauthorized }, { status: 401 });
  if (!ctx.tenant) return Response.json({ title: t.forbidden }, { status: 403 });

  const url = new URL(request.url);
  const period = periodFrom({
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  });
  const filter = {
    from: period.from,
    to: period.to,
    kinds: url.searchParams.getAll('kind').filter(isKind),
    functionNames: url.searchParams.getAll('fn'),
    scopes: url.searchParams.getAll('scope'),
    limit: 500,
  };
  const db = builderDb();
  const rows: LedgerEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await listLedger(db, ctx.tenant.id, { ...filter, ...(cursor ? { cursor } : {}) });
    rows.push(...page.entries);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && rows.length < MAX_ROWS);

  const name = `cosmos-extrato-${period.from.toISOString().slice(0, 10)}.csv`;
  return new Response(ledgerCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    },
  });
}
