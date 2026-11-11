/**
 * Mapa único "ajuste → página" (#1070): para cada chave do registro (`@galaxie/runtime-config`), o item do menu de
 * Ajustes e o bloco da página onde ela é editada (ou mostrada, no caso das chaves). É a fonte das páginas, da busca e
 * dos links "ver em…". Regra: pela `section` do registro; exceções explícitas para as decisões A3 (modelos de IA em IA
 * interna), A4 (chaves em Credenciais), os `LINEUP_*` em Grades e ofertas e a divisão Ao vivo / Pós-jogo.
 */
import { settingDef, type SettingSection } from '@galaxie/runtime-config';

import type { PanelBlock, SettingsView } from './panel-tabs';
import { settingsItem } from './settings-items';

export interface SettingPage {
  /** Item do menu (e página) do ajuste. */
  item: SettingsView;
  /** Bloco da página que mostra a linha do ajuste. */
  block: PanelBlock;
  /** Busca da URL que abre a aba do bloco, quando ele não está na aba inicial (`aba=ajustes` em Grades e ofertas). */
  query?: string;
}

/** Página de cada seção do registro, quando nenhuma exceção vale. */
const SECTION_PAGE: Record<SettingSection, SettingPage> = {
  live: { item: 'live', block: 'live' },
  schedule: { item: 'schedule', block: 'schedule' },
  ai: { item: 'ai', block: 'ai' },
  wtw: { item: 'wtw', block: 'wtw' },
  related: { item: 'related', block: 'related' },
  provider: { item: 'provider', block: 'provider' },
  mirror: { item: 'mirror', block: 'mirror' },
  assets: { item: 'crests', block: 'assets' },
  credentials: { item: 'credentials', block: 'credentials' },
  feedback: { item: 'suggestions', block: 'suggestions' },
  cosmos: { item: 'cosmos', block: 'cosmos' },
  engage: { item: 'fanIdentity', block: 'engage' },
};

/** Modelos (e provedores) de IA que moram em outra seção do registro e vão para IA interna (A3). */
export const MOVED_AI_MODEL_KEYS = [
  'AI_MATCH_CHANNEL_PROVIDER',
  'AI_MATCH_CHANNEL_MODEL',
  'AI_RIGHTS_PROVIDER',
  'AI_RIGHTS_MODEL',
] as const;

/**
 * Chaves que ficam numa página de feature mas são editadas no cartão dela, não na lista de Credenciais: o token do
 * GitHub das sugestões é gravado junto com a repo (`FeedbackGithubCard`), e os segredos do Stripe são da Cosmos AI até
 * Pagamentos entrar em Credenciais.
 */
const SECRETS_KEPT_IN_PLACE = new Set([
  'FEEDBACK_GITHUB_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
]);

const isPostgame = (key: string) => key.startsWith('POSTGAME_');

/** Item e bloco do ajuste; undefined para uma chave que não está no registro. */
export function settingPage(key: string): SettingPage | undefined {
  const def = settingDef(key);
  if (!def) return undefined;
  if (def.type === 'secret' && !SECRETS_KEPT_IN_PLACE.has(key)) {
    return { item: 'credentials', block: 'credentials' };
  }
  if ((MOVED_AI_MODEL_KEYS as readonly string[]).includes(key)) return { item: 'ai', block: 'ai' };
  // em Grades e ofertas os LINEUP_* ficam na aba Ajustes (a inicial é a Revisão)
  if (key.startsWith('LINEUP_')) return { item: 'lineup', block: 'lineup', query: 'aba=ajustes' };
  if (def.section === 'live' && isPostgame(key)) return { item: 'postgame', block: 'postgame' };
  if (def.section === 'provider' && key.startsWith('APISPORTS_PLAN_')) {
    return { item: 'provider', block: 'sports' };
  }
  return SECTION_PAGE[def.section];
}

/** Bloco do ajuste (para filtrar as linhas de um cartão); undefined fora do registro. */
export const settingBlock = (key: string): PanelBlock | undefined => settingPage(key)?.block;

/** Link para a linha do ajuste na página dele (`/ajustes/ia#AI_RIGHTS_MODEL`, `/ajustes/grades?aba=ajustes#…`). */
export function settingHref(key: string): string | null {
  const page = settingPage(key);
  if (!page) return null;
  const query = page.query ? `?${page.query}` : '';
  return `${settingsItem(page.item).href}${query}#${key}`;
}
