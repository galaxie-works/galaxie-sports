/** Agentes de IA (docs/07) — camada de LLM independente de provedor + agente Onde Assistir. */
export const AI_AGENTS = [
  'live-scheduler',
  'where-to-watch',
  'match-context',
  'kb-curator',
  'related-content',
] as const;

export * from './llm/index.js';
export * from './wtw/index.js';
export * from './guardrails/index.js';

// Cenário pré-jogo e Resumo pós-jogo (#57, #58)
export * from './context/event-core.js';
export * from './context/stakes.js';
export * from './context/scenario.js';
export * from './context/writer.js';
export * from './context/store.js';
export * from './context/run.js';
export * from './recap/facts.js';
export * from './recap/recap.js';
export * from './recap/run.js';

// Priorização ao vivo por LLM (#56)
export * from './priority/prioritize.js';

// Curador semântico (#59)
export * from './curator/gaps.js';
export * from './curator/propose.js';
export * from './curator/apply.js';
export * from './curator/diff.js';
export * from './curator/run.js';

// Avaliação contínua (#60)
export * from './evaluation/metrics.js';

// Conteúdo relacionado por evento (#127)
export * from './related/index.js';

// Grade de canais e ofertas das operadoras e streamings (onde assistir)
export * from './lineups/index.js';
