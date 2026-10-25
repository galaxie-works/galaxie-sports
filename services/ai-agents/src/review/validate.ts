/**
 * Validação determinística da decisão do modelo sobre uma sugestão de edição (docs/06 §2.1). O modelo
 * não publica nada sozinho: a edição final só vale se passar por todas as regras daqui, pelo schema da
 * base semântica (validateKnowledge, no runner) e pelos contratos da API. Qualquer falha vira recusa,
 * com o motivo para o admin.
 */
import { canonicalJson, editableReviewFields, lockedReviewFields, type ReviewKind } from '@galaxie/knowledge';
import { checkGeneratedText, describeViolations, type Violation } from '../guardrails/index.js';
import type { ReviewModelOutput } from './schema.js';

/** Item com sugestão em aberto, como o runner lê do banco (semantic.review_item + review_decision). */
export interface SuggestionItem {
  id: string;
  kind: ReviewKind;
  key: string;
  locale: string | null;
  sport: string;
  market: string | null;
  title: string;
  sourceFile: string;
  /** Conteúdo atual (o do YAML, com as edições do banco já aplicadas). */
  content: Record<string, unknown>;
  original: Record<string, unknown> | null;
  originalLocale: string | null;
  parentKind: 'team' | 'derby' | null;
  reviewHash: string;
  suggestion: { comment: string; fields: Record<string, unknown> | null };
  suggestedBy: string | null;
  suggestedAt: string | null;
}

export type FinalFields =
  | { ok: true; fields: Record<string, unknown>; adjusted: boolean }
  | { ok: false; problems: string[]; fields: Record<string, unknown> | null };

const FIELDS_MAX = 20_000;
const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

const shape = (v: unknown) =>
  v === null || v === undefined
    ? 'null'
    : Array.isArray(v)
      ? 'array'
      : typeof v === 'object'
        ? 'object'
        : typeof v;

/** Textos de um valor (em qualquer profundidade). */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** Variáveis `{x}` usadas num valor, sem repetir e em ordem. */
export function placeholdersOf(value: unknown): string[] {
  const found = strings(value).flatMap((s) => [...s.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]!));
  return [...new Set(found)].sort();
}

/** Texto com `{` ou `}` fora de uma variável bem formada. */
const unbalanced = (s: string) => /[{}]/.test(s.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, ''));

/**
 * Regras de "código" do conteúdo servido pela API, campo a campo: variáveis `{x}` preservadas (o
 * mesmo conjunto do valor atual), chaves sem par proibidas e o mesmo tipo de valor (texto, lista,
 * objeto, número). Devolve os problemas encontrados.
 */
export function fieldProblems(field: string, before: unknown, after: unknown): string[] {
  const out: string[] = [];
  const was = shape(before);
  const now = shape(after);
  if (was !== 'null' && now !== 'null' && was !== now) out.push(`${field}: o tipo mudou (${was} → ${now})`);
  const a = placeholdersOf(before);
  const b = placeholdersOf(after);
  if (canonicalJson(a) !== canonicalJson(b))
    out.push(
      `${field}: variáveis alteradas (${a.map((p) => `{${p}}`).join(', ') || 'nenhuma'} → ${
        b.map((p) => `{${p}}`).join(', ') || 'nenhuma'
      })`,
    );
  const broken = strings(after).filter(unbalanced);
  if (broken.length && !strings(before).some(unbalanced))
    out.push(`${field}: chaves { } sem par em "${broken[0]!.slice(0, 80)}"`);
  return out;
}

/**
 * Guardrails do texto gerado (termos proibidos, eco de prompt injection e, com o idioma do item, idioma errado) nos
 * textos que a edição escreve no campo. Só conta o problema novo: o que o valor atual já tinha (ex.: o nome oficial
 * de um time que contém um termo da lista) não pesa contra a edição. Rivalidade só na copy de intenção `rivalry`.
 */
export function textProblems(item: SuggestionItem, field: string, before: unknown, after: unknown): string[] {
  const locales = item.locale ? [item.locale] : ['pt-BR', 'es'];
  const allowRivalry = item.kind === 'copy' && item.content.intent === 'rivalry';
  const relevant = (v: Violation) =>
    v.kind.startsWith('forbidden_') ||
    v.kind === 'injection_echo' ||
    (!!item.locale && v.kind === 'wrong_language');
  const violations = (value: unknown) =>
    strings(value)
      .filter((s) => s.trim())
      .flatMap((s) => locales.flatMap((locale) => checkGeneratedText(s, { locale, allowRivalry })))
      .filter(relevant);
  const had = new Set(violations(before).map((v) => `${v.kind}|${v.value}`));
  const fresh = violations(after).filter((v, i, all) => {
    const key = `${v.kind}|${v.value}`;
    return !had.has(key) && all.findIndex((x) => `${x.kind}|${x.value}` === key) === i;
  });
  return describeViolations(fresh).map((d) => `${field}: ${d}`);
}

/**
 * Campos finais a partir da saída do modelo: parse dos valores, só campos editáveis do item, sem os que
 * não mudam e com as regras de `fieldProblems` e de `textProblems`. `accept` sem campos = a edição proposta como veio.
 */
export function finalFields(item: SuggestionItem, output: ReviewModelOutput): FinalFields {
  const problems: string[] = [];
  const editable = new Set(editableReviewFields(item.kind, item.content));
  const locked = lockedReviewFields(item.kind);
  const proposed = item.suggestion.fields ?? null;

  let raw: Record<string, unknown> = {};
  if (output.fields.length) {
    for (const f of output.fields) {
      if (f.field in raw) {
        problems.push(`${f.field}: campo repetido na resposta`);
        continue;
      }
      try {
        raw[f.field] = JSON.parse(f.value_json) as unknown;
      } catch {
        problems.push(`${f.field}: valor não é JSON válido`);
      }
    }
  } else if (output.decision === 'accept' && proposed) {
    raw = { ...proposed };
  }

  for (const field of Object.keys(raw)) {
    if (locked.has(field))
      problems.push(`${field}: campo travado (identifica o item ou o liga a outros dados)`);
    else if (!editable.has(field)) problems.push(`${field}: campo que não existe no conteúdo do item`);
  }
  if (problems.length) return { ok: false, problems, fields: raw };

  const fields = Object.fromEntries(
    Object.entries(raw).filter(([k, v]) => !same(item.content[k], v)),
  ) as Record<string, unknown>;
  for (const [k, v] of Object.entries(fields))
    problems.push(...fieldProblems(k, item.content[k], v), ...textProblems(item, k, item.content[k], v));
  if (JSON.stringify(fields).length > FIELDS_MAX) problems.push('edição grande demais');
  if (output.decision === 'accept_with_changes' && !Object.keys(fields).length)
    problems.push('aceita com ajustes, mas sem nenhum campo alterado');
  if (problems.length) return { ok: false, problems, fields };

  const proposedChanges = proposed
    ? Object.fromEntries(Object.entries(proposed).filter(([k, v]) => !same(item.content[k], v)))
    : null;
  const adjusted = proposedChanges ? !same(proposedChanges, fields) : Object.keys(fields).length > 0;
  return { ok: true, fields, adjusted };
}
