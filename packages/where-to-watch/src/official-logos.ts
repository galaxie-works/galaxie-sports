/**
 * Acervo oficial de logos (Figma): manifesto versionado em config/broadcasters/_official_logos.yaml.
 * Cada componente do acervo ("Letra/Nome do canal", com as versões clara e escura) é ligado a uma
 * emissora da biblioteca — como logo principal ou como logo de um canal dela (ESPN 2) — ou fica
 * "sem mapeamento" para a curadoria. Os arquivos não vão para o git: o importador do ingestor sobe
 * os SVGs no storage e registra core.asset com `sourceUrl = acervo-oficial://<nó>`; a sincronização
 * da biblioteca liga esses assets às emissoras, com precedência sobre os logos da Commons.
 */
import { normalizeName } from './normalize.js';

/** Esquema da origem dos assets do acervo (não é URL pública: o arquivo só existe no nosso storage). */
export const OFFICIAL_LOGO_SCHEME = 'acervo-oficial://';

/** Licença/observação gravada na biblioteca para logos do acervo. */
export const OFFICIAL_LOGO_LICENSE = 'Acervo oficial de logos — uso nominativo para identificar a emissora';

export const OFFICIAL_LOGO_STATUSES = ['primary', 'channel', 'variant', 'unmapped'] as const;
/**
 * primary = logo principal da emissora · channel = logo de um canal da emissora · variant = outra
 * versão (HD) de um logo já ligado · unmapped = sem emissora na biblioteca (curadoria).
 */
export type OfficialLogoStatus = (typeof OFFICIAL_LOGO_STATUSES)[number];

/** Componente do acervo, como lido do Figma (frame "Letra/Nome" com os símbolos de tema). */
export interface OfficialLogoComponent {
  /** Id do nó do frame do componente. */
  node: string;
  /** Nome no acervo ("E/ESPN HD"). */
  name: string;
  letter: string;
  /** Nó do símbolo da versão clara (ou da única versão). */
  light: string;
  /** Nó do símbolo da versão escura; null quando o componente só tem uma versão. */
  dark: string | null;
}

export interface OfficialLogoEntry {
  node: string;
  /** Nome do canal sem o prefixo da letra ("ESPN HD"). */
  name: string;
  letter: string;
  hd: boolean;
  light: string;
  dark: string | null;
  broadcaster: string | null;
  /** Canal da emissora quando o logo é de um canal (grafia do dicionário quando existir). */
  channel: string | null;
  status: OfficialLogoStatus;
  /** Mapeamento fixado pela curadoria: o planejamento não o recalcula. */
  curated: boolean;
  /** Observação da curadoria ou do planejamento (ex.: conflito com outro logo). */
  note: string | null;
}

export interface OfficialLogoManifest {
  source: { description: string; fileKey: string; node: string; importedAt: string };
  /** Nós de componentes deixados fora da biblioteca (marca própria de operadora): decisão da curadoria. */
  excludedNodes: string[];
  logos: OfficialLogoEntry[];
}

/** Emissora da biblioteca vista pelo mapeamento (subconjunto de LibraryEntry). */
export interface OfficialLogoTarget {
  id: string;
  name: string;
  aliases: string[];
  channels: string[];
}

export function officialLogoSourceUrl(node: string): string {
  return `${OFFICIAL_LOGO_SCHEME}${node}`;
}

/** Chave de comparação de nome de canal (a mesma do dicionário: `normalizeName`). */
export function channelKey(name: string): string {
  return normalizeName(name);
}

/**
 * Nome do componente → nome do canal, se é HD e o nome-base (sem HD). Tira o prefixo da letra
 * (inclusive repetido, "G/G/Globo"), espaços sobrando e o marcador "HD" ("Nick Jr. HD   ").
 */
