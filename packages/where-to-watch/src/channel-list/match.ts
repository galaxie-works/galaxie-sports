/**
 * Casamento determinístico da lista do cliente com os direitos (antes de qualquer IA): o dicionário de
 * emissoras e os apelidos (config/broadcasters) decidem `exato`, `feed_generico` e `nome_divergente`;
 * o que sobra (direito sem candidato e canal sem uso) vai para a IA, que só escolhe índices.
 */
import type { WtwConfig } from '../config/directory.js';
import type { WtwCountry } from '../config/types.js';
import { normalizeName } from '../normalize.js';
import {
  matchBase,
  rightAccess,
  rightKey,
  type ChannelFacts,
  type ChannelRight,
  type RightMatch,
} from './types.js';

/** Dicionário por país usado no casamento: nome inteiro e prefixo de marca. */
export class ChannelDictionary {
  private readonly prefixes = new Map<WtwCountry, { tokens: string[]; id: string }[]>();

  constructor(readonly config: WtwConfig) {
    for (const country of config.countries) {
      const list: { tokens: string[]; id: string }[] = [];
      for (const b of config.directory(country).broadcasters)
        for (const n of [b.name, ...b.aliases, ...b.channels, ...b.regionalVariants.map((v) => v.name)]) {
          const tokens = splitTokens(n);
          if (tokens.length) list.push({ tokens, id: b.id });
        }
      // o nome mais longo primeiro ("TNT Sports Premium" antes de "TNT Sports")
      this.prefixes.set(
        country,
        list.sort((a, b) => b.tokens.length - a.tokens.length),
      );
    }
  }

  get countries(): WtwCountry[] {
    return this.config.countries;
  }

  /** Emissora do país pelo nome inteiro do canal (nome, apelido, canal ou afiliada); null = nenhuma. */
  resolve(country: WtwCountry, ch: ChannelFacts): string | null {
    const d = this.config.directory(country);
    for (const text of [ch.base, ch.brand, ch.brandNoFeed]) {
      const r = d.resolve(text);
      if (r) return r.entry.id;
    }
    return null;
  }

  /**
   * Mesma marca com sufixo a mais ("CHILEVISION SPORTS" → Chilevisión + "SPORTS"): a emissora e o
   * sufixo. Só quando o nome inteiro não é de outra emissora do país.
   */
  prefix(country: WtwCountry, ch: ChannelFacts): { id: string; suffix: string } | null {
    const tokens = splitTokens(ch.brandNoFeed);
    for (const p of this.prefixes.get(country) ?? []) {
      if (p.tokens.length >= tokens.length) continue;
      if (p.tokens.every((t, i) => tokens[i] === t)) {
        const suffix = ch.brandNoFeed.split(/\s+/).slice(p.tokens.length).join(' ');
        return { id: p.id, suffix };
      }
    }
    return null;
  }

  /** Nome, apelidos, canais e afiliadas de uma emissora no país. */
  namesOf(country: WtwCountry, broadcasterId: string): string[] {
    const b = this.config.directory(country).byIdOrNull(broadcasterId);
    return b ? [b.name, ...b.aliases, ...b.channels, ...b.regionalVariants.map((v) => v.name)] : [];
  }

  /** Países em que o nome inteiro do canal é uma emissora. */
  countriesResolving(ch: ChannelFacts): Map<WtwCountry, string> {
    const out = new Map<WtwCountry, string>();
    for (const c of this.countries) {
      const id = this.resolve(c, ch);
      if (id) out.set(c, id);
    }
    return out;
  }
}

const splitTokens = (s: string) => s.split(/\s+/).map(normalizeName).filter(Boolean);

/** Direitos numerados a partir do dicionário: cada emissora de cada país pedido é um direito. */
export function universeRights(
  config: WtwConfig,
  countries: readonly string[] = config.countries,
): ChannelRight[] {
  const out: ChannelRight[] = [];
  for (const c of countries) {
    if (!config.has(c)) continue;
    const d = config.directory(c);
    for (const b of d.broadcasters) {
      if (config.blocklist.isBlockedName(b.name)) continue;
      out.push({
        idx: out.length,
        country: d.country,
        broadcasterId: b.id,
        name: b.name,
        medium: b.medium,
        accessModel: b.accessModel,
        access: rightAccess(b.medium),
      });
    }
  }
  return out;
}

