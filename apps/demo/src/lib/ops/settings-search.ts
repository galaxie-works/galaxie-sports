/**
 * Busca de ajustes (#1071): índice estático dos ajustes do registro (`@galaxie/runtime-config`) com os textos do
 * dicionário, no idioma da tela, e a busca sobre ele. Sem chamada ao servidor: a paleta (⌘K) e o campo do menu de
 * Ajustes montam o índice no navegador. Puro: sem React nem servidor.
 *
 * O lugar de cada ajuste vem de um resolvedor (`SettingPageResolver`); o padrão é `resolveSettingPage`, sobre o mapa
 * único ajuste → página do #1070 (`settingPage`).
 */
import { foldSearchText } from '@galaxie/contracts';
import { SETTINGS, isSecret } from '@galaxie/runtime-config';

import { settingText } from '@/components/ops/format';
import type { ClientDictionary } from '@/lib/i18n/dictionary';

import { SETTINGS_VIEWS } from './panel-tabs';
import { settingPage } from './setting-page';
import { settingsItem } from './settings-items';

type OpsTexts = ClientDictionary['ops'];

/**
 * Onde um ajuste mora: item do menu (id), link da página (com a busca da aba, quando o ajuste não está na aba inicial:
 * `/ajustes/grades?aba=ajustes`), grupo do menu (id) e, se houver, a seção (id).
 */
export interface SettingPageRef {
  item: string;
  href: string;
  group: string;
  section?: string;
}

/** Contrato do `settingPage(key)` (#1070): `undefined` quando a chave não tem lugar. */
export type SettingPageResolver = (key: string) => SettingPageRef | undefined;

/** Uma página do menu de Ajustes (ou uma aba interna dela), já no idioma da tela. */
export interface SettingsSearchPage {
  /** Id do item do menu (o mesmo que o resolvedor devolve em `item`); aba interna: `<item>:<aba>`. */
  id: string;
  href: string;
  label: string;
  /** Rótulo do grupo do menu. */
  group: string;
  /** Id do grupo do menu. */
  groupId?: string;
  /** Aba interna: rótulo da página que a contém (entra no caminho). */
  parent?: string;
  /** Item planejado ("Em breve", #1068). */
  soon?: boolean;
}

/** Um ajuste no índice: o que a paleta mostra e para onde leva. */
export interface SettingsSearchEntry {
  key: string;
  label: string;
  description: string;
  /** `/ajustes/<item>[?aba=…]#<CHAVE>` (a página rola até a linha, ver `useSettingAnchor`). */
  href: string;
  /** Caminho: grupo › item › seção. */
  crumbs: string[];
  item: string;
  group: string;
  section?: string;
  secret: boolean;
  /** Textos já dobrados (sem acento, minúsculos) para casar. */
  folded: {
    key: string;
    label: string;
    aliases: string[];
    crumbs: string;
    description: string;
    /** Unidade mostrada ao lado do valor ("min", "%"). */
    unit: string;
  };
}

/**
 * Lugar de cada ajuste no menu de Ajustes, pelo `settingPage` do #1070: item, rota (com a aba, como no `settingHref`:
 * os `LINEUP_*` ficam na aba Ajustes de Grades e ofertas) e grupo do menu. A seção (o bloco
 * da página) só entra no caminho quando a página tem mais de um bloco (Fornecedor e cota › Esportes); com um só, ela
 * repetiria a página.
 */
export const resolveSettingPage: SettingPageResolver = (key) => {
  const page = settingPage(key);
  if (!page) return undefined;
  const item = settingsItem(page.item);
  const multi = SETTINGS_VIEWS[page.item].length > 1;
  const href = page.query ? `${item.href}?${page.query}` : item.href;
  return { item: page.item, href, group: item.group, ...(multi ? { section: page.block } : {}) };
};

/**
 * Outros nomes com que o ajuste aparece na tela (ex.: o teto global em US$ no cartão Política de IA), para a busca
 * achar pelo texto que a pessoa vê na página.
 */
function aliasesOf(t: OpsTexts, key: string): string[] {
  switch (key) {
    case 'AI_DAILY_USD_BUDGET':
      return [t.aiPolicy.dailyUsd.label, t.aiPolicy.dailyUsd.description];
    case 'AI_P0_MIN_AUDIENCE':
      return [t.aiPolicy.minAudience.label, t.aiPolicy.minAudience.description];
    default:
      return [];
  }
}

