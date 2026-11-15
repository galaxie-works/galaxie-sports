/**
 * Tiers de competição atendidos pelos agentes: o módulo do painel (Ajustes → Dados → Módulos por esporte,
 * MODULES_FOOTBALL: `ai-content` para resumo, cenário e vídeos; `wtw` para o Onde Assistir) por cima do padrão do
 * código (tier ≤ AGENT_MAX_TIER), e a opção `--tier` das CLIs por cima de tudo.
 */
import { eq, gte, lte, or, sql, type SQL } from 'drizzle-orm';
import { competition } from '@galaxie/db';
import { AGENT_MAX_TIER, MODULE_TIERS, moduleConfig, type ModuleTier } from '@galaxie/runtime-config';

/** Tiers até `maxTier` (2 → 1 e 2; 3 ou mais → todos, com o 3 valendo 3 e acima). */
export const tiersUpTo = (maxTier: number): ModuleTier[] => MODULE_TIERS.filter((t) => t <= maxTier);

/** Padrão do código: tier ≤ AGENT_MAX_TIER. */
export const DEFAULT_AGENT_TIERS: readonly ModuleTier[] = tiersUpTo(AGENT_MAX_TIER);

/**
 * Condição em `core.competition.tier` para os tiers ligados: 1 cobre o tier 0 (que não existe hoje), 3 cobre 3 e
 * acima. Nenhum tier ligado: nada entra.
 */
export function tierCondition(tiers: readonly number[]): SQL {
  const conds: SQL[] = [];
  if (tiers.includes(1)) conds.push(lte(competition.tier, 1));
  if (tiers.includes(2)) conds.push(eq(competition.tier, 2));
  if (tiers.includes(3)) conds.push(gte(competition.tier, 3));
  if (!conds.length) return sql`false`;
  return conds.length === 1 ? conds[0]! : or(...conds)!;
}

/** Tiers efetivos: a opção da CLI (`--tier N`), senão a lista dada, senão o padrão. */
export function effectiveTiers(opts: {
  maxTier?: number | undefined;
  tiers?: readonly number[] | undefined;
}): readonly number[] {
  if (opts.maxTier !== undefined) return tiersUpTo(opts.maxTier);
  return opts.tiers ?? DEFAULT_AGENT_TIERS;
}

/**
 * Tiers do módulo no env do processo (o scheduler entrega MODULES_FOOTBALL com as sobrescritas do painel; as CLIs à
 * mão passam o env de `runtimeEnv`). Valor inválido vale o padrão do módulo.
 */
export function moduleTiers(
  env: Record<string, string | undefined>,
  module: 'ai-content' | 'wtw',
): ModuleTier[] {
  return moduleConfig((key) => env[key])
    .api('football')
    .tiersOn(module);
}
