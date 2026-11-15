/**
 * Extrato da Cosmos AI em CSV (#992, #995): o período e os filtros da tela, só do tenant da sessão e na visão
 * do cliente (sem tokens, custo real nem modelo). Os dias do período são os do fuso de quem olha, como na tela.
 */
import { ledgerCsv, listLedger, type LedgerEntry } from '@galaxie/cosmos';
import { LEDGER_KINDS, type LedgerKind } from '@galaxie/db/schema';

import { builderDb } from '@/lib/builder/store';
import { readClientContext } from '@/lib/client/session';
import { cosmosAccessError } from '@/lib/cosmos/config';
import { periodFrom } from '@/lib/cosmos/data-utils';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale, getTimeZone } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

/** Teto de linhas por exportação (de 500 em 500). */
const MAX_ROWS = 20_000;

const isKind = (v: string): v is LedgerKind => (LEDGER_KINDS as readonly string[]).includes(v);

export async function GET(request: Request) {
  const ctx = await readClientContext();
  const locale = await getRequestLocale();
  const t = getDictionary(locale);
  if (!ctx) return Response.json({ title: t.common.unauthorized }, { status: 401 });
  if (!ctx.tenant) return Response.json({ title: t.common.forbidden }, { status: 403 });
  // o extrato é dinheiro do tenant: só quem tem `cosmos.view` no cargo (#1019)
  if (cosmosAccessError(ctx, 'cosmos.view'))
    return Response.json({ title: t.cosmos.checkout.errors.viewNotAllowed }, { status: 403 });

  const url = new URL(request.url);
  const period = periodFrom(
    { from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') ?? undefined },
    new Date(),
    await getTimeZone(locale),
  );
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

  // cortado no teto: a última linha avisa, para ninguém achar que o extrato acabou ali
  const note = fill(t.cosmos.usage.csvTruncated, { max: MAX_ROWS });
  const csv =
    cursor || rows.length > MAX_ROWS
      ? `${ledgerCsv(rows.slice(0, MAX_ROWS))}"${note.replaceAll('"', '""')}"\n`
      : ledgerCsv(rows);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="cosmos-extrato-${period.fromDay}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
