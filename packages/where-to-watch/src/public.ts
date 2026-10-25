/** Leitura pública do onde assistir (GET /v1/events/{id}/where-to-watch, docs/05 §4). */
import { and, eq, isNull } from 'drizzle-orm';
import { broadcastOption, competition, event, season, type Database } from '@galaxie/db';
import type { WtwConfig } from './config/directory.js';
import type { AccessModel, BroadcastMedium, Evidence, SourceKind } from '@galaxie/db';
import { listBroadcasters } from './library.js';
import {
  currentMatchChannels,
  MATCH_CHANNEL_PRODUCER,
  matchChannelState,
  matchPhaseOf,
  type MatchChannelRow,
  type MatchChannelState,
  type MatchPhase,
} from './match-channel.js';
import { isHttpUrl } from './normalize.js';
import { channelKey } from './official-logos.js';
import { currentResearchedRights, ResearchedRightsIndex } from './rights-research.js';
import { effectiveRights } from './rights.js';
import { isEditorial, type BroadcastOptionRow } from './store.js';

/** Mensagem quando não há informação confiável — o evento continua existindo. */
export const UNKNOWN_MESSAGES: Record<string, string> = {
  'pt-BR': 'Não temos as informações de transmissão ainda.',
  'es-AR': 'Todavía no tenemos la información de transmisión.',
  'es-MX': 'Todavía no tenemos la información de transmisión.',
  'es-CO': 'Todavía no tenemos la información de transmisión.',
  'es-CL': 'Todavía no tenemos la información de transmisión.',
  'es-PE': 'Todavía no tenemos la información de transmisión.',
  'es-UY': 'Todavía no tenemos la información de transmisión.',
  'es-EC': 'Todavía no tenemos la información de transmisión.',
};

export function unknownMessage(locale: string): string {
  return (
    UNKNOWN_MESSAGES[locale] ??
    (locale.startsWith('es') ? UNKNOWN_MESSAGES['es-AR']! : UNKNOWN_MESSAGES['pt-BR']!)
  );
}

/** Ordem de exibição sugerida por meio (a ordenação final por direito de acesso é do cliente). */
export const MEDIUM_ORDER = [
  'free_tv',
  'youtube',
  'streaming_free',
  'pay_tv',
  'streaming_svod',
  'official_app',
  'radio',
] as const;

export interface PublicSource {
  publisher: string;
  url: string;
}

/**
 * Logo da emissora (biblioteca) — o do canal da opção quando o acervo oficial tem um: chave no nosso
 * storage, versão para fundo escuro e URL de origem (só http; o acervo oficial não tem URL pública).
 */
export interface PublicLogo {
  storageKey: string | null;
  darkStorageKey: string | null;
  sourceUrl: string | null;
}

export interface PublicOption {
  row: BroadcastOptionRow;
  sources: PublicSource[];
  logo: PublicLogo | null;
}

/** Fonte do canal confirmado: oficial (emissora/organizador), imprensa, editorial ou a tabela de direitos. */
export type ConfirmedChannelSourceKind = 'official' | 'press' | 'editorial' | 'rights';

export interface ConfirmedChannelSource {
  publisher: string;
  url: string;
  excerpt: string;
  kind: ConfirmedChannelSourceKind;
}

/** Canal confirmado do jogo (opção publicada), com a melhor fonte e quando foi confirmado. */
export interface PublicConfirmedChannel {
  option: PublicOption;
  confirmedAt: Date;
  /** Confirmado também depois do jogo (quem de fato transmitiu). */
  postMatch: boolean;
  source: ConfirmedChannelSource | null;
}

/** Canal do jogo por momento: antes, ao vivo ou encerrado (docs/05 §4, `availability.match_channel`). */
export interface PublicMatchChannel {
  phase: MatchPhase;
  state: MatchChannelState;
  channels: PublicConfirmedChannel[];
}

