/**
 * Extrato da carteira: lista paginada (do mais novo ao mais antigo) e filtrável por data, sala, função,
 * usuário e tipo, mais a exportação em CSV. Tokens, custo real e modelo são só da equipe Galaxie: a visão
 * do cliente (`toClientEntry`, CSV sem `staff`) sai sem eles.
 */
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
// subcaminhos, não o índice: o índice traz o migrator (pasta drizzle/), que o bundler do Next não resolve
import type { Database } from '@galaxie/db/client';
import { ledger, type LedgerKind } from '@galaxie/db/schema';

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  credits: number;
  balanceBefore: number;
  balanceAfter: number;
  functionName: string | null;
  scope: string | null;
  userId: string | null;
  note: string | null;
  createdAt: Date;
  tokensIn: number | null;
  tokensCached: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  model: string | null;
}

/** O que o cliente vê de um lançamento: sem tokens, custo técnico nem modelo. */
export type ClientLedgerEntry = Omit<
  LedgerEntry,
  'tokensIn' | 'tokensCached' | 'tokensOut' | 'costUsd' | 'model'
>;

export function toClientEntry(e: LedgerEntry): ClientLedgerEntry {
  const { tokensIn: _a, tokensCached: _b, tokensOut: _c, costUsd: _d, model: _e, ...rest } = e;
  return rest;
}

export interface LedgerFilter {
  /** A partir de (inclusive). */
  from?: Date;
  /** Até (exclusive). */
  to?: Date;
  scope?: string;
  functionName?: string;
  /** Vários valores (barra de filtros): qualquer um deles. */
  scopes?: readonly string[];
  functionNames?: readonly string[];
  userId?: string;
  kinds?: readonly LedgerKind[];
  /** Cursor: o `nextCursor` da página anterior. */
  cursor?: string;
  /** Padrão 50, no máximo 500. */
  limit?: number;
}

export const LEDGER_PAGE_MAX = 500;

export async function listLedger(
  db: Pick<Database, 'select'>,
  tenantId: string,
  filter: LedgerFilter = {},
): Promise<{ entries: LedgerEntry[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(1, Math.trunc(filter.limit ?? 50)), LEDGER_PAGE_MAX);
  const where: SQL[] = [eq(ledger.tenantId, tenantId)];
  if (filter.from) where.push(gte(ledger.createdAt, filter.from));
  if (filter.to) where.push(lt(ledger.createdAt, filter.to));
  if (filter.scope) where.push(eq(ledger.scope, filter.scope));
  if (filter.functionName) where.push(eq(ledger.functionName, filter.functionName));
  if (filter.scopes?.length) where.push(inArray(ledger.scope, [...filter.scopes]));
  if (filter.functionNames?.length) where.push(inArray(ledger.functionName, [...filter.functionNames]));
  if (filter.userId) where.push(eq(ledger.userId, filter.userId));
  if (filter.kinds?.length) where.push(inArray(ledger.kind, [...filter.kinds]));
  // id em UUID v7: ordem do id = ordem de criação, e o cursor é o último id da página
  if (filter.cursor) where.push(lt(ledger.id, filter.cursor));

  const rows = await db
    .select({
      id: ledger.id,
      kind: ledger.kind,
      credits: ledger.credits,
      balanceBefore: ledger.balanceBefore,
      balanceAfter: ledger.balanceAfter,
      functionName: ledger.functionName,
      scope: ledger.scope,
      userId: ledger.userId,
      note: ledger.note,
      createdAt: ledger.createdAt,
      tokensIn: ledger.tokensIn,
      tokensCached: ledger.tokensCached,
      tokensOut: ledger.tokensOut,
      costUsd: ledger.costUsd,
      model: ledger.model,
    })
    .from(ledger)
    .where(and(...where))
    .orderBy(desc(ledger.id))
    .limit(limit + 1);
  const entries = rows.slice(0, limit);
  return { entries, nextCursor: rows.length > limit ? entries[entries.length - 1]!.id : null };
}

