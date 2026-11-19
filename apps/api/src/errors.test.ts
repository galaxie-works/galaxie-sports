import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { problems, type ProblemError } from './errors.js';

/** Palavras e letras do português que não podem aparecer num erro da API (#1421, épico #634). */
const PORTUGUESE =
  /[áéíóúãõçâêôà]|\b(não|inválid[oa]|chave|plano|cota|requisição|encontrad[oa]|ausente|defina|sem|envie|deve|revogue|rotas)\b/i;

/** Exemplos de cada erro do catálogo: o tipo obriga uma entrada por chave de `problems`. */
const SAMPLES: Record<keyof typeof problems, ProblemError[]> = {
  invalidParams: [problems.invalidParams([{ path: 'x', message: 'y' }])],
  invalidKey: [problems.invalidKey()],
  tenantPendingReview: [problems.tenantPendingReview()],
  tenantRejected: [problems.tenantRejected()],
  trialExpired: [problems.trialExpired()],
  subscriptionSuspended: [problems.subscriptionSuspended()],
  tenantCancelled: [problems.tenantCancelled()],
  realtimeNotInPlan: [problems.realtimeNotInPlan('starter')],
  moduleNotInPlan: [problems.moduleNotInPlan('core_data')],
  sportNotInPlan: [problems.sportNotInPlan('formula-1')],
  marketNotInPlan: [problems.marketNotInPlan('AR')],
  originNotAllowed: [problems.originNotAllowed('https://example.com'), problems.originNotAllowed(undefined)],
  publishableKeyNotAllowed: [problems.publishableKeyNotAllowed()],
  fanAgeRestricted: [problems.fanAgeRestricted('detail')],
  invalidFanToken: [problems.invalidFanToken()],
  notFound: [problems.notFound()],
  conflict: [problems.conflict('detail')],
  quotaExceeded: [problems.quotaExceeded(1000, 60)],
  rateLimited: [problems.rateLimited(60)],
  degraded: [problems.degraded('detail')],
};

describe('catálogo de erros', () => {
  it('cobre exatamente as chaves de `problems`', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(problems).sort());
  });

  it.each(
    Object.values(SAMPLES)
      .flat()
      .map((p) => [p.code, p] as const),
  )('%s sai em inglês', (_code, p) => {
    expect(p.title).not.toMatch(PORTUGUESE);
    if (p.detail) expect(p.detail).not.toMatch(PORTUGUESE);
  });

  it('o percentual do QUOTA_EXCEEDED vem de QUOTA_BLOCK_RATIO', () => {
    expect(problems.quotaExceeded(1000, 60).detail).toMatch(/over 110% of its daily quota of 1000 requests/);
  });
});

/**
 * Guarda nas fontes: nome de recurso do `notFound(...)` e título de `new ProblemError(...)` fora do catálogo não
 * podem voltar ao português. chat/, engage/ e game/ entram com a #1423.
 */
describe('erros escritos nas rotas', () => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const PENDING = new Set(['chat', 'engage', 'game']);
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) files.push(path);
    }
  };
  walk(root);

  it('notFound, primeiro argumento de problems.* e títulos de ProblemError em inglês', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(root, file);
      if (PENDING.has(rel.split(sep)[0]!)) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:notFound|notPublished)\(\s*'([^']*)'/g))
        if (PORTUGUESE.test(m[1]!)) offenders.push(`${rel}: ${m[1]}`);
      // primeiro argumento literal de problems.* (detail, nome do recurso), #1422
      for (const m of src.matchAll(/problems\.\w+\(\s*(['`])([^'`]*)\1/g))
        if (PORTUGUESE.test(m[2]!)) offenders.push(`${rel}: ${m[2]}`);
      // campos de INVALID_PARAMS e mensagens de erro de domínio que viram `detail` (KeyPolicyError, conflitos)
      for (const m of src.matchAll(
        /(?:\bmessage:\s*|new (?:KeyPolicyError|TenantConflictError)\(\s*(?:'[a-z_]+',\s*)?)(['`])([^'`]*)\1/g,
      ))
        if (PORTUGUESE.test(m[2]!)) offenders.push(`${rel}: ${m[2]}`);
      for (const m of src.matchAll(/new ProblemError\(\s*\d+,\s*'[A-Z_]+',\s*(['`])([^'`]*)\1/g))
        if (PORTUGUESE.test(m[2]!)) offenders.push(`${rel}: ${m[2]}`);
    }
    expect(files.length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});