export interface PublicWhereToWatch {
  eventId: string;
  country: string;
  matchChannel: PublicMatchChannel;
  status: 'resolved' | 'unknown';
  options: PublicOption[];
  /** Detentores de direitos sem o jogo confirmado ("canal a confirmar", status `probable`). */
  toConfirm: PublicOption[];
  /**
   * Sem nenhuma opção gravada (o jogo ainda não passou por nenhuma janela no país — mercado novo,
   * jogo distante): os detentores dos direitos efetivos, ou os incertos quando só eles existem,
   * "a confirmar". Nunca "sem informações" quando a curadoria ou a pesquisa sabem quem pode passar.
   */
  fromRights: PublicRightsOption[];
  updatedAt: Date | null;
}

/** Detentor de direitos sem opção gravada: entra em `to_confirm` com as fontes da linha de direitos. */
export interface PublicRightsOption {
  providerName: string;
  broadcasterId: string;
  medium: BroadcastMedium;
  accessModel: AccessModel;
  sources: PublicSource[];
  logo: PublicLogo | null;
}

/** Detentores dos direitos efetivos do evento no país (curadoria vence; incertos se não há certos). */
async function rightsToConfirm(
  db: Database,
  config: WtwConfig,
  eventId: string,
  country: string,
): Promise<Omit<PublicRightsOption, 'logo'>[]> {
  if (!config.has(country)) return [];
  const [ev] = await db
    .select({ slug: competition.slug, startsAt: event.startsAt, year: season.year })
    .from(event)
    .innerJoin(competition, eq(competition.id, event.competitionId))
    .leftJoin(season, eq(season.id, event.seasonId))
    .where(eq(event.id, eventId));
  if (!ev) return [];
  const year = ev.year ?? ev.startsAt.getUTCFullYear();
  const researched = new ResearchedRightsIndex(
    await currentResearchedRights(db, { competitions: [ev.slug], countries: [country] }),
  );
  const directory = config.directory(country);
  const entry = effectiveRights(
    directory.rightsFor(ev.slug, ev.startsAt),
    researched.get(ev.slug, year, country),
  );
  if (!entry) return [];
  const ids = entry.holders.length ? entry.holders : entry.uncertainHolders;
  const sources = entry.sources.map((url) => ({ publisher: new URL(url).hostname, url }));
  return ids.flatMap((id) => {
    const b = directory.byIdOrNull(id);
    return b
      ? [{ providerName: b.name, broadcasterId: b.id, medium: b.medium, accessModel: b.accessModel, sources }]
      : [];
  });
}

/**
 * Opções publicadas (`confirmed`, versão vigente) de um evento × país. Com `region`, devolve as
 * nacionais + as daquela região; sem `region`, todas (cada uma com seu campo `region`).
 * Retorna null se o evento não existe.
 */
