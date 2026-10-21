/**
 * Guardrails reutilizáveis pelos agentes de IA (docs/07 §3, issue #60):
 * - validador factual (`checkFacts`, `FactSheetBuilder`);
 * - filtro de termos proibidos por locale (`findForbiddenTerms`) e rivalidade (`rivalryAllowed`);
 * - limites de tamanho por superfície (`checkLength`, `MAX_LENGTH`);
 * - conteúdo web como dado (`wrapUntrusted`, `detectPromptInjection`, `sanitizeExcerpt`);
 * - porta única `checkGeneratedText` e regras de prompt (`guardrailSystemRules`).
 */
export * from './text.js';
export * from './terms.js';
export * from './length.js';
export * from './facts.js';
export * from './web-content.js';
export * from './check.js';
export * from './prompt.js';
