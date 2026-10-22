import { FileCode2, KeyRound, Layers, Lightbulb, Radio, Rocket, type LucideIcon } from 'lucide-react';

import type { ApiRequest } from './galaxie/request';
import type { Locale } from './i18n/config';
import type { Dictionary } from './i18n/dictionary';

/** Chave do guia no dicionário: rótulo e descrição em `t.code.docsNav[id]`. */
export type DocNavId = keyof Dictionary['code']['docsNav'];

export interface DocNav {
  id: DocNavId;
  href: string;
  icon: LucideIcon;
}

/**
 * Guias da documentação, na ordem da sidebar e da navegação "anterior/próximo". Os textos ficam no
 * assunto `code` (vai ao navegador, onde a sidebar desenha): `t.code.docsNav[d.id].label`/`.description`.
 */
export const DOCS_NAV: DocNav[] = [
  { id: 'start', href: '/docs', icon: Rocket },
  { id: 'auth', href: '/docs/autenticacao', icon: KeyRound },
  { id: 'concepts', href: '/docs/conceitos', icon: Lightbulb },
  { id: 'modules', href: '/docs/modulos-e-planos', icon: Layers },
  { id: 'realtime', href: '/docs/tempo-real', icon: Radio },
  { id: 'reference', href: '/docs/referencia', icon: FileCode2 },
];

/** Guia de um caminho (`/docs/conceitos` → `concepts`). */
export const docNavByHref = (href: string) => DOCS_NAV.find((d) => d.href === href);

/** IDs reais da base usados nos exemplos (os mesmos das páginas da demo). */
export const SAMPLE = {
  team: '01a15fba-ec17-7d8b-90d7-47b3ccbe967e', // Palmeiras
  event: '01a163b8-68bc-7949-b05e-ed332d0f576a', // Palmeiras x Bahia (Brasileirão 2026)
  competition: 'brasileirao-serie-a',
  derby: 'choque-rei',
  venue: '01a15fba-ebde-7ef6-85fa-c16a585488ef',
} as const;

/**
 * `?locale`/`?tz` dos exemplos. A API fala pt-BR e espanhol (não inglês): a tela em espanhol mostra
 * es-AR com o fuso de Buenos Aires; português e inglês mostram pt-BR (o padrão da API e o mercado dos
 * IDs de exemplo, todos brasileiros).
 */
function sampleLocale(locale: Locale) {
  return locale === 'es-AR'
    ? ({ locale: 'es-AR', tz: 'America/Argentina/Buenos_Aires' } as const)
    : ({ locale: 'pt-BR', tz: 'America/Sao_Paulo' } as const);
}

/**
 * Chamadas usadas nos guias, com a descrição no idioma da tela (o teste confere rota e parâmetros
 * contra o OpenAPI em todos os idiomas). Recebe o que `getI18n()` devolve.
 */
export function docRequests({ locale, t }: { locale: Locale; t: Dictionary }) {
  const text = t.docs.requests;
  const sample = sampleLocale(locale);
  return {
    overview: {
      method: 'GET',
      route: '/v1/teams/{id}/overview',
      params: { id: SAMPLE.team },
      query: { locale: sample.locale, tz: sample.tz },
      description: text.overview,
    },
    teamEvents: {
      method: 'GET',
      route: '/v1/teams/{id}/events',
      params: { id: SAMPLE.team },
      query: { from: '2026-10-01', limit: 5, tz: sample.tz },
      description: text.teamEvents,
    },
    event: {
      method: 'GET',
      route: '/v1/events/{id}',
      params: { id: SAMPLE.event },
      query: { locale: sample.locale },
      description: text.event,
    },
    account: {
      method: 'GET',
      route: '/v1/account',
      description: text.account,
    },
    usage: {
      method: 'GET',
      route: '/v1/account/usage',
      query: { from: '2026-10-15', to: '2026-10-21' },
      description: text.usage,
    },
    // Sempre es-AR: é o exemplo de troca de locale e fuso (o guia de conceitos mostra o contraste).
    competitionEs: {
      method: 'GET',
      route: '/v1/competitions/{id}',
      params: { id: SAMPLE.competition },
      query: { locale: 'es-AR', tz: 'America/Argentina/Buenos_Aires' },
      description: text.competitionEs,
    },
    competitions: {
      method: 'GET',
      route: '/v1/competitions',
      query: { sport: 'football', country: 'BR', limit: 50 },
      description: text.competitions,
    },
    whereToWatch: {
      method: 'GET',
      route: '/v1/events/{id}/where-to-watch',
      params: { id: SAMPLE.event },
      query: { country: 'BR', locale: sample.locale },
      description: text.whereToWatch,
    },
    semantic: {
      method: 'GET',
      route: '/v1/teams/{id}/semantic',
      params: { id: SAMPLE.team },
      query: { locale: sample.locale },
      description: text.semantic,
    },
    live: {
      method: 'GET',
      route: '/v1/events/live',
      query: { sport: 'football' },
      description: text.live,
    },
  } satisfies Record<string, ApiRequest>;
}