export async function getPublicWhereToWatch(
  db: Database,
  params: { eventId: string; country: string; region?: string | null },
  /** Com a configuração, o país sem nenhuma opção gravada mostra os detentores dos direitos. */
  config?: WtwConfig | null,
): Promise<PublicWhereToWatch | null> {
  const [ev] = await db
    .select({ id: event.id, status: event.status })
    .from(event)
    .where(eq(event.id, params.eventId));
  if (!ev) return null;
  const country = params.country.toUpperCase();
  const rows = await db
    .select()
    .from(broadcastOption)
    .where(
      and(
        eq(broadcastOption.eventId, params.eventId),
        eq(broadcastOption.countryCode, country),
        isNull(broadcastOption.supersededBy),
      ),
    );

  const region = params.region?.trim().toUpperCase() || null;
  const inRegion = (r: BroadcastOptionRow) =>
    !region || r.region === null || r.region.toUpperCase() === region;
  const order = (a: BroadcastOptionRow, b: BroadcastOptionRow) =>
    MEDIUM_ORDER.indexOf(a.medium) - MEDIUM_ORDER.indexOf(b.medium) ||
    Number(b.confidence) - Number(a.confidence) ||
    a.providerName.localeCompare(b.providerName) ||
    (a.region ?? '').localeCompare(b.region ?? '');
  const matchChannels = (await currentMatchChannels(db, params.eventId, country)).filter(
    (m) => m.status === 'confirmed',
  );
  const promoted = await promoteMatchChannels(db, rows, matchChannels, config?.has(country) ? config : null);
  const confirmed = [...rows.filter((r) => r.status === 'confirmed' && inRegion(r)), ...promoted].sort(order);
  // "a confirmar" só aparece enquanto nenhuma opção estiver confirmada
  const probable = confirmed.length
    ? []
    : rows.filter((r) => r.status === 'probable' && inRegion(r)).sort(order);

  const fallback =
    config && !confirmed.length && !probable.length
      ? await rightsToConfirm(db, config, params.eventId, country)
      : [];
  const ids = [
    ...new Set([
      ...[...confirmed, ...probable].flatMap((r) => (r.broadcasterId ? [r.broadcasterId] : [])),
      ...fallback.map((f) => f.broadcasterId),
    ]),
  ];
  const library = new Map((await listBroadcasters(db, { ids })).map((b) => [b.id, b]));
  const logoOf = (
    row: Pick<BroadcastOptionRow, 'broadcasterId'> & { channelName?: string | null },
  ): PublicLogo | null => {
    const b = row.broadcasterId ? library.get(row.broadcasterId) : undefined;
    if (!b) return null;
    const channel = row.channelName ? b.channelLogoKeys[channelKey(row.channelName)] : undefined;
    if (channel?.storageKey)
      return { storageKey: channel.storageKey, darkStorageKey: channel.darkStorageKey, sourceUrl: null };
    const sourceUrl = isHttpUrl(b.logoSourceUrl) ? b.logoSourceUrl : null;
    if (!b.logoStorageKey && !sourceUrl) return null;
    return { storageKey: b.logoStorageKey, darkStorageKey: b.logoDarkStorageKey, sourceUrl };
  };

  const toPublic = (row: BroadcastOptionRow): PublicOption => {
    const seen = new Set<string>();
    const sources: PublicSource[] = [];
    for (const e of row.evidence) {
      if (e.stance === 'denies' || seen.has(e.url)) continue;
      seen.add(e.url);
      sources.push({ publisher: e.publisher ?? new URL(e.url).hostname, url: e.url });
    }
    return { row, sources, logo: logoOf(row) };
  };
  const options = confirmed.map(toPublic);
  const toConfirm = probable.map(toPublic);
  const phase = matchPhaseOf(ev.status);
  const channels = confirmedChannels(options, matchChannels);

  const stamps = [
    ...rows.flatMap((r) => [r.createdAt.getTime(), r.lastVerifiedAt.getTime()]),
    ...matchChannels.map((m) => m.updatedAt.getTime()),
  ];
  return {
    eventId: params.eventId,
    country,
    matchChannel: { phase, state: matchChannelState(phase, channels.length), channels },
    status: options.length ? 'resolved' : 'unknown',
    options,
    toConfirm,
    fromRights: fallback.map((f) => ({ ...f, logo: logoOf(f) })),
    updatedAt: stamps.length ? new Date(Math.max(...stamps)) : null,
  };
}

/**
 * Canais do jogo confirmados pelo job `wtw-channel` (enrich.match_channel) que ainda não estão entre as
 * opções publicadas viram opções `confirmed` na leitura (a gravação versionada das opções não muda).
 * A correção editorial vence: emissora retirada/omitida pela editoria não volta por aqui.
 */
