/**
 * Dicionários da demo, montados a partir dos assuntos em `messages/` (cada arquivo traz os três idiomas
 * lado a lado). Puro: o servidor lê inteiro; o navegador recebe só os assuntos de `CLIENT_NAMESPACES`.
 */
import { LOCALES, type Locale } from './config';
import admin from './messages/admin';
import auth from './messages/auth';
import code from './messages/code';
import common from './messages/common';
import docs from './messages/docs';
import docsUi from './messages/docs-ui';
import email from './messages/email';
import landing from './messages/landing';
import equestrian from './messages/equestrian';
import media from './messages/media';
import event from './messages/event';
import live from './messages/live';
import nav from './messages/nav';
import ops from './messages/ops';
import pages from './messages/pages';
import race from './messages/race';
import requests from './messages/requests';
import review from './messages/review';
import search from './messages/search';
import shell from './messages/shell';
import site from './messages/site';
import sport from './messages/sport';
import team from './messages/team';

export const NAMESPACES = {
  admin,
  auth,
  code,
  common,
  docs,
  docsUi,
  email,
  equestrian,
  event,
  landing,
  live,
  media,
  nav,
  ops,
  pages,
  race,
  requests,
  review,
  search,
  shell,
  site,
  sport,
  team,
};

type Namespaces = typeof NAMESPACES;
export type Dictionary = { [K in keyof Namespaces]: Namespaces[K]['pt-BR'] };

function build(locale: Locale): Dictionary {
  return Object.fromEntries(
    Object.entries(NAMESPACES).map(([name, messages]) => [name, messages[locale]]),
  ) as Dictionary;
}

export const DICTIONARIES = Object.fromEntries(LOCALES.map((l) => [l, build(l)])) as Record<
  Locale,
  Dictionary
>;

export const getDictionary = (locale: Locale): Dictionary => DICTIONARIES[locale];

/** Assuntos usados por componentes do navegador (vão no payload da página, por isso só estes). */
export const CLIENT_NAMESPACES = [
  'admin',
  'auth',
  'code',
  'common',
  'docsUi',
  'live',
  'media',
  'nav',
  'ops',
  'review',
  'search',
  'shell',
  'sport',
] as const;
type ClientNamespace = (typeof CLIENT_NAMESPACES)[number];
export type ClientDictionary = Pick<Dictionary, ClientNamespace>;

/**
 * Páginas públicas (apresentação, login, termos e privacidade): só o que os componentes delas usam. Os
 * textos do app logado (operação, administração, código) não vão no HTML de quem não entrou.
 */
export const PUBLIC_NAMESPACES = ['auth', 'common', 'shell'] as const satisfies readonly ClientNamespace[];

/** Exemplo público: as páginas de jogo, time, campeonato e jogador, sem busca, código e operação. */
export const EXAMPLE_NAMESPACES = [
  'common',
  'live',
  'media',
  'nav',
  'shell',
  'sport',
] as const satisfies readonly ClientNamespace[];

/**
 * Assuntos do dicionário para o navegador. Com uma lista menor, o tipo continua o do app inteiro: quem
 * monta a árvore garante que os componentes dela só leem os assuntos enviados.
 */
export function clientDictionary(
  locale: Locale,
  namespaces: readonly ClientNamespace[] = CLIENT_NAMESPACES,
): ClientDictionary {
  const dict = DICTIONARIES[locale];
  return Object.fromEntries(namespaces.map((ns) => [ns, dict[ns]])) as ClientDictionary;
}