/** Canal efetivo: país do nome/grupo/lista ou, sem país, o único país em que a marca existe. */
export interface ResolvedChannel {
  facts: ChannelFacts;
  /** País do canal; null = pan-regional (marca que existe em mais de um país, sem país no nome). */
  country: WtwCountry | null;
}

export function resolveChannels(channels: ChannelFacts[], dict: ChannelDictionary): ResolvedChannel[] {
  return channels.map((facts) => {
    if (facts.country || facts.pan) return { facts, country: facts.country };
    const where = dict.countriesResolving(facts);
    const ids = new Set(where.values());
    // marca de um país só ("GLOBO RJ", sem prefixo): o canal é desse país
    if (where.size === 1 && ids.size === 1) {
      const [country] = where.keys();
      return { facts: { ...facts, country: country!, countryFrom: 'emissora' }, country: country! };
    }
    return { facts, country: null };
  });
}

export interface DeterministicResult {
  /** Direitos decididos pelo código (com canal). */
  decided: RightMatch[];
  /** Direitos sem candidato: vão para a IA (ou ficam `sem_canal_na_lista`). */
  leftoverRights: ChannelRight[];
  /** Canais ao vivo sem uso: candidatos da IA. */
  leftoverChannels: ResolvedChannel[];
}

/**
 * Para cada direito linear: canais do país com o nome da emissora → `exato` (todas as praças entram);
 * senão, canal pan-regional com o nome → `feed_generico`; senão, mesma marca com sufixo →
 * `nome_divergente`. Direito só de streaming nunca casa aqui (canal da lista é linear). VOD nunca casa.
 */
export function matchDeterministic(
  rights: ChannelRight[],
  channels: ResolvedChannel[],
  dict: ChannelDictionary,
): DeterministicResult {
  const live = channels.filter((c) => !c.facts.vod);
  const decided: RightMatch[] = [];
  const leftoverRights: ChannelRight[] = [];
  const used = new Set<number>();
  const base = matchBase;

  for (const r of rights) {
    if (r.access === 'streaming') {
      leftoverRights.push(r);
      continue;
    }
    const sameName = (c: ResolvedChannel) => dict.resolve(r.country, c.facts) === r.broadcasterId;
    const exact = live.filter((c) => c.country === r.country && sameName(c));
    if (exact.length) {
      decided.push({
        ...base(r),
        match: 'exato',
        channels: exact.map((c) => c.facts.idx),
        origin: 'codigo',
        note: null,
      });
      exact.forEach((c) => used.add(c.facts.idx));
      continue;
    }
    const generic = live.filter((c) => c.country === null && sameName(c));
    if (generic.length) {
      decided.push({
        ...base(r),
        match: 'feed_generico',
        channels: generic.map((c) => c.facts.idx),
        origin: 'codigo',
        note: null,
      });
      generic.forEach((c) => used.add(c.facts.idx));
      continue;
    }
    const divergent = live
      .filter((c) => (c.country === r.country || c.country === null) && !dict.resolve(r.country, c.facts))
      .map((c) => ({ c, p: dict.prefix(r.country, c.facts) }))
      .filter((x) => x.p?.id === r.broadcasterId);
    if (divergent.length) {
      const suffixes = [...new Set(divergent.map((x) => x.p!.suffix))];
      decided.push({
        ...base(r),
        match: 'nome_divergente',
        channels: divergent.map((x) => x.c.facts.idx),
        origin: 'codigo',
        note: `Mesma marca com sufixo diferente (${suffixes.map((s) => `"${s}"`).join(', ')}): confirme se é o sinal de ${r.name}.`,
      });
      divergent.forEach((x) => used.add(x.c.facts.idx));
      continue;
    }
    leftoverRights.push(r);
  }
  return {
    decided,
    leftoverRights,
    leftoverChannels: live.filter((c) => !used.has(c.facts.idx)),
  };
}

/** `sem_canal_na_lista` para os direitos que ninguém casou. */
export function noChannel(
  r: ChannelRight,
  origin: RightMatch['origin'] = 'codigo',
  note: string | null = null,
): RightMatch {
  return { ...matchBase(r), match: 'sem_canal_na_lista', channels: [], origin, note };
}

/** Junta as decisões (as posteriores vencem) na ordem dos direitos. */
export function mergeMatches(rights: ChannelRight[], ...layers: RightMatch[][]): RightMatch[] {
  const by = new Map<string, RightMatch>();
  for (const layer of layers) for (const m of layer) by.set(rightKey(m), m);
  return rights.map((r) => by.get(rightKey(r)) ?? noChannel(r));
}
