import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from '@galaxie/contracts';
import { fallbackChain } from '@galaxie/knowledge';

export { fallbackChain };

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
 * exata (es-AR) ou só o idioma (es → primeiro locale es-* suportado; pt → pt-BR). Padrão: pt-BR.
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
    const sameLang = SUPPORTED_LOCALES.find((l) => l.toLowerCase().startsWith(`${lang}-`));
    if (sameLang) return sameLang;
  }
  return DEFAULT_LOCALE;
}

/**
 * Locales das dicas por mercado (`copy_hints`, gritos): o pedido, depois o do próprio clube quando é o mesmo
 * idioma (o Boca, escrito em es-AR, fala rioplatense também para es-MX), depois o idioma (es-MX → es).
 * Nunca outro idioma: pt-BR não cai para espanhol.
 */
export function hintLocales(locale: string, originLocale?: string | null): string[] {
  const lang = locale.split('-')[0]!;
  const origin = originLocale && originLocale.split('-')[0] === lang ? [originLocale] : [];
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

/** Instante em ISO 8601 com o offset do fuso pedido (UTC → sufixo Z). */
export function formatInstant(date: Date, tz = 'UTC'): string {
  if (tz === 'UTC' || tz === 'Etc/UTC') return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'longOffset',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const offset = (parts.timeZoneName ?? 'GMT').replace('GMT', '') || '+00:00';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}
