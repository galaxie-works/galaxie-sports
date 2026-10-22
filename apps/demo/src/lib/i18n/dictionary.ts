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
import media from './messages/media';
import event from './messages/event';
import live from './messages/live';
import nav from './messages/nav';
import pages from './messages/pages';
import requests from './messages/requests';
import shell from './messages/shell';
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
  event,
  live,
  media,
  nav,
  pages,
  requests,
  shell,
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
  'shell',
  'sport',
] as const;
export type ClientDictionary = Pick<Dictionary, (typeof CLIENT_NAMESPACES)[number]>;

export function clientDictionary(locale: Locale): ClientDictionary {
  const dict = DICTIONARIES[locale];
  return Object.fromEntries(CLIENT_NAMESPACES.map((ns) => [ns, dict[ns]])) as ClientDictionary;
}
