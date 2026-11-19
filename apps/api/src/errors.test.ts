import { describe, expect, it } from 'vitest';
import { problems, type ProblemError } from './errors.js';

/** Palavras e letras do português que não podem aparecer num erro da API (#1421, épico #634). */
const PORTUGUESE = /[áéíóúãõçâêôà]|\b(não|inválid[oa]|chave|plano|cota|requisição|encontrad[oa])\b/i;

/** Um exemplo de cada erro do catálogo, com argumentos quaisquer. */
const SAMPLES: ProblemError[] = [
  problems.invalidParams([{ path: 'x', message: 'y' }]),
  problems.invalidKey(),
  problems.tenantPendingReview(),
  problems.tenantRejected(),
  problems.trialExpired(),
  problems.subscriptionSuspended(),
  problems.tenantCancelled(),
  problems.realtimeNotInPlan('starter'),
  problems.moduleNotInPlan('core_data'),
  problems.sportNotInPlan('formula-1'),
  problems.marketNotInPlan('AR'),
  problems.originNotAllowed('https://example.com'),
  problems.originNotAllowed(undefined),
  problems.publishableKeyNotAllowed(),
  problems.fanAgeRestricted('detail'),
  problems.invalidFanToken(),
  problems.notFound(),
  problems.conflict('detail'),
  problems.quotaExceeded(1000, 60),
  problems.rateLimited(60),
  problems.degraded('detail'),
];

describe('catálogo de erros', () => {
  it('cobre todo erro de `problems`', () => {
    expect(new Set(SAMPLES.map((p) => p.code)).size).toBeGreaterThan(10);
    expect(SAMPLES.length).toBeGreaterThanOrEqual(Object.keys(problems).length);
  });

  it.each(SAMPLES.map((p) => [p.code, p] as const))('%s sai em inglês', (_code, p) => {
    expect(p.title).not.toMatch(PORTUGUESE);
    if (p.detail) expect(p.detail).not.toMatch(PORTUGUESE);
  });

  it('o percentual do QUOTA_EXCEEDED vem de QUOTA_BLOCK_RATIO', () => {
    expect(problems.quotaExceeded(1000, 60).detail).toMatch(/over 110% of its daily quota of 1000 requests/);
  });
});
