'use server';

/**
 * "Mostrar mais antigos" do extrato da Cosmos (#995): a próxima página, com o período e os filtros da tela. O
 * tenant sai da sessão, nunca do navegador.
 */
import { readClientContext } from '@/lib/client/session';
import { getRequestLocale, getTimeZone } from '@/lib/i18n/server';

import { loadStatementPage, type StatementParams } from './data';

export async function olderCosmosEntries(params: StatementParams) {
  const ctx = await readClientContext();
  if (!ctx?.tenant) return null;
  return loadStatementPage(ctx.tenant.id, params, await getTimeZone(await getRequestLocale()));
}