/** Junta link e âncora (o link pode já ter `?aba=`). */
export const withSettingAnchor = (href: string, key: string) => `${href.split('#')[0]}#${key}`;

/**
 * Índice de todos os ajustes do registro, na ordem do registro. Cada um com rótulo e descrição do dicionário, o
 * caminho (grupo › item › seção) e o link já na âncora. Chave sem lugar no resolvedor fica fora (o teste do
 * #1070 garante que não há nenhuma).
 */
export function buildSettingsIndex({
  t,
  pages,
  resolve = resolveSettingPage,
  sectionLabel,
  groupLabel,
}: {
  t: OpsTexts;
  /** Itens do menu (dão o rótulo do item e do grupo no caminho). */
  pages: readonly SettingsSearchPage[];
  resolve?: SettingPageResolver;
  /** Rótulo da seção; o padrão são os títulos das seções do painel (`ops.sections`). */
  sectionLabel?: (section: string) => string | undefined;
  /** Rótulo do grupo quando nenhum item do menu o traz; o padrão são os grupos de `ops.nav.groups`. */
  groupLabel?: (group: string) => string | undefined;
}): SettingsSearchEntry[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const sectionOf =
    sectionLabel ?? ((s: string) => (t.sections as Record<string, { title: string } | undefined>)[s]?.title);
  const groupOf = groupLabel ?? ((g: string) => (t.nav.groups as Record<string, string | undefined>)[g]);
  const out: SettingsSearchEntry[] = [];
  for (const def of SETTINGS) {
    const ref = resolve(def.key);
    if (!ref) continue;
    const text = settingText(t, def);
    const page = byId.get(ref.item);
    const crumbs = [
      page?.group ?? groupOf(ref.group) ?? ref.group,
      page?.label ?? ref.item,
      ...(ref.section ? [sectionOf(ref.section)] : []),
    ].filter((c): c is string => !!c);
    // seção com o mesmo nome da página (ex.: Webhooks › Webhooks) não repete no caminho
    const unique = crumbs.filter((c, i) => i === 0 || foldSearchText(c) !== foldSearchText(crumbs[i - 1]!));
    const aliases = aliasesOf(t, def.key);
    out.push({
      key: def.key,
      label: text.label,
      description: text.description,
      href: withSettingAnchor(ref.href, def.key),
      crumbs: unique,
      item: ref.item,
      group: ref.group,
      ...(ref.section ? { section: ref.section } : {}),
      secret: isSecret(def),
      folded: {
        key: def.key.toLowerCase(),
        label: foldSearchText(text.label),
        aliases: aliases.map(foldSearchText),
        crumbs: foldSearchText(unique.join(' ')),
        description: foldSearchText(text.description),
        unit: foldSearchText(text.unit ?? ''),
      },
    });
  }
  return out;
}

/** Palavras de um texto dobrado (separa em espaço, pontuação e hífen: "pos-jogo" → "pos", "jogo"). */
const words = (folded: string) => folded.split(/[^a-z0-9_$]+/).filter(Boolean);

/**
 * A palavra da busca casa com o começo de alguma palavra do texto, ou o contrário quando a do texto tem 3+ letras
 * (abreviação e plural: "minutos" casa com "min", "jogos" com "jogo").
 */
const hasWord = (folded: string, token: string) =>
  words(folded).some((w) => w.startsWith(token) || (w.length >= 3 && token.startsWith(w)));

/** A palavra casa com a chave técnica: trecho com `_` em qualquer lugar; sem `_`, começo de uma parte. */
const hasKey = (key: string, token: string) =>
  token.includes('_') ? key.includes(token) : key.split('_').some((p) => p.startsWith(token));

/**
 * Posição do ajuste para o termo (menor vem antes); `null` quando não casa. Ordem: chave exata, começo da chave,
 * rótulo que começa pelo termo, todas as palavras no rótulo, no rótulo/chave/caminho e, por fim, em qualquer
 * texto (descrição incluída).
 */
