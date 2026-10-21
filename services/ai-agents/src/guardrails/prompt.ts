import { UNTRUSTED_DATA_RULE } from './web-content.js';

/**
 * Regras de linguagem segura comuns a todo prompt que gera texto para o público (docs/06 §4.2,
 * docs/07 §3). Vão no system prompt; o filtro de termos (terms.ts) é a segunda barreira.
 */
export const SAFE_LANGUAGE_RULES = [
  'Tom informativo e neutro (intensidade 1): sem torcida, sem provocação e sem linguagem de rivalidade.',
  'Nunca ofenda times, torcidas, atletas, árbitros ou países; nada de violência (inclusive metáforas como "matar o jogo"), discriminação de qualquer tipo, tragédias, superioridade nacional ou especulação sobre arbitragem.',
  'Não use apelidos, gírias de torcida nem palavrões; cite times e pessoas exatamente pelos nomes fornecidos.',
  'Não opine e não faça previsões de resultado.',
] as const;

/** Regras factuais: o LLM só redige, quem calcula é o código (docs/07 §1). */
export const FACTUAL_RULES = [
  'Use SOMENTE os fatos fornecidos em JSON. Não invente números, placares, minutos, nomes, estatísticas, datas ou locais.',
  'Todo número escrito (em algarismos ou por extenso) precisa existir nos fatos.',
  'Placares no formato "2 a 1" (ou como nos fatos); não arredonde nem combine números.',
] as const;

/** Bloco pronto para o system prompt. */
export function guardrailSystemRules(): string {
  return [...FACTUAL_RULES, ...SAFE_LANGUAGE_RULES, UNTRUSTED_DATA_RULE].map((r) => `- ${r}`).join('\n');
}