export function officialLogoName(componentName: string): { name: string; base: string; hd: boolean } {
  const name = componentName
    .replace(/^(?:[^/\s]{1,3}\/)+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  const hd = /(^|\s)HD(\s|$)/u.test(name);
  const base = hd
    ? name
        .replace(/(^|\s)HD(?=\s|$)/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : name;
  return { name, base, hd };
}

/** Alias genérico demais para ligar um logo (o "Canal 4" do acervo não é o de todo país). */
function genericAlias(alias: string): boolean {
  return /^canal\s+\d+$/iu.test(alias.trim());
}

export interface OfficialLogoMatch {
  broadcaster: string;
  /** null = logo principal; senão, o canal. */
  channel: string | null;
  /** Força do casamento: nome/id (3) > canal (2) > alias (1). */
  strength: 1 | 2 | 3;
}

/**
 * Casa o nome-base de um componente com a biblioteca: nome ou id da emissora → logo principal;
 * canal do dicionário, alias com número ("Fox Sports 2") ou "<nome da emissora> <número>" → logo do
 * canal; outro alias (não genérico) → logo principal, mais fraco que o nome. Mais de uma emissora
 * com a mesma força = ambíguo (null).
 */
export function matchOfficialLogo(base: string, library: OfficialLogoTarget[]): OfficialLogoMatch | null {
  const key = normalizeName(base);
  if (!key) return null;
  const found: OfficialLogoMatch[] = [];
  for (const b of library) {
    if (normalizeName(b.name) === key || normalizeName(b.id.replace(/_/g, ' ')) === key) {
      found.push({ broadcaster: b.id, channel: null, strength: 3 });
      continue;
    }
    const channel = b.channels.find((c) => normalizeName(c) === key);
    if (channel) {
      found.push({ broadcaster: b.id, channel, strength: 2 });
      continue;
    }
    const numbered = base.match(/^(.*\S)\s+(\d+)$/u);
    if (numbered && normalizeName(numbered[1]!) === normalizeName(b.name)) {
      found.push({ broadcaster: b.id, channel: base, strength: 2 });
      continue;
    }
    const alias = b.aliases.find((a) => !genericAlias(a) && normalizeName(a) === key);
    if (alias) {
      const isChannel = /\s\d+$/u.test(alias.trim());
      found.push({ broadcaster: b.id, channel: isChannel ? alias : null, strength: isChannel ? 2 : 1 });
    }
  }
  if (!found.length) return null;
  const best = Math.max(...found.map((f) => f.strength));
  const top = found.filter((f) => f.strength === best);
  return top.length === 1 ? top[0]! : null;
}

/**
 * Planeja o manifesto: casa cada componente com a biblioteca e escolhe, por emissora (e por canal),
 * um único logo — o mais forte, e sem HD antes do HD. Os demais da mesma emissora/canal viram
 * `variant` (HD do mesmo nome) ou ficam `unmapped` com a nota do conflito. Entradas `curated` do
 * manifesto anterior são mantidas como estão, inclusive as de componentes fora do frame lido.
 */
export function planOfficialLogos(
  components: OfficialLogoComponent[],
  library: OfficialLogoTarget[],
  previous: OfficialLogoEntry[] = [],
): OfficialLogoEntry[] {
  const curated = new Map(previous.filter((p) => p.curated).map((p) => [p.node, p]));
  const names = new Map(library.map((b) => [b.id, b.name]));
  const entries: (OfficialLogoEntry & { strength: number })[] = components.map((c) => {
    const { name, base, hd } = officialLogoName(c.name);
    const fixed = curated.get(c.node);
    if (fixed) return { ...fixed, name, letter: c.letter, hd, light: c.light, dark: c.dark, strength: 4 };
    const m = matchOfficialLogo(base, library);
    return {
      node: c.node,
      name,
      letter: c.letter,
      hd,
      light: c.light,
      dark: c.dark,
      broadcaster: m?.broadcaster ?? null,
      channel: m?.channel ?? null,
      status: m ? (m.channel ? 'channel' : 'primary') : 'unmapped',
      curated: false,
      note: null,
      strength: m?.strength ?? 0,
    };
  });
  // curadoria de componente fora do frame lido (ex.: seção Premium Content): fica como está
  const seen = new Set(components.map((c) => c.node));
  for (const fixed of curated.values()) if (!seen.has(fixed.node)) entries.push({ ...fixed, strength: 4 });
  // um logo por (emissora, canal): curadoria > força do casamento > sem HD > ordem do acervo
  const slot = (e: OfficialLogoEntry) => `${e.broadcaster}\u0000${e.channel ? channelKey(e.channel) : ''}`;
  const groups = new Map<string, (OfficialLogoEntry & { strength: number })[]>();
  for (const e of entries) {
    if (!e.broadcaster || e.status === 'unmapped' || e.status === 'variant') continue;
    const list = groups.get(slot(e)) ?? [];
    list.push(e);
    groups.set(slot(e), list);
  }
  for (const list of groups.values()) {
    const ranked = [...list].sort((a, b) => b.strength - a.strength || Number(a.hd) - Number(b.hd));
    const winner = ranked[0]!;
    for (const e of ranked.slice(1)) {
      if (e.curated) continue;
      if (e.hd && officialLogoName(e.name).base === officialLogoName(winner.name).base) {
        e.status = 'variant';
        continue;
      }
      e.note = `conflito: "${winner.name}" já é o logo ${winner.channel ? `do canal ${winner.channel}` : 'principal'} de ${names.get(winner.broadcaster!) ?? winner.broadcaster}`;
      e.broadcaster = null;
      e.channel = null;
      e.status = 'unmapped';
    }
  }
  return entries.map(({ strength: _s, ...e }) => e);
}

/** Logos ligados a uma emissora: o principal e os dos canais (cada um com as versões clara e escura). */
export interface BroadcasterOfficialLogos {
  primary: OfficialLogoEntry | null;
  channels: OfficialLogoEntry[];
}

/** Agrupa as entradas `primary`/`channel` do manifesto por emissora. */
export function officialLogosByBroadcaster(
  manifest: OfficialLogoManifest | null,
): Map<string, BroadcasterOfficialLogos> {
  const out = new Map<string, BroadcasterOfficialLogos>();
  for (const e of manifest?.logos ?? []) {
    if (!e.broadcaster || (e.status !== 'primary' && e.status !== 'channel')) continue;
    const g = out.get(e.broadcaster) ?? { primary: null, channels: [] };
    if (e.status === 'primary') g.primary ??= e;
    else g.channels.push(e);
    out.set(e.broadcaster, g);
  }
  return out;
}
