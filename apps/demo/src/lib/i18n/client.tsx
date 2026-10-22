'use client';

/**
 * Idioma e textos no navegador. O layout raiz (servidor) entrega o idioma do segmento `[locale]` e os
 * assuntos do dicionário que os componentes do navegador usam; trocar de idioma grava o cookie e
 * recarrega a página (o proxy passa a reescrever para o novo idioma).
 */
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo } from 'react';

import { COOKIE_MAX_AGE, LOCALE_COOKIE, TIME_ZONE_COOKIE, type Locale } from './config';
import type { ClientDictionary } from './dictionary';
import { createFormatters, type Formatters } from './format';

interface I18nContext {
  locale: Locale;
  t: ClientDictionary;
}

const Ctx = createContext<I18nContext | null>(null);

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: ClientDictionary;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ locale, t: messages }), [locale, messages]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n fora do I18nProvider');
  return ctx;
}

/**
 * Formatadores no fuso informado. Componentes do navegador recebem o fuso do servidor (prop), para o
 * HTML do servidor e o da hidratação baterem.
 */
export function useFormatters(timeZone: string): Formatters {
  const { locale } = useI18n();
  return createFormatters(locale, timeZone);
}

function readCookie(name: string) {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

/** Grava o idioma escolhido e recarrega: o servidor volta a desenhar tudo (inclusive o shell) nele. */
export function switchLocale(next: Locale) {
  writeCookie(LOCALE_COOKIE, next);
  window.location.reload();
}

/**
 * Informa ao servidor o fuso do navegador (cookie), para as datas saírem no horário de quem está
 * vendo. Se mudou, pede ao servidor as partes dinâmicas de novo.
 */
export function TimeZoneSync() {
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    const current = readCookie(TIME_ZONE_COOKIE);
    if (current && decodeURIComponent(current) === tz) return;
    writeCookie(TIME_ZONE_COOKIE, tz);
    router.refresh();
  }, [router]);
  return null;
}
