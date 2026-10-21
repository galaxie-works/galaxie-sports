import { copyPermission, type AffinitySource, type AffinityType } from '@galaxie/knowledge';
import { checkFacts, type FactSheet, type FactViolationKind } from './facts.js';
import { checkLength, type Surface } from './length.js';
import { findForbiddenTerms, type ForbiddenCategory } from './terms.js';
import { detectLanguage, languageOf, splitSentences } from './text.js';
import { detectPromptInjection } from './web-content.js';

/**
 * Porta única dos guardrails de texto gerado: fatos, termos proibidos, rivalidade, tamanho,
 * idioma e eco de prompt injection. Reutilizável por qualquer agente (cenário, resumo,
 * onde assistir, microcopy).
 */

export type ViolationKind =
  | FactViolationKind
  | `forbidden_${ForbiddenCategory}`
  | 'too_long'
  | 'sentence_too_long'
  | 'too_many_sentences'
  | 'empty'
  | 'wrong_language'
  | 'injection_echo';

export interface Violation {
  kind: ViolationKind;
  /** Valor/trecho que causou a reprovação. */
  value: string;
  sentence?: string;
}

export interface TextCheckOptions {
  locale: string;
  /** Fatos citáveis; sem eles, a checagem factual é pulada (ex.: microcopy fixa). */
  facts?: FactSheet;
  /** Limites de tamanho; sem superfície, não checa tamanho. */
  surface?: Surface;
  /** Linguagem de rivalidade liberada (só com rival declarado). Padrão: false. */
  allowRivalry?: boolean;
  /** Mínimo e máximo de frases. */
  minSentences?: number;
  maxSentences?: number;
}

/**
 * Rivalidade só é permitida quando o `copy_permission` (docs/06 §4.2) libera a intenção `rivalry`:
 * rival **declarado**. Inferido ou público geral → nunca.
 */
export function rivalryAllowed(
  affinityType: AffinityType | null | undefined,
  affinitySource: AffinitySource | null | undefined,
): boolean {
  return copyPermission(affinityType, affinitySource).allowedIntents.includes('rivalry');
}

/** Roda todos os guardrails de texto. Lista vazia = aprovado. */
export function checkGeneratedText(text: string, options: TextCheckOptions): Violation[] {
  const out: Violation[] = [];
  const sentences = splitSentences(text);
  if (!text.trim()) return [{ kind: 'empty', value: '' }];

  if (options.facts) {
    for (const v of checkFacts(text, options.facts, options.locale))
      out.push({ kind: v.kind, value: v.value, sentence: v.sentence });
  }

  const termOptions = {
    allowRivalry: options.allowRivalry ?? false,
    ...(options.facts ? { allowPhrases: options.facts.names } : {}),
  };
  for (const hit of findForbiddenTerms(text, options.locale, termOptions))
    out.push({ kind: `forbidden_${hit.category}`, value: hit.match });

  if (options.surface) {
    for (const v of checkLength(text, options.surface)) out.push({ kind: v.kind, value: v.detail });
  }
  if (options.minSentences !== undefined && sentences.length < options.minSentences)
    out.push({
      kind: 'too_many_sentences',
      value: `${sentences.length} frase(s) (mín. ${options.minSentences})`,
    });
  if (options.maxSentences !== undefined && sentences.length > options.maxSentences)
    out.push({
      kind: 'too_many_sentences',
      value: `${sentences.length} frases (máx. ${options.maxSentences})`,
    });

  const lang = detectLanguage(text);
  if (lang && lang !== languageOf(options.locale))
    out.push({ kind: 'wrong_language', value: `texto em ${lang} para ${options.locale}` });

  for (const s of detectPromptInjection(text)) out.push({ kind: 'injection_echo', value: s.excerpt });
  return out;
}

/** Resumo legível (pt-BR) das violações, para feedback ao LLM e logs. */
export function describeViolations(violations: readonly Violation[]): string[] {
  const label: Partial<Record<ViolationKind, string>> = {
    unknown_number: 'número que não está nos fatos',
    unknown_score: 'placar que não está nos fatos',
    wrong_result: 'resultado diferente do placar final',
    unknown_name: 'nome que não está nos fatos (use só os nomes fornecidos, sem apelidos)',
    unknown_minute: 'minuto que não está na timeline',
    wrong_scorer: 'pessoa citada como autora/participante de gol sem ter participado de gol',
    forbidden_insult: 'termo ofensivo',
    forbidden_violence: 'termo de violência',
    forbidden_discrimination: 'termo discriminatório',
    forbidden_tragedy: 'menção a tragédia',
    forbidden_rivalry: 'linguagem de rivalidade/provocação',
    too_long: 'texto longo demais',
    sentence_too_long: 'frase longa demais',
    too_many_sentences: 'quantidade de frases fora do limite',
    empty: 'texto vazio',
    wrong_language: 'idioma errado para o locale',
    injection_echo: 'texto com padrão de instrução/prompt',
  };
  return violations.map((v) => `${label[v.kind] ?? v.kind}: "${v.value}"`);
}
