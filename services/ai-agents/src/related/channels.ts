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
import { matchText } from './policy.js';

export interface ChannelEntry {
  /** Handle sem caixa, com "@" (ex.: "@palmeiras"). */
  handle: string | null;
  /** Id do canal (UC...), quando conhecido. */
  id: string | null;
  kind: 'club' | 'competition' | 'broadcaster' | 'media';
  /** Id do dicionário de emissoras (kind = broadcaster). */
  broadcaster: string | null;
  country: string | null;
  /** Nome do time (club) ou slug da competição (competition) no channels.yaml; título do canal no mapa. */
  label: string | null;
  /** Time do canal (kind = club, entradas do mapa `enrich.related_channel`). */
  participantId?: string | null;
  /** Competição do canal (kind = competition, entradas do mapa). */
  competitionId?: string | null;
  /**
   * De onde veio: `config` (channels.yaml, dicionário de emissoras) ou `wikidata` (P2397 do time/competição,
   * mapa em enrich.related_channel). Entrada do Wikidata por id passa pelo piso de inscritos: o dado é aberto.
   */
  source?: 'config' | 'wikidata';
}

export interface ChannelRef {
  id: string;
  title: string;
  handle: string | null;
  subscribers: number | null;
}

/** O jogo a que o vídeo é atribuído: canal de clube ou de competição só é oficial se for deste jogo. */
export interface ChannelScope {
  /** Os dois times do jogo. */
  participantIds: readonly string[];
  /** Variantes normalizadas dos nomes dos dois times (`teamVariants`), para as entradas sem time ligado. */
  teamNames: readonly string[];
  competitionId: string | null;
  competitionSlug: string | null;
}

/**
 * Slug da competição casa com o rótulo do channels.yaml: igual, ou, quando o rótulo é uma federação (sem
 * hífen), toda competição dela (`conmebol` → `conmebol-libertadores`, `conmebol-sudamericana`; `uefa` →
 * `uefa-champions-league`). Rótulo de competição (`conmebol-libertadores`) só casa com o próprio slug.
 */
export function competitionLabelMatches(label: string, slug: string): boolean {
  const l = label.trim().toLowerCase();
  return slug === l || (!l.includes('-') && slug.startsWith(`${l}-`));
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
    const byId = (this.byId.get(channel.id) ?? []).filter((e) => !(tooSmall && e.source === 'wikidata'));
    return [...byId, ...(tooSmall ? [] : byHandle)];
  }

  /**
   * Tier do canal para o evento. `holders` = ids de emissoras detentoras da competição nos mercados
   * do evento (tabela de direitos); emissora da allowlist sem direitos conta como imprensa. Com `scope`,
   * canal de clube só é oficial se o clube joga o jogo, e canal de competição se for a do jogo (ou a
   * federação dela); o canal de outro clube ou de outra competição conta como imprensa.
   */
  classify(channel: ChannelRef, holders: ReadonlySet<string>, scope?: ChannelScope): ChannelVerdict {
    const blocklist = this.options.blocklist;
    const blocked =
      !!blocklist &&
      (blocklist.isBlockedName(channel.title) ||
        (channel.handle ? blocklist.isBlockedUrl(`https://www.youtube.com/${channel.handle}`) : false));
    const entries = this.entriesOf(channel);
    const pick = (kind: ChannelEntry['kind']) => entries.find((e) => e.kind === kind) ?? null;
    const own = (e: ChannelEntry) => !scope || ofEvent(e, scope);
    const official = entries.filter((e) => e.kind === 'club' || e.kind === 'competition');
    const club =
      official.find((e) => e.kind === 'club' && own(e)) ??
      official.find((e) => e.kind === 'competition' && own(e));
    if (club) return { tier: 'official', entry: club, blocked };
    const broadcasters = entries.filter((e) => e.kind === 'broadcaster');
    const holder = broadcasters.find((e) => e.broadcaster && holders.has(e.broadcaster));
    if (holder) return { tier: 'rights_holder', entry: holder, blocked };
    const media = broadcasters[0] ?? pick('media') ?? official[0];
    if (media) return { tier: 'media', entry: media, blocked };
    if ((channel.subscribers ?? 0) >= this.creatorMinSubscribers)
      return { tier: 'creator', entry: null, blocked };
    return { tier: 'unknown', entry: null, blocked };
  }
}

/** A entrada de clube/competição é do jogo? Pelo time/competição ligado no mapa, ou pelo rótulo do channels.yaml. */
function ofEvent(e: ChannelEntry, scope: ChannelScope): boolean {
  if (e.kind === 'club') {
    if (e.participantId) return scope.participantIds.includes(e.participantId);
    const name = e.label ? matchText(e.label).trim() : '';
    return !!name && scope.teamNames.includes(name);
  }
  if (e.kind === 'competition') {
    if (e.competitionId) return e.competitionId === scope.competitionId;
    return !!e.label && !!scope.competitionSlug && competitionLabelMatches(e.label, scope.competitionSlug);
  }
  return true;
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
