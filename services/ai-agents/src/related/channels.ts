/**
 * Allowlist de canais do Conteúdo relacionado (docs/12 §3.1): no mesmo espírito da allowlist de
 * domínios do Onde Assistir, o canal define a confiança do vídeo. Detentores de direitos vêm da
 * tabela de direitos do país (`config/broadcast-rights`) com o handle tirado do dicionário de
 * emissoras (`youtube.com/@handle`) e de `config/related-content/channels.yaml`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { RelatedSourceTier } from '@galaxie/db';
import { defaultConfigRoot, type Blocklist, type WtwConfig } from '@galaxie/where-to-watch';

export interface ChannelEntry {
  /** Handle sem caixa, com "@" (ex.: "@palmeiras"). */
  handle: string | null;
  /** Id do canal (UC...), quando conhecido. */
  id: string | null;
  kind: 'club' | 'competition' | 'broadcaster' | 'media';
  /** Id do dicionário de emissoras (kind = broadcaster). */
  broadcaster: string | null;
  country: string | null;
  label: string | null;
}

export interface ChannelRef {
  id: string;
  title: string;
  handle: string | null;
  subscribers: number | null;
}

export interface ChannelVerdict {
  tier: RelatedSourceTier;
  entry: ChannelEntry | null;
  /** Canal na blocklist editorial: nunca aparece (o nome não é registrado). */
  blocked: boolean;
}

export class RelatedConfigError extends Error {}

const normHandle = (h: string): string => {
  const t = h.trim().toLowerCase();
  return t.startsWith('@') ? t : `@${t}`;
};

type Raw = Record<string, unknown>;

function parseEntries(list: unknown, kind: ChannelEntry['kind'], file: string): ChannelEntry[] {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new RelatedConfigError(`${file}: "${kind}" precisa ser uma lista.`);
  return list.map((raw, i) => {
    const r = (raw ?? {}) as Raw;
    const handle = typeof r.handle === 'string' && r.handle.trim() ? normHandle(r.handle) : null;
    const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : null;
    if (!handle && !id) throw new RelatedConfigError(`${file}: ${kind}[${i}] sem handle nem id.`);
    const label = [r.team, r.competition, r.broadcaster].find((v): v is string => typeof v === 'string');
    return {
      handle,
      id,
      kind,
      broadcaster: typeof r.broadcaster === 'string' ? r.broadcaster : null,
      country: typeof r.country === 'string' ? r.country.toUpperCase() : null,
      label: label ?? null,
    };
  });
}

/** Lê `config/related-content/channels.yaml`. */
export function loadChannelEntries(root = defaultConfigRoot()): ChannelEntry[] {
  const path = join(root, 'related-content', 'channels.yaml');
  if (!existsSync(path)) return [];
  const doc = (parse(readFileSync(path, 'utf8')) ?? {}) as Raw;
  const file = 'related-content/channels.yaml';
  return [
    ...parseEntries(doc.clubs, 'club', file),
    ...parseEntries(doc.competitions, 'competition', file),
    ...parseEntries(doc.broadcasters, 'broadcaster', file),
    ...parseEntries(doc.media, 'media', file),
  ];
}

/** Handles `youtube.com/@x` dos dicionários de emissoras → entradas `broadcaster`. */
export function broadcasterChannelsFrom(wtw: WtwConfig): ChannelEntry[] {
  const out: ChannelEntry[] = [];
  for (const country of wtw.countries) {
    for (const b of wtw.directory(country).broadcasters) {
      for (const d of b.domains) {
        const m = /^(?:www\.)?youtube\.com\/(@[\w.-]+)/i.exec(d.trim());
        if (m)
          out.push({
            handle: normHandle(m[1]!),
            id: null,
            kind: 'broadcaster',
            broadcaster: b.id,
            country,
            label: b.name,
          });
      }
    }
  }
  return out;
}

