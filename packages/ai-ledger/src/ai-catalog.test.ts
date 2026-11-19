/**
 * Catálogo único dos provedores de IA (#1437): todo modelo padrão tem preço próprio, e nenhum outro arquivo do
 * monorepo volta a ter cópia da lista de provedores ou dos modelos padrão.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COSMOS_PROVIDERS } from '@galaxie/db/schema';
import {
  AI_DEFAULT_MODELS,
  AI_PROVIDERS,
  AI_PROVIDER_KEY_ENV,
  AI_TIERS,
  providerOfModel,
} from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';
import { MODEL_PRICES } from './pricing.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Fontes .ts/.tsx de apps, packages e services, sem testes, build e dependências. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.next', '.turbo', 'coverage', 'testing', 'fixtures'].includes(entry.name))
      continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    )
      out.push(path);
  }
  return out;
}

const DEFAULT_IDS = [...new Set(AI_TIERS.flatMap((t) => Object.values(AI_DEFAULT_MODELS[t])))];
/** Onde o nome de um modelo padrão pode aparecer: o catálogo e a tabela de preços. */
const ALLOWED = new Set(['packages/runtime-config/src/ai-catalog.ts', 'packages/ai-ledger/src/pricing.ts']);

describe('catálogo de provedores e modelos de IA', () => {
  it('todo modelo padrão tem preço próprio na tabela e é do provedor certo', () => {
    for (const tier of AI_TIERS)
      for (const provider of AI_PROVIDERS) {
        const model = AI_DEFAULT_MODELS[tier][provider];
        expect(MODEL_PRICES[model], `${tier}/${provider}: ${model} sem preço`).toBeDefined();
        expect(providerOfModel(model)).toBe(provider);
      }
  });

  it('todo provedor tem variável de chave própria', () => {
    expect(Object.keys(AI_PROVIDER_KEY_ENV).sort()).toEqual([...AI_PROVIDERS].sort());
    expect(new Set(Object.values(AI_PROVIDER_KEY_ENV)).size).toBe(AI_PROVIDERS.length);
  });

  it('o enum de provedores da Cosmos no banco é a mesma lista', () => {
    expect([...COSMOS_PROVIDERS].sort()).toEqual([...AI_PROVIDERS].sort());
  });

  it('nenhuma cópia dos modelos padrão fora do catálogo e da tabela de preços', () => {
    const copies: string[] = [];
    const roots = ['apps', 'packages', 'services'].flatMap((area) =>
      readdirSync(join(ROOT, area), { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(ROOT, area, d.name, 'src')))
        .map((d) => join(ROOT, area, d.name, 'src')),
    );
    for (const root of roots)
      for (const file of sources(root)) {
        const rel = relative(ROOT, file).split(sep).join('/');
        if (ALLOWED.has(rel)) continue;
        const text = readFileSync(file, 'utf8');
        const hits = DEFAULT_IDS.filter((id) => ["'", '"', '`'].some((q) => text.includes(`${q}${id}${q}`)));
        if (hits.length) copies.push(`${rel}: ${hits.join(', ')}`);
      }
    expect(copies, 'use AI_DEFAULT_MODELS / defaultModelOf de @galaxie/runtime-config').toEqual([]);
  }, 60_000);
});
