/**
 * Idiomas da demo. A escolha fica no cookie `galaxie-idioma`; sem cookie, vale o `Accept-Language` do
 * navegador. O proxy reescreve cada página para `/[locale]/...` (a URL visível não muda), e o segmento
 * `[locale]` é o parâmetro raiz que as páginas leem com `next/root-params`.
 *
 * Módulo puro: serve ao proxy, ao servidor, ao navegador e aos testes.
 */
import type { SupportedLocale } from '@galaxie/contracts';

export const LOCALES = ['pt-BR', 'en', 'es-AR'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'pt-BR';

/** Cookie com o idioma escolhido (vale um ano). */
export const LOCALE_COOKIE = 'galaxie-idioma';
/** Cookie com o fuso do navegador, para as datas saírem no horário de quem está vendo. */
export const TIME_ZONE_COOKIE = 'galaxie-fuso';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Opções do seletor de idioma (o rótulo fica sempre no próprio idioma). */
export const LANGUAGES: { value: Locale; label: string; short: string }[] = [
  { value: 'pt-BR', label: 'Português (Brasil)', short: 'BR' },
  { value: 'en', label: 'English', short: 'EN' },
  { value: 'es-AR', label: 'Español', short: 'ES' },
];

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

/** Idioma de uma tag qualquer: exata (`es-AR`) ou só pelo idioma (`es-MX` → `es-AR`, `en-US` → `en`). */
function matchTag(tag: string): Locale | null {
  const lower = tag.trim().toLowerCase();
  const exact = LOCALES.find((l) => l.toLowerCase() === lower);
  if (exact) return exact;
  const language = lower.split('-')[0];
  if (language === 'pt') return 'pt-BR';
  if (language === 'es') return 'es-AR';
  if (language === 'en') return 'en';
  return null;
}

/** Melhor idioma para um header `Accept-Language` (respeita os pesos `q`); sem correspondência, pt-BR. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter((r) => r.tag && r.tag !== '*' && Number.isFinite(r.q) && r.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranked) {
    const locale = matchTag(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

/** Idioma do cookie (se válido) ou o negociado pelo navegador. */
export function resolveLocale(cookie: string | null | undefined, acceptLanguage: string | null | undefined) {
  return isLocale(cookie) ? cookie : negotiateLocale(acceptLanguage);
}

/**
 * Locale do conteúdo pedido à API: o idioma da tela (`Locale`) ou já um locale da API (`es-CL`…), quando
 * a página escolhe a voz do país do time (`contentLocale`).
 */
export type ContentLocale = Locale | SupportedLocale;

/**
 * Locale pedido à API. A API fala pt-BR e espanhol (`es-*`), não inglês: com a demo em inglês, os dados
 * (tags do torcedor, resumos, gritos) vêm em espanhol; nomes de times e competições já caem no inglês pela
 * cadeia `es → en` do banco.
 */
export function apiLocale(locale: ContentLocale): SupportedLocale {
  return locale === 'en' ? 'es-AR' : locale;
}

/** Variante de espanhol de cada mercado da API (a voz local: voseo, "hinchada", "afición"…). */
const SPANISH_BY_COUNTRY: Record<string, SupportedLocale> = {
  AR: 'es-AR',
  MX: 'es-MX',
  CO: 'es-CO',
  CL: 'es-CL',
  PE: 'es-PE',
  UY: 'es-UY',
  EC: 'es-EC',
};

/**
 * Locale do conteúdo de um time, jogo, clássico ou competição: o contexto vem do país de origem, no
 * idioma da tela. Em espanhol (e em inglês, que pede espanhol), um time chileno sai na voz do Chile
 * (`es-CL`) e o Boca na da Argentina; sem país ou fora dos mercados, o espanhol padrão (`es-AR`). Em
 * pt-BR, tudo sai em português (os perfis hispânicos já trazem a tradução feita a partir do contexto
 * local).
 */
export function contentLocale(locale: Locale, country: string | null | undefined): SupportedLocale {
  const base = apiLocale(locale);
  if (base === 'pt-BR') return base;
  return SPANISH_BY_COUNTRY[(country ?? '').toUpperCase()] ?? base;
}

const TIME_ZONE_BY_LOCALE: Partial<Record<SupportedLocale, string>> = {
  'pt-BR': 'America/Sao_Paulo',
  'es-AR': 'America/Argentina/Buenos_Aires',
  'es-MX': 'America/Mexico_City',
  'es-CO': 'America/Bogota',
  'es-CL': 'America/Santiago',
  'es-PE': 'America/Lima',
  'es-UY': 'America/Montevideo',
  'es-EC': 'America/Guayaquil',
};

/** Fuso do mercado do locale da API: vai no `?tz` das chamadas (o "hoje" e o "amanhã" da API). */
export function apiTimeZone(locale: ContentLocale): string {
  return TIME_ZONE_BY_LOCALE[apiLocale(locale)] ?? 'America/Sao_Paulo';
}

/** Fuso das datas enquanto o navegador ainda não informou o dele (primeiro acesso). */
export const defaultTimeZone = (locale: Locale) => apiTimeZone(locale);

/** Fuso IANA válido? (o cookie vem do navegador e pode ter qualquer coisa) */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** País padrão do "Onde assistir" e da agenda ao vivo: Argentina em espanhol, Brasil nos demais. */
export const defaultMarket = (locale: Locale) => (locale === 'es-AR' ? 'AR' : 'BR');

/** País destacado na relevância por país: o do idioma (pt-BR → Brasil, es-AR → Argentina); inglês, nenhum. */
export const relevanceMarket = (locale: Locale): string | null =>
  locale === 'pt-BR' ? 'BR' : locale === 'es-AR' ? 'AR' : null;
