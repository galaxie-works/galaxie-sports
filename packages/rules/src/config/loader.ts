import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { parseCompetitionRules, RulesConfigError } from './parse.js';
import type { CompetitionRules } from './types.js';

export { parseCompetitionRules, RulesConfigError } from './parse.js';
export type * from './types.js';

/** Slug do regulamento genérico usado quando a competição não tem arquivo próprio. */
export const DEFAULT_RULES_SLUG = 'default';

/** `config/rules` na raiz do monorepo (mesma profundidade em src/ e dist/). */
export function defaultRulesDir(): string {
  return fileURLToPath(new URL('../../../../config/rules/', import.meta.url));
}

export interface LoadRulesOptions {
  /** Diretório dos YAML (padrão: config/rules do monorepo). */
  dir?: string;
  /** Temporada (ano de início, como na api-sports) para aplicar as exceções históricas. */
  season?: number;
  /** Sem arquivo próprio, usa config/rules/default.yaml mantendo o slug pedido. */
  fallbackToDefault?: boolean;
}

async function readRaw(path: string): Promise<unknown> {
  return parse(await readFile(path, 'utf8'));
}

/** Carrega e valida o regulamento de uma competição (`config/rules/<slug>.yaml`). */
export async function loadCompetitionRules(slug: string, options: LoadRulesOptions = {}): Promise<CompetitionRules> {
  const dir = options.dir ?? defaultRulesDir();
  const path = join(dir, `${slug}.yaml`);
  const parseOpts = options.season === undefined ? {} : { season: options.season };
  if (existsSync(path)) return parseCompetitionRules(await readRaw(path), parseOpts);
  if (!options.fallbackToDefault) {
    throw new RulesConfigError(`Regulamento não encontrado: ${path}`);
  }
  const fallback = parseCompetitionRules(await readRaw(join(dir, `${DEFAULT_RULES_SLUG}.yaml`)), parseOpts);
  return { ...fallback, slug };
}

/** Carrega todos os regulamentos do diretório, indexados por slug. */
export async function loadAllCompetitionRules(
  options: Omit<LoadRulesOptions, 'fallbackToDefault'> = {},
): Promise<Map<string, CompetitionRules>> {
  const dir = options.dir ?? defaultRulesDir();
  const files = (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort();
  const out = new Map<string, CompetitionRules>();
  for (const file of files) {
    const rules = parseCompetitionRules(
      await readRaw(join(dir, file)),
      options.season === undefined ? {} : { season: options.season },
    );
    if (`${rules.slug}.yaml` !== file) {
      throw new RulesConfigError(`Regulamento ${file}: o slug interno (${rules.slug}) difere do nome do arquivo.`);
    }
    out.set(rules.slug, rules);
  }
  return out;
}