const CLIENT_COLUMNS = [
  'created_at',
  'kind',
  'scope',
  'function',
  'user',
  'credits',
  'balance_before',
  'balance_after',
  'note',
] as const;
const STAFF_COLUMNS = ['tokens_in', 'tokens_cached', 'tokens_out', 'cost_usd', 'model'] as const;

function cell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  // aspas, vírgula, quebra de linha; e fórmula no começo (=, +, -, @) não vira fórmula na planilha
  const safe = /^[=+\-@\t\r]/.test(text) && typeof value === 'string' ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * CSV do extrato (cabeçalho em inglês, como o resto da superfície pública). `staff` acrescenta tokens,
 * custo real e modelo, que o cliente nunca vê.
 */
export function ledgerCsv(entries: readonly LedgerEntry[], options: { staff?: boolean } = {}): string {
  const header = [...CLIENT_COLUMNS, ...(options.staff ? STAFF_COLUMNS : [])];
  const lines = entries.map((e) => {
    const base = [
      e.createdAt.toISOString(),
      e.kind,
      e.scope,
      e.functionName,
      e.userId,
      e.credits,
      e.balanceBefore,
      e.balanceAfter,
      e.note,
    ];
    const staff = options.staff ? [e.tokensIn, e.tokensCached, e.tokensOut, e.costUsd, e.model] : [];
    return [...base, ...staff].map(cell).join(',');
  });
  return [header.join(','), ...lines].join('\n') + '\n';
}

export interface UsagePeriod {
  from: Date;
  /** Exclusive. */
  to: Date;
  /** Fuso IANA dos dias do gráfico (o de quem olha); padrão UTC. */
  timeZone?: string;
}

const usageWhere = (tenantId: string, period: UsagePeriod) =>
  and(
    eq(ledger.tenantId, tenantId),
    eq(ledger.kind, 'usage'),
    gte(ledger.createdAt, period.from),
    lt(ledger.createdAt, period.to),
  );

/** Créditos usados por dia (UTC) e por sala no período; dia sem uso não aparece. */
export async function usageByDay(
  db: Pick<Database, 'select'>,
  tenantId: string,
  period: UsagePeriod,
): Promise<{ day: string; scope: string | null; credits: number }[]> {
  const day = sql<string>`to_char(date_trunc('day', ${ledger.createdAt} at time zone ${period.timeZone ?? 'UTC'}), 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day, scope: ledger.scope, credits: sql<string>`-sum(${ledger.credits})` })
    .from(ledger)
    .where(usageWhere(tenantId, period))
    // pela posição da coluna: com o fuso como parâmetro, o Postgres não reconhece a mesma expressão no group by
    .groupBy(sql`1`, ledger.scope)
    .orderBy(sql`1`);
  return rows.map((r) => ({ day: r.day, scope: r.scope, credits: Number(r.credits) }));
}

export interface UsageSlice {
  key: string | null;
  credits: number;
  calls: number;
}

/** Uso no período por usuário, por função e por sala (maior primeiro). Sem tokens nem custo. */
export async function usageBreakdown(
  db: Pick<Database, 'select'>,
  tenantId: string,
  period: UsagePeriod,
): Promise<{ byUser: UsageSlice[]; byFunction: UsageSlice[]; byScope: UsageSlice[] }> {
  const by = async (column: typeof ledger.userId | typeof ledger.functionName | typeof ledger.scope) => {
    const rows = await db
      .select({
        key: column,
        credits: sql<string>`-sum(${ledger.credits})`,
        calls: sql<number>`count(*)::int`,
      })
      .from(ledger)
      .where(usageWhere(tenantId, period))
      .groupBy(column)
      .orderBy(sql`2 desc`);
    return rows.map((r) => ({ key: r.key, credits: Number(r.credits), calls: Number(r.calls) }));
  };
  const [byUser, byFunction, byScope] = await Promise.all([
    by(ledger.userId),
    by(ledger.functionName),
    by(ledger.scope),
  ]);
  return { byUser, byFunction, byScope };
}
