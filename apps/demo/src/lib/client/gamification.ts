/**
 * Gamificação no painel do cliente (#917), só no servidor: os programas por país, as Conquistas do Catálogo no
 * programa escolhido e o resumo. Tudo com o tenant da sessão (um id de outro cliente não acha nada).
 */
import { createDb, type Database } from '@galaxie/db/client';
import {
  gameProgramReport,
  listGameCatalog,
  listGamePrograms,
  type GameCatalogItemView,
  type GameProgramReport,
  type GameProgramView,
} from '@galaxie/db/game';

declare global {
  var __galaxieGameDb: Database | undefined;
}

const url = process.env.DEMO_DATABASE_URL ?? process.env.DATABASE_URL;

/** Conexão do painel da Gamificação (uma por processo; o dev server recarrega módulos). */
export function gameDb(): Database {
  if (!url) throw new Error('DEMO_DATABASE_URL/DATABASE_URL não definido: a Gamificação precisa do banco.');
  globalThis.__galaxieGameDb ??= createDb(url, {
    max: 2,
    profile: 'api',
    applicationName: 'galaxie-demo-gamification',
  });
  return globalThis.__galaxieGameDb;
}

export type { GameCatalogItemView, GameProgramReport, GameProgramView };

export interface GamificationOverview {
  programs: GameProgramView[];
  /** País do programa aberto (o pedido, senão o principal ativo, senão o primeiro ativo). */
  selected: string | null;
  catalog: GameCatalogItemView[];
  report: GameProgramReport | null;
}

export async function gamificationOverview(
  tenantId: string,
  country?: string,
): Promise<GamificationOverview> {
  const db = gameDb();
  const programs = await listGamePrograms(db, tenantId);
  const active = programs.filter((p) => p.active);
  const selected =
    active.find((p) => p.country === country)?.country ??
    active.find((p) => p.primary)?.country ??
    active[0]?.country ??
    null;
  if (!selected) return { programs, selected: null, catalog: [], report: null };
  const key = { tenantId, programCountry: selected };
  const [catalog, report] = await Promise.all([listGameCatalog(db, key), gameProgramReport(db, key)]);
  return { programs, selected, catalog, report };
}
