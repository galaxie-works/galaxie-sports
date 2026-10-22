/**
 * Idioma, textos e formatadores no servidor.
 *
 * - Páginas e Server Components: `getLocale()`/`getT()` leem o parâmetro raiz `[locale]` (o proxy já
 *   reescreveu a URL), sem Suspense e sem quebrar o shell estático: cada idioma tem o seu.
 * - Server Actions e Route Handlers não têm parâmetro raiz: `getRequestLocale()` lê o cookie.
 * - `getFormatters()` usa também o fuso do navegador (cookie): é dado de requisição, então só nas
 *   partes que já são dinâmicas (atrás de Suspense).
 */
import { cookies, headers } from 'next/headers';
import { locale as localeParam } from 'next/root-params';

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  TIME_ZONE_COOKIE,
  defaultTimeZone,
  isLocale,
  isTimeZone,
  resolveLocale,
  type Locale,
} from './config';
import { getDictionary } from './dictionary';
import { createFormatters } from './format';

export async function getLocale(): Promise<Locale> {
  const value = await localeParam();
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getT() {
  return getDictionary(await getLocale());
}

/** Idioma e textos de uma vez (o idioma serve aos fetchers da API e aos textos que vêm dela). */
export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: getDictionary(locale) };
}

/** Fuso do navegador (cookie), ou o do mercado do idioma enquanto ele não chegou. */
export async function getTimeZone(locale?: Locale): Promise<string> {
  const value = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
  return isTimeZone(value) ? value : defaultTimeZone(locale ?? (await getLocale()));
}

export async function getFormatters() {
  const locale = await getLocale();
  return createFormatters(locale, await getTimeZone(locale));
}

/** Idioma da requisição fora das páginas (Server Actions, Route Handlers): cookie ou `Accept-Language`. */
export async function getRequestLocale(): Promise<Locale> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  return resolveLocale(jar.get(LOCALE_COOKIE)?.value, h.get('accept-language'));
}
