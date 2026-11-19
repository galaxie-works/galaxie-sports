/**
 * Gamificação no painel do cliente (#917), só no servidor: os programas por país, as Conquistas do Catálogo no
 * programa escolhido e o resumo. Tudo com o tenant da sessão (um id de outro cliente não acha nada).
 */
import { createDb, type Database } from '@galaxie/db/client';
import {
  fanNicknames,
  listFraudSignals,
  listProfileFreezes,
  type FraudSignalView,
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
  /** Antifraude (#934): os alertas abertos e os Perfis congelados do cliente, com o apelido. */
  fraud: {
    signals: (Omit<FraudSignalView, 'createdAt' | 'reviewedAt'> & { createdAt: string })[];
    frozen: { programCountry: string; profileId: string; frozenBy: 'galaxie' | 'team'; frozenAt: string }[];
    nicknames: Record<string, string | null>;
  };
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
  const fraud = await fraudOverview(db, tenantId);
  if (!selected) return { programs, selected: null, catalog: [], report: null, fraud };
  const key = { tenantId, programCountry: selected };
  const [catalog, report] = await Promise.all([listGameCatalog(db, key), gameProgramReport(db, key)]);
  return { programs, selected, catalog, report, fraud };
}

async function fraudOverview(db: Database, tenantId: string): Promise<GamificationOverview['fraud']> {
  const [signals, frozen] = await Promise.all([
    listFraudSignals(db, { tenantId, status: 'open', limit: 50 }),
    listProfileFreezes(db, tenantId),
  ]);
  const ids = [...signals.flatMap((s) => s.profileIds), ...frozen.map((f) => f.profileId)];
  const names = await fanNicknames(db, tenantId, ids);
  return {
    signals: signals.map(({ createdAt, reviewedAt: _r, ...s }) => ({
      ...s,
      createdAt: createdAt.toISOString(),
    })),
    frozen: frozen.map((f) => ({
      programCountry: f.programCountry,
      profileId: f.profileId,
      // o id interno de quem congelou não vai ao navegador: só se foi a equipe Galaxie ou a do cliente
      frozenBy: f.frozenBy.startsWith('galaxie:') ? 'galaxie' : 'team',
      frozenAt: f.frozenAt.toISOString(),
    })),
    nicknames: Object.fromEntries(names),
  };
}
