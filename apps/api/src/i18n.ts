import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from '@galaxie/contracts';
import { competitionName } from '@galaxie/geo';
import { fallbackChain } from '@galaxie/knowledge';
import { FORMATTER_CACHE_MAX } from './time.js';

export { fallbackChain };
/**
 * Nome de competição: nacional sai no idioma do próprio país em qualquer locale; continental e mundial seguem
 * a cadeia dos campos i18n (regra em packages/geo/src/language.ts). Todo ponto que monta o nome usa isto.
 */
export { competitionName };

const SUPPORTED = new Map(SUPPORTED_LOCALES.map((l) => [l.toLowerCase(), l]));

/** Accept-Language → tags ordenadas por preferência (q). */
export function parseAcceptLanguage(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return { tag: (tag ?? '').trim(), q: q ? Number(q) : 1, i };
    })
    .filter((x) => x.tag && x.tag !== '*' && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.tag);
}

/**
 * Locale da resposta: `?locale` (já validado) tem precedência; depois Accept-Language, casando a tag
 * exata (es-AR) ou só o idioma (es → primeiro locale es-* suportado; pt → pt-BR; en-US → en). Padrão: pt-BR.
 */
export function resolveLocale(
  queryLocale: SupportedLocale | undefined,
  acceptLanguage?: string,
): SupportedLocale {
  if (queryLocale) return queryLocale;
  for (const tag of parseAcceptLanguage(acceptLanguage)) {
    const exact = SUPPORTED.get(tag.toLowerCase());
    if (exact) return exact;
    const lang = tag.split('-')[0]!.toLowerCase();
    const sameLang =
      SUPPORTED.get(lang) ?? SUPPORTED_LOCALES.find((l) => l.toLowerCase().startsWith(`${lang}-`));
    if (sameLang) return sameLang;
  }
  return DEFAULT_LOCALE;
}

/**
 * Locales das dicas por mercado (`copy_hints`, gritos): o pedido, depois o do próprio clube quando é o mesmo
 * idioma (o Boca, escrito em es-AR, fala rioplatense também para es-MX), depois o idioma (es-MX → es).
 * Nunca outro idioma: pt-BR não cai para espanhol. Exceção: `en` não tem grito próprio (ninguém escreve
 * "Avanti, Palestra!" em inglês), então cai nos do idioma do próprio clube (`text_locale`): o Palmeiras
 * grita em português e o Boca em rioplatense também para quem lê em inglês.
 */
export function hintLocales(locale: string, originLocale?: string | null): string[] {
  const lang = locale.split('-')[0]!;
  const originLang = originLocale?.split('-')[0];
  if (lang === 'en' && originLocale && originLang && originLang !== 'en')
    return [...new Set([locale, originLocale, originLang])];
  const origin = originLocale && originLang === lang ? [originLocale] : [];
  return [...new Set([locale, ...origin, lang])];
}

/**
 * Escolhe o texto de um campo i18n (`{"pt-BR": "...", "es": "...", "en": "..."}`) seguindo a cadeia.
 * Sem correspondência: devolve `fallback` (ex.: o nome oficial) ou, sem fallback, qualquer valor.
 */
export function pickText(
  value: Record<string, string> | null | undefined,
  locale: string,
  fallback?: string,
): string | null {
  if (value) {
    for (const l of fallbackChain(locale)) {
      const v = value[l];
      if (typeof v === 'string' && v) return v;
    }
  }
  if (fallback !== undefined) return fallback;
  const any = value ? Object.values(value).find((v) => typeof v === 'string' && v) : undefined;
  return any ?? null;
}

/** Igual a pickText para listas localizadas (`{"pt-BR": ["..."], "es": ["..."]}`); sem correspondência, []. */
export function pickList(value: unknown, locale: string): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  const rec = value as Record<string, unknown>;
  for (const l of fallbackChain(locale)) {
    const v = rec[l];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  }
  return [];
}

// um formatador por fuso: criar um por data serializada custa tempo e memória fora do heap do V8
const instantFormatters = new Map<string, Intl.DateTimeFormat>();

function instantFormatter(tz: string): Intl.DateTimeFormat {
  let f = instantFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'longOffset',
    });
    if (instantFormatters.size >= FORMATTER_CACHE_MAX) instantFormatters.clear();
    instantFormatters.set(tz, f);
  }
  return f;
}

/** Instante em ISO 8601 com o offset do fuso pedido (UTC → sufixo Z). */
export function formatInstant(date: Date, tz = 'UTC'): string {
  if (tz === 'UTC' || tz === 'Etc/UTC') return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const parts = Object.fromEntries(
    instantFormatter(tz)
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const offset = (parts.timeZoneName ?? 'GMT').replace('GMT', '') || '+00:00';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}
