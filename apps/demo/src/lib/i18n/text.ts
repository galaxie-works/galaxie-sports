/**
 * Ferramentas dos textos dos dicionários (puras: servidor, navegador e testes).
 *
 * - `fill`: troca `{nome}` pelo valor (`fill('Olá, {name}!', { name: 'Ana' })`).
 * - `plural`: escolhe a forma pelo número (`{ one: '1 jogo', other: '{count} jogos' }`).
 * - `rich`: texto com marcação simples (`Use <c>?locale=</c> na query`) vira nós React, cada tag
 *   desenhada pela função de mesmo nome. Sem tags aninhadas: é para trechos curtos de código e links.
 */
import { Fragment, createElement, type ReactNode } from 'react';

import { apiLocale, type Locale } from './config';

export type Vars = Record<string, string | number>;

/** Plural com as formas do CLDR que os três idiomas usam (pt, en e es: `one` e `other`). */
export interface Plural {
  one: string;
  other: string;
}

export function fill(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

/** Forma certa para `count` (e já com `{count}` e as demais variáveis preenchidas). */
export function plural(locale: Locale, count: number, forms: Plural, vars: Vars = {}): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  const form = rules.select(count) === 'one' ? forms.one : forms.other;
  return fill(form, { count, ...vars });
}

export type RichTags = Record<string, (chunk: string) => ReactNode>;

/** `Use <c>?locale=</c>` → ['Use ', <C>?locale=</C>]. Tag sem função vira texto puro. */
export function rich(template: string, tags: RichTags, vars: Vars = {}): ReactNode {
  const text = fill(template, vars);
  const parts: ReactNode[] = [];
  const re = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let key = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const render = tags[m[1]!];
    parts.push(createElement(Fragment, { key: key++ }, render ? render(m[2]!) : m[2]));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
}

/** Nomes das variáveis `{x}` e das tags `<x>` de um texto (o teste confere que batem entre idiomas). */
export function placeholdersOf(template: string): string[] {
  const vars = [...template.matchAll(/\{(\w+)\}/g)].map((m) => `{${m[1]}}`);
  const tags = [...template.matchAll(/<(\w+)>/g)].map((m) => `<${m[1]}>`);
  return [...vars, ...tags].sort();
}

/**
 * Texto localizado que vem da API (`{ "es-AR": "…" }`): o locale pedido à API, depois o mesmo idioma,
 * depois o inglês e, por fim, o que houver. Com a demo em inglês, usa o inglês quando o objeto o traz
 * (ex.: rótulos de clássico); senão, o espanhol que a API devolveu.
 */
export function localized(text: Record<string, string> | null | undefined, locale: Locale): string {
  if (!text) return '';
  if (locale === 'en' && text.en) return text.en;
  const wanted = apiLocale(locale);
  const language = wanted.split('-')[0]!;
  return (
    text[wanted] ??
    Object.entries(text).find(([k]) => k.split('-')[0] === language)?.[1] ??
    text.en ??
    Object.values(text)[0] ??
    ''
  );
}

const ordinalRules = new Intl.PluralRules('en', { type: 'ordinal' });
const EN_SUFFIX: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };

/** Posição: "2º" (pt-BR), "2.º" (es-AR), "2nd" (en). */
export function ordinal(locale: Locale, n: number): string {
  if (locale === 'en') return `${n}${EN_SUFFIX[ordinalRules.select(n)] ?? 'th'}`;
  return locale === 'es-AR' ? `${n}.º` : `${n}º`;
}
