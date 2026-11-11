/**
 * Busca de ajustes (#1071): índice estático dos ajustes do registro (`@galaxie/runtime-config`) com os textos do
 * dicionário, no idioma da tela, e a busca sobre ele. Sem chamada ao servidor: a paleta (⌘K) e o campo do menu de
 * Ajustes montam o índice no navegador. Puro: sem React nem servidor.
 *
 * O lugar de cada ajuste vem de um resolvedor (`SettingPageResolver`): o `settingPage(key)` do #1070 quando ele
 * existir; até lá, `fallbackSettingPage`, que segue a `section` do registro e as rotas de hoje.
 */
import { foldSearchText } from '@galaxie/contracts';
import { SETTINGS, isSecret, type SettingDef } from '@galaxie/runtime-config';

import { settingText } from '@/components/ops/format';
import type { ClientDictionary } from '@/lib/i18n/dictionary';

type OpsTexts = ClientDictionary['ops'];

/** Onde um ajuste mora: item do menu (id), link da página, grupo do menu (id) e, se houver, a seção (id). */
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
  /** `/ajustes/<item>#<CHAVE>` (a página rola até a linha, ver `useSettingAnchor`). */
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
 * Seções do registro → item do menu de hoje (#1059) e a rota dele. Temporário: sai quando o `settingPage` do #1070
 * existir (ele divide Ao vivo e Pós-jogo e leva as chaves para Credenciais, regras A3/A4).
 */
const SECTION_PAGES: Record<SettingDef['section'], { item: string; href: string; group: string }> = {
  ai: { item: 'ai', href: '/ajustes/ia', group: 'platform' },
  assets: { item: 'system', href: '/ajustes/sistema', group: 'platform' },
  cosmos: { item: 'system', href: '/ajustes/sistema', group: 'platform' },
  credentials: { item: 'provider', href: '/ajustes/fornecedor', group: 'platform' },
  feedback: { item: 'system', href: '/ajustes/sistema', group: 'platform' },
  live: { item: 'operation', href: '/ajustes/operacao', group: 'platform' },
  mirror: { item: 'provider', href: '/ajustes/fornecedor', group: 'platform' },
  provider: { item: 'provider', href: '/ajustes/fornecedor', group: 'platform' },
  related: { item: 'features', href: '/ajustes/esportes?aba=related', group: 'data' },
  schedule: { item: 'operation', href: '/ajustes/operacao', group: 'platform' },
  wtw: { item: 'features', href: '/ajustes/esportes?aba=wtw', group: 'data' },
};

/** Resolvedor provisório: pela `section` do registro, nas rotas de hoje. */
export const fallbackSettingPage: SettingPageResolver = (key) => {
  const def = SETTINGS.find((s) => s.key === key);
  if (!def) return undefined;
  return { ...SECTION_PAGES[def.section], section: def.section };
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
export const settingHref = (href: string, key: string) => `${href.split('#')[0]}#${key}`;

/**
 * Índice de todos os ajustes do registro, na ordem do registro. Cada um com rótulo e descrição do dicionário, o
 * caminho (grupo › item › seção) e o link já na âncora. Chave sem lugar no resolvedor fica fora (o teste do
 * #1070 garante que não há nenhuma).
 */
export function buildSettingsIndex({
  t,
  pages,
  resolve = fallbackSettingPage,
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
      href: settingHref(ref.href, def.key),
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
    items: readonly { id: string; href: string; label: string; soon?: unknown }[];
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
        ...(item.soon ? { soon: true } : {}),
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

/** Abas internas das páginas de hoje (#1059), para o grupo Páginas achar "Pedidos das operadoras". */
export function currentSettingsTabs(
  t: Pick<ClientDictionary, 'ops' | 'lineup'>,
): Record<string, { id: string; label: string; href: string }[]> {
  const lineup = t.lineup.admin.tabs;
  return {
    lineup: (['revisao', 'pedidos', 'tenants'] as const).map((id) => ({
      id,
      label: lineup[id],
      href: `/ajustes/grades?aba=${id}`,
    })),
    features: (['sports', 'related', 'wtw'] as const).map((id) => ({
      id,
      label: t.ops.tabs[id],
      href: `/ajustes/esportes?aba=${id}`,
    })),
  };
}
