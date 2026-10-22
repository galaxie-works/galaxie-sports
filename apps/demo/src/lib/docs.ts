import { FileCode2, KeyRound, Layers, Lightbulb, Radio, Rocket, type LucideIcon } from 'lucide-react';

import type { ApiRequest } from './galaxie/request';

export interface DocNav {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

/** Guias da documentação, na ordem da sidebar e da navegação "anterior/próximo". */
export const DOCS_NAV: DocNav[] = [
  {
    href: '/docs',
    label: 'Começando',
    description: 'URL base, primeira chamada e o mapa da API.',
    icon: Rocket,
  },
  {
    href: '/docs/autenticacao',
    label: 'Autenticação',
    description: 'Chave no header, conta, rotação e limites de uso.',
    icon: KeyRound,
  },
  {
    href: '/docs/conceitos',
    label: 'Conceitos',
    description: 'IDs canônicos, locales, cache/ETag, paginação e erros.',
    icon: Lightbulb,
  },
  {
    href: '/docs/modulos-e-planos',
    label: 'Módulos e planos',
    description: 'O que cada plano libera e como a API responde fora dele.',
    icon: Layers,
  },
  {
    href: '/docs/tempo-real',
    label: 'Tempo real',
    description: 'Change feed, SSE e webhooks assinados.',
    icon: Radio,
  },
  {
    href: '/docs/referencia',
    label: 'Referência da API',
    description: 'Todas as rotas do OpenAPI, com parâmetros e respostas.',
    icon: FileCode2,
  },
];

/** IDs reais da base usados nos exemplos (os mesmos das páginas da demo). */
export const SAMPLE = {
  team: '01a15fba-ec17-7d8b-90d7-47b3ccbe967e', // Palmeiras
  event: '01a163b8-68bc-7949-b05e-ed332d0f576a', // Palmeiras x Bahia (Brasileirão 2026)
  competition: 'brasileirao-serie-a',
  derby: 'choque-rei',
  venue: '01a15fba-ebde-7ef6-85fa-c16a585488ef',
} as const;

/** Chamadas usadas nos guias (o teste confere rota e parâmetros contra o OpenAPI). */
export const DOC_REQUESTS = {
  overview: {
    method: 'GET',
    route: '/v1/teams/{id}/overview',
    params: { id: SAMPLE.team },
    query: { locale: 'pt-BR', tz: 'America/Sao_Paulo' },
    description: 'Card do time: posição nas competições, forma, últimos jogos e próximo jogo.',
  },
  teamEvents: {
    method: 'GET',
    route: '/v1/teams/{id}/events',
    params: { id: SAMPLE.team },
    query: { from: '2026-10-01', limit: 5, tz: 'America/Sao_Paulo' },
    description: 'Jogos do time a partir de uma data.',
  },
  event: {
    method: 'GET',
    route: '/v1/events/{id}',
    params: { id: SAMPLE.event },
    query: { locale: 'pt-BR' },
    description: 'Evento completo.',
  },
  account: {
    method: 'GET',
    route: '/v1/account',
    description: 'Plano, módulos, mercados e a chave em uso.',
  },
  usage: {
    method: 'GET',
    route: '/v1/account/usage',
    query: { from: '2026-10-15', to: '2026-10-21' },
    description: 'Requisições por dia e rota.',
  },
  competitionEs: {
    method: 'GET',
    route: '/v1/competitions/{id}',
    params: { id: SAMPLE.competition },
    query: { locale: 'es-AR', tz: 'America/Argentina/Buenos_Aires' },
    description: 'A mesma competição com nomes e horários para a Argentina.',
  },
  competitions: {
    method: 'GET',
    route: '/v1/competitions',
    query: { sport: 'football', country: 'BR', limit: 50 },
    description: 'Competições de futebol do Brasil (primeira página).',
  },
  whereToWatch: {
    method: 'GET',
    route: '/v1/events/{id}/where-to-watch',
    params: { id: SAMPLE.event },
    query: { country: 'BR', locale: 'pt-BR' },
    description: 'Onde assistir o jogo no Brasil.',
  },
  semantic: {
    method: 'GET',
    route: '/v1/teams/{id}/semantic',
    params: { id: SAMPLE.team },
    query: { locale: 'pt-BR' },
    description: 'Cartão de identidade do time.',
  },
  live: {
    method: 'GET',
    route: '/v1/events/live',
    query: { sport: 'football' },
    description: 'Eventos ao vivo (polling com ETag).',
  },
} satisfies Record<string, ApiRequest>;