async function promoteMatchChannels(
  db: Database,
  rows: BroadcastOptionRow[],
  channels: MatchChannelRow[],
  config: WtwConfig | null,
): Promise<BroadcastOptionRow[]> {
  if (!channels.length) return [];
  const published = new Set(rows.filter((r) => r.status === 'confirmed').map((r) => r.broadcasterId));
  const removedByEditorial = new Set(
    rows
      .filter((r) => isEditorial(r) && (r.status === 'retracted' || r.status === 'omitted'))
      .map((r) => r.broadcasterId),
  );
  const todo = channels.filter(
    (m) => !published.has(m.broadcasterId) && !removedByEditorial.has(m.broadcasterId),
  );
  if (!todo.length) return [];
  const library = new Map(
    (await listBroadcasters(db, { ids: todo.map((m) => m.broadcasterId) })).map((b) => [b.id, b]),
  );
  return todo.flatMap((m) => {
    const country = m.countryCode;
    const entry = config?.directory(country).byIdOrNull(m.broadcasterId) ?? null;
    const lib = library.get(m.broadcasterId);
    const market = lib?.markets[country];
    const base = rows.find((r) => r.broadcasterId === m.broadcasterId && r.status !== 'retracted');
    const name = entry?.name ?? market?.name ?? base?.providerName ?? lib?.name;
    const medium =
      entry?.medium ?? market?.medium ?? base?.medium ?? (lib ? MEDIUM_OF_KIND[lib.kind] : undefined);
    if (!name || !medium) return [];
    const evidence: Evidence[] = m.evidence.map((e) => ({
      url: e.url,
      excerpt: e.excerpt,
      publisher: e.publisher,
      fetchedAt: e.fetchedAt,
      sourceKind: e.sourceKind,
      publishedAt: e.publishedAt,
      stance: 'confirms',
    }));
    const row: BroadcastOptionRow = {
      id: m.id,
      eventId: m.eventId,
      countryCode: country,
      region: null,
      providerName: name,
      broadcasterId: m.broadcasterId,
      channelName: m.channelName,
      medium,
      accessModel: entry?.accessModel ?? market?.accessModel ?? base?.accessModel ?? 'unknown',
      url: base?.url ?? null,
      language: base?.language ?? null,
      status: 'confirmed',
      confidence: m.confidence,
      evidence,
      sourceKind: evidence[0]?.sourceKind ?? null,
      conflict: false,
      flags: ['match_channel'],
      firstSeenAt: m.firstConfirmedAt,
      lastVerifiedAt: m.confirmedAt,
      producedBy: MATCH_CHANNEL_PRODUCER,
      runId: null,
      createdAt: m.createdAt,
      supersededBy: null,
      supersededAt: null,
    };
    return [row];
  });
}

/** Meio a partir do tipo da biblioteca (só quando o dicionário do país não diz). */
const MEDIUM_OF_KIND: Record<string, BroadcastMedium> = {
  free_tv: 'free_tv',
  pay_tv: 'pay_tv',
  streaming: 'streaming_svod',
  radio: 'radio',
};

const SOURCE_KIND_PUBLIC: Record<SourceKind, ConfirmedChannelSourceKind> = {
  broadcaster: 'official',
  organizer: 'official',
  editorial: 'editorial',
  rights: 'rights',
  press: 'press',
  aggregator: 'press',
  unknown: 'press',
};

/** Canais confirmados do jogo (uma entrada por emissora), com a melhor fonte de cada um. */
function confirmedChannels(options: PublicOption[], channels: MatchChannelRow[]): PublicConfirmedChannel[] {
  const byBroadcaster = new Map(channels.map((m) => [m.broadcasterId, m]));
  const seen = new Set<string>();
  const out: PublicConfirmedChannel[] = [];
  for (const option of options) {
    const key = option.row.broadcasterId ?? option.row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const m = option.row.broadcasterId ? byBroadcaster.get(option.row.broadcasterId) : undefined;
    const source: ConfirmedChannelSource | null = m
      ? {
          url: m.sourceUrl,
          publisher: m.sourcePublisher,
          excerpt: m.sourceExcerpt,
          kind: m.sourceKind === 'editorial' ? 'editorial' : m.sourceKind,
        }
      : bestEvidence(option.row.evidence);
    out.push({
      option,
      confirmedAt: m?.firstConfirmedAt ?? option.row.firstSeenAt,
      postMatch: !!m?.postConfirmedAt,
      source,
    });
  }
  return out;
}

const KIND_ORDER: ConfirmedChannelSourceKind[] = ['editorial', 'official', 'press', 'rights'];

function bestEvidence(evidence: Evidence[]): ConfirmedChannelSource | null {
  const top = evidence
    .filter((e) => e.stance !== 'denies' && isHttpUrl(e.url))
    .map((e) => ({ e, kind: SOURCE_KIND_PUBLIC[e.sourceKind ?? 'unknown'] }))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))[0];
  if (!top) return null;
  return {
    url: top.e.url,
    publisher: top.e.publisher ?? new URL(top.e.url).hostname,
    excerpt: top.e.excerpt,
    kind: top.kind,
  };
}
