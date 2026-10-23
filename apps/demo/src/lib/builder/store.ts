/**
 * Widgets e chaves publicáveis no banco (só no servidor), pelas funções de `@galaxie/db` (tabelas
 * `ops.widget` e `ops.publishable_key`, docs/05 §1.3). A demo fala com o Postgres pelo `pg` (auth,
 * revisão, operação); estas funções usam o cliente Drizzle do pacote, com um pool pequeno só para elas.
 */
import { createDb, type Database } from '@galaxie/db/client';

export {
  archiveWidget,
  createPublishableKey,
  getWidget,
  listPublishableKeys,
  listWidgets,
  normalizeAllowedOrigin,
  revokePublishableKey,
  saveWidget,
} from '@galaxie/db/widgets';

declare global {
  var __galaxieBuilderDb: Database | undefined;
}

const url = process.env.DEMO_DATABASE_URL ?? process.env.DATABASE_URL;

/** Conexão que as funções acima recebem como primeiro argumento (uma por processo; o dev server recarrega módulos). */
export function builderDb(): Database {
  if (!url) throw new Error('DEMO_DATABASE_URL/DATABASE_URL não definido: o Builder precisa do banco.');
  globalThis.__galaxieBuilderDb ??= createDb(url, { max: 3 });
  return globalThis.__galaxieBuilderDb;
}
