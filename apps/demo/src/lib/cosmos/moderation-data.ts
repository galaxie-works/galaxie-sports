/**
 * Dados da aba Moderação da Cosmos (#997): a configuração do cliente (dentro do teto da Galaxie, lido de Ajustes), as
 * exceções por sala e comunidade e o histórico com o nome de quem mudou. Só servidor.
 */
import {
  listModerationHistory,
  listModerationOverrides,
  loadModerationConfig,
  readModerationCeiling,
  type ModerationCeiling,
  type ModerationConfig,
  type ModerationScope,
} from '@galaxie/cosmos';

import { builderDb } from '@/lib/builder/store';

import { people } from './data';

export interface CosmosModerationData {
  config: ModerationConfig;
  /** Versão gravada do cliente; 0 = nunca salvou (vale o padrão). */
  version: number;
  ceiling: ModerationCeiling;
  overrides: { scope: ModerationScope; version: number; updatedAt: string }[];
  history: {
    id: string;
    scope: ModerationScope;
    version: number;
    removed: boolean;
    who: string | null;
    at: string;
  }[];
}

export async function loadCosmosModeration(tenantId: string): Promise<CosmosModerationData> {
  const db = builderDb();
  const ceiling = await readModerationCeiling(db);
  const [current, overrides, history] = await Promise.all([
    loadModerationConfig(db, tenantId, ceiling),
    listModerationOverrides(db, tenantId),
    listModerationHistory(db, tenantId, { limit: 20 }),
  ]);
  const who = await people(history.map((h) => h.changedBy));
  return {
    config: current.effective,
    version: current.tenant?.version ?? 0,
    ceiling,
    overrides: overrides.map((o) => ({
      scope: o.scope,
      version: o.version,
      updatedAt: o.updatedAt.toISOString(),
    })),
    history: history.map((h) => {
      const p = who.get(h.changedBy);
      return {
        id: h.id,
        scope: h.scope,
        version: h.version,
        removed: h.config === null,
        // só o nome: o e-mail de quem mudou não aparece para quem só vê a Cosmos
        who: p?.name?.trim() || null,
        at: h.createdAt.toISOString(),
      };
    }),
  };
}
