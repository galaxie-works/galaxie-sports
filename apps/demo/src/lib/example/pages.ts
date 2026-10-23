/**
 * Páginas do exemplo público e o que cada uma mostra, pela versão da amostra (`lib/showcase.ts`):
 * espanhol mostra a Argentina (Flamengo x Estudiantes, Estudiantes, Libertadores, T. Palacios);
 * português e inglês, o Brasil (Palmeiras x Fluminense, Palmeiras, Libertadores, Marlon Freitas).
 * Puro: serve ao servidor, ao navegador (guarda dos links) e aos testes.
 */
import type { Locale } from '@/lib/i18n/config';

export const EXAMPLE_PAGES = ['jogo', 'time', 'campeonato', 'jogador'] as const;
export type ExamplePage = (typeof EXAMPLE_PAGES)[number];

export const isExamplePage = (value: string): value is ExamplePage =>
  (EXAMPLE_PAGES as readonly string[]).includes(value);

/** Rota do app de cada página do exemplo (`/eventos/<id>` …). */
export const APP_ROUTES: Record<ExamplePage, string> = {
  jogo: '/eventos/',
  time: '/times/',
  campeonato: '/competicoes/',
  jogador: '/pessoas/',
};

const IDS: Record<'BR' | 'AR', Record<ExamplePage, string>> = {
  BR: {
    jogo: '01a163b8-7ca2-71e8-a92e-8dc201d5d83a',
    time: '01a15fba-ec17-7d8b-90d7-47b3ccbe967e',
    campeonato: '01a15fba-b44e-7ba9-86d0-50dc8e4044a1',
    jogador: '01a15fba-fb52-71b1-834d-d83333b07f7f',
  },
  AR: {
    jogo: '01a163b8-7ca2-7c76-9d59-671c9b6e9df8',
    time: '01a15fc2-a0d1-76e1-a025-6686aed2ec3e',
    campeonato: '01a15fba-b44e-7ba9-86d0-50dc8e4044a1',
    jogador: '01a163c1-3684-77cd-b82f-d607e9ec4916',
  },
};

/** Ids do exemplo no idioma da página. */
export const exampleIds = (locale: Locale) => IDS[locale === 'es-AR' ? 'AR' : 'BR'];

/**
 * Para onde vai um link do app dentro do exemplo: a página do exemplo, quando o destino faz parte dele
 * (mesma página do app, com as abas da query string), ou `null` (fora do exemplo: a demo completa
 * pede login). Outra temporada ou data também fica de fora: a cópia só tem a que foi gravada.
 */
export function exampleHref(locale: Locale, href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, 'https://exemplo.local');
  } catch {
    return null;
  }
  if (url.origin !== 'https://exemplo.local') return null;
  // outra temporada ou outra data não estão na cópia gravada
  if (url.searchParams.has('temporada') || url.searchParams.has('data')) return null;
  if (url.pathname.startsWith('/exemplo/')) return href;
  const ids = exampleIds(locale);
  for (const page of EXAMPLE_PAGES) {
    if (url.pathname === `${APP_ROUTES[page]}${ids[page]}`) return `/exemplo/${page}${url.search}${url.hash}`;
  }
  return null;
}
