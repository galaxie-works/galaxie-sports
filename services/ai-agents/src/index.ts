/** Agentes de IA (docs/07) — camada de LLM independente de provedor + agente Onde Assistir. */
export const AI_AGENTS = ['live-scheduler', 'where-to-watch', 'match-context', 'kb-curator'] as const;

export * from './llm/index.js';
export * from './wtw/index.js';