export function settingScore(entry: SettingsSearchEntry, query: string): number | null {
  const term = foldSearchText(query);
  if (!term) return null;
  const { folded } = entry;
  const keyTerm = term.replace(/ /g, '_');
  if (folded.key === keyTerm) return 0;
  if (folded.key.startsWith(keyTerm) && keyTerm.length >= 2) return 1;
  const labels = [folded.label, ...folded.aliases];
  if (labels.some((l) => l.startsWith(term))) return 2;
  const tokens = words(term);
  const inLabel = (tok: string) => labels.some((l) => hasWord(l, tok));
  if (tokens.every(inLabel)) return 3;
  const inNear = (tok: string) =>
    inLabel(tok) || hasKey(folded.key, tok) || hasWord(folded.crumbs, tok) || hasWord(folded.unit, tok);
  // empate dentro da faixa: mais palavras no rótulo (faixa 4) ou perto dele (faixa 5) vem antes
  const missing = (test: (tok: string) => boolean) =>
    (tokens.length - tokens.filter(test).length) / tokens.length;
  if (tokens.every(inNear)) return 4 + missing(inLabel) / 2;
  if (tokens.every((tok) => inNear(tok) || hasWord(folded.description, tok))) return 5 + missing(inNear) / 2;
  return null;
}

/** Ajustes que casam com o termo, do mais ao menos parecido (empate: ordem do registro). */
export function searchSettings(
  index: readonly SettingsSearchEntry[],
  query: string,
  limit = 8,
): SettingsSearchEntry[] {
  const scored: { e: SettingsSearchEntry; score: number; i: number }[] = [];
  index.forEach((e, i) => {
    const score = settingScore(e, query);
    if (score !== null) scored.push({ e, score, i });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.e);
}

/** Páginas (itens do menu e abas internas) que casam com o termo: rótulo antes do grupo. */
export function searchSettingsPages(
  pages: readonly SettingsSearchPage[],
  query: string,
  limit = 5,
): SettingsSearchPage[] {
  const term = foldSearchText(query);
  if (!term) return [];
  const tokens = words(term);
  const scored: { p: SettingsSearchPage; score: number; i: number }[] = [];
  pages.forEach((p, i) => {
    const label = foldSearchText(p.label);
    const around = foldSearchText([p.group, p.parent ?? ''].join(' '));
    let score = -1;
    if (label.startsWith(term)) score = 0;
    else if (tokens.every((tok) => hasWord(label, tok))) score = 1;
    else if (tokens.every((tok) => hasWord(label, tok) || hasWord(around, tok))) score = 2;
    if (score >= 0) scored.push({ p, score, i });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.p);
}

/** Caminho de uma página: grupo (› página que contém a aba). */
export const pageCrumbs = (p: SettingsSearchPage) => (p.parent ? [p.group, p.parent] : [p.group]);

/** Itens do menu agrupado (`settingsNavGroups`) como páginas da busca, com as abas internas de cada item. */
export function settingsSearchPages(
  groups: readonly {
    id: string;
    label: string;
    /** `soon` (item planejado) ou `muted`, como a folha do menu (`settingsNavGroups`) marca o "Em breve". */
    items: readonly { id: string; href: string; label: string; soon?: unknown; muted?: boolean }[];
  }[],
  tabs: Readonly<Record<string, readonly { id: string; label: string; href: string }[]>> = {},
): SettingsSearchPage[] {
  return groups.flatMap((g) =>
    g.items.flatMap((item) => [
      {
        id: item.id,
        href: item.href,
        label: item.label,
        group: g.label,
        groupId: g.id,
        ...(item.soon || item.muted ? { soon: true } : {}),
      },
      ...(tabs[item.id] ?? []).map((tab) => ({
        id: `${item.id}:${tab.id}`,
        href: tab.href,
        label: tab.label,
        group: g.label,
        groupId: g.id,
        parent: item.label,
      })),
    ]),
  );
}

/** Abas internas das páginas de Ajustes (Grades e ofertas), para o grupo Páginas achar "Pedidos das operadoras". */
export function currentSettingsTabs(
  t: Pick<ClientDictionary, 'lineup'>,
): Record<string, { id: string; label: string; href: string }[]> {
  const lineup = t.lineup.admin.tabs;
  const href = settingsItem('lineup').href;
  return {
    lineup: (['revisao', 'pedidos', 'tenants', 'ajustes'] as const).map((id) => ({
      id,
      label: lineup[id],
      href: `${href}?aba=${id}`,
    })),
  };
}
