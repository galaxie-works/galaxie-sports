'use server';

/**
 * "Mostrar mais antigos" do extrato da Cosmos (#995): a próxima página, com o período e os filtros da tela. O
 * tenant sai da sessão, nunca do navegador.
 */
import { readClientContext } from '@/lib/client/session';
import { getRequestLocale, getTimeZone } from '@/lib/i18n/server';

import { cosmosAccessError } from './config';
import { loadStatementPage, type StatementParams } from './data';

/** Sem `cosmos.view` (#1019), nada volta: a tela trata null como "sem mais linhas". */
export async function olderCosmosEntries(params: StatementParams) {
  const ctx = await readClientContext();
  if (cosmosAccessError(ctx, 'cosmos.view') || !ctx?.tenant) return null;
  return loadStatementPage(ctx.tenant.id, params, await getTimeZone(await getRequestLocale()));
}