export interface AllowlistOptions {
  entries: ChannelEntry[];
  blocklist?: Blocklist;
  /** Mínimo de inscritos para um canal fora da allowlist virar `creator`. */
  creatorMinSubscribers?: number;
  /**
   * Mínimo de inscritos para uma entrada casada só pelo HANDLE valer (handle parecido com o do clube
   * costuma ser de terceiros). Entrada por id do canal não passa por este piso.
   */
  allowlistMinSubscribers?: number;
}

export const DEFAULT_CREATOR_MIN_SUBSCRIBERS = 100_000;
export const ALLOWLIST_MIN_SUBSCRIBERS = 10_000;

/** Allowlist resolvida para um evento: quem é detentor de direitos depende da competição e do país. */
export class ChannelAllowlist {
  private readonly byHandle = new Map<string, ChannelEntry[]>();
  private readonly byId = new Map<string, ChannelEntry[]>();
  readonly creatorMinSubscribers: number;
  readonly allowlistMinSubscribers: number;

  constructor(private readonly options: AllowlistOptions) {
    this.creatorMinSubscribers = options.creatorMinSubscribers ?? DEFAULT_CREATOR_MIN_SUBSCRIBERS;
    this.allowlistMinSubscribers = options.allowlistMinSubscribers ?? ALLOWLIST_MIN_SUBSCRIBERS;
    for (const e of options.entries) {
      if (e.handle) this.byHandle.set(e.handle, [...(this.byHandle.get(e.handle) ?? []), e]);
      if (e.id) this.byId.set(e.id, [...(this.byId.get(e.id) ?? []), e]);
    }
  }

  get size(): number {
    return this.options.entries.length;
  }

  entriesOf(channel: Pick<ChannelRef, 'id' | 'handle' | 'subscribers'>): ChannelEntry[] {
    const byHandle = channel.handle ? (this.byHandle.get(normHandle(channel.handle)) ?? []) : [];
    const tooSmall = channel.subscribers !== null && channel.subscribers < this.allowlistMinSubscribers;
    return [...(this.byId.get(channel.id) ?? []), ...(tooSmall ? [] : byHandle)];
  }

  /**
   * Tier do canal para o evento. `holders` = ids de emissoras detentoras da competição nos mercados
   * do evento (tabela de direitos); emissora da allowlist sem direitos conta como imprensa.
   */
  classify(channel: ChannelRef, holders: ReadonlySet<string>): ChannelVerdict {
    const blocklist = this.options.blocklist;
    const blocked =
      !!blocklist &&
      (blocklist.isBlockedName(channel.title) ||
        (channel.handle ? blocklist.isBlockedUrl(`https://www.youtube.com/${channel.handle}`) : false));
    const entries = this.entriesOf(channel);
    const pick = (kind: ChannelEntry['kind']) => entries.find((e) => e.kind === kind) ?? null;
    const club = pick('club') ?? pick('competition');
    if (club) return { tier: 'official', entry: club, blocked };
    const broadcasters = entries.filter((e) => e.kind === 'broadcaster');
    const holder = broadcasters.find((e) => e.broadcaster && holders.has(e.broadcaster));
    if (holder) return { tier: 'rights_holder', entry: holder, blocked };
    const media = broadcasters[0] ?? pick('media');
    if (media) return { tier: 'media', entry: media, blocked };
    if ((channel.subscribers ?? 0) >= this.creatorMinSubscribers)
      return { tier: 'creator', entry: null, blocked };
    return { tier: 'unknown', entry: null, blocked };
  }
}

/** Ids de emissoras detentoras da competição nos mercados, na data do jogo. */
export function rightsHoldersFor(
  wtw: WtwConfig,
  competitionSlug: string | null | undefined,
  markets: readonly string[],
  date: Date,
): Set<string> {
  const out = new Set<string>();
  for (const m of markets) {
    if (!wtw.has(m)) continue;
    const r = wtw.directory(m).rightsFor(competitionSlug, date);
    for (const h of [...(r?.holders ?? []), ...(r?.uncertainHolders ?? [])]) out.add(h);
  }
  return out;
}
