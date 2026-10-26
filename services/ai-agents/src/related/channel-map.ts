/**
 * Canais conhecidos do Conteúdo relacionado (docs/12 §3.2): o mapa `enrich.related_channel` (clube e
 * competição pelo P2397 do Wikidata, emissoras e entradas do channels.yaml) e o cache do `channels.list` em
 * `enrich.youtube_channel` (playlist de uploads, handle, inscritos; renovado a cada 30 dias, como pede a
 * política da API). Ler os uploads recentes custa 1 unidade por página de 50 no balde geral, contra 1 das
 * ~100 consultas diárias da busca.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  relatedChannel,
  youtubeChannel,
  type Database,
  type RelatedChannelKind,
  type RelatedChannelSource,
} from '@galaxie/db';
import type { TeamRef } from '../context/event-core.js';
import { ALLOWLIST_MIN_SUBSCRIBERS, competitionLabelMatches, type ChannelEntry } from './channels.js';
import { matchText, mentions, teamVariants } from './policy.js';
import type { ChannelDetail, PlaylistVideo, YoutubeClient } from './youtube.js';

/** Validade do cache de canais (dados da API não ficam mais de 30 dias sem atualizar). */
export const CHANNEL_CACHE_DAYS = 30;
/** Páginas de uploads (50 cada) lidas por canal e execução, no máximo. */
export const DEFAULT_CHANNEL_MAX_PAGES = 3;
/** Vídeo do canal do clube que só cita o próprio time vale até N horas depois do apito (coletiva, bastidores). */
export const OWN_TEAM_ONLY_HOURS = 6;

export interface ChannelLink {
  channelId: string;
  kind: RelatedChannelKind;
  participantId: string | null;
  competitionId: string | null;
  broadcasterId: string | null;
  source: RelatedChannelSource;
}

export interface KnownChannel extends ChannelLink {
  title: string;
  handle: string | null;
  subscribers: number | null;
  uploadsPlaylistId: string;
}

/** Entradas da allowlist a partir do mapa (por id do canal): clube/competição = oficial; emissora = detentor. */
export async function channelEntriesFromDb(db: Database): Promise<ChannelEntry[]> {
  const rows = await db
    .select({
      channelId: relatedChannel.channelId,
      kind: relatedChannel.kind,
      participantId: relatedChannel.participantId,
      competitionId: relatedChannel.competitionId,
      broadcasterId: relatedChannel.broadcasterId,
      country: relatedChannel.country,
      source: relatedChannel.source,
      title: youtubeChannel.title,
    })
    .from(relatedChannel)
    .leftJoin(youtubeChannel, eq(youtubeChannel.id, relatedChannel.channelId))
    .where(eq(relatedChannel.active, true));
  return rows.map((r) => ({
    handle: null,
    id: r.channelId,
    kind: r.kind,
    broadcaster: r.broadcasterId,
    country: r.country,
    label: r.title ?? null,
    participantId: r.participantId,
    competitionId: r.competitionId,
    source: r.source,
  }));
}

export type ConfigChannelRow = typeof relatedChannel.$inferInsert;

/**
 * Linhas do mapa a partir das entradas da configuração (CLI `related:canais`): clube por nome e país (único),
 * competição pelo slug (ou pela federação: `conmebol` → uma linha por competição `conmebol-*`), emissora pelo
 * id do dicionário. `idOf` = handle → id do canal já resolvido. Devolve também o que ficou sem par.
 */
export function configChannelRows(
  entries: readonly ChannelEntry[],
  ctx: {
    idOf: ReadonlyMap<string, string>;
    teams: readonly { id: string; name: string; shortName: string | null; country: string | null }[];
    comps: readonly { id: string; slug: string }[];
  },
): { rows: ConfigChannelRow[]; unmatched: string[] } {
  const norm = (x: string) => matchText(x).trim();
  const rows: ConfigChannelRow[] = [];
  const unmatched: string[] = [];
  for (const e of entries) {
    const channelId = e.id ?? (e.handle ? ctx.idOf.get(e.handle) : undefined);
    if (!channelId) continue;
    const base = { channelId, source: 'config' as const, sourceRef: e.handle ?? e.id, country: e.country };
    if (e.kind === 'club') {
      const hits = ctx.teams.filter(
        (t) =>
          (!e.country || t.country === e.country) &&
          [t.name, t.shortName].some((n) => n && e.label && norm(n) === norm(e.label)),
      );
      if (hits.length === 1) rows.push({ ...base, kind: 'club', participantId: hits[0]!.id });
      else unmatched.push(`${e.label ?? e.handle} (${hits.length ? 'ambíguo' : 'sem time'})`);
    } else if (e.kind === 'competition') {
      const label = e.label;
      const hits = label ? ctx.comps.filter((c) => competitionLabelMatches(label, c.slug)) : [];
      for (const c of hits) rows.push({ ...base, kind: 'competition', competitionId: c.id });
      if (!hits.length) unmatched.push(`${label} (sem competição)`);
    } else if (e.kind === 'broadcaster' && e.broadcaster) {
      rows.push({ ...base, kind: 'broadcaster', broadcasterId: e.broadcaster });
    }
  }
  return { rows, unmatched };
}

type ChannelKey = Pick<
  ConfigChannelRow,
  'channelId' | 'kind' | 'participantId' | 'competitionId' | 'broadcasterId'
>;
const channelKey = (r: ChannelKey) =>
  [r.channelId, r.kind, r.participantId ?? '', r.competitionId ?? '', r.broadcasterId ?? ''].join('|');

/**
 * Linhas ativas do mapa vindas da configuração que não saíram desta execução. `gone` = a entrada saiu da
 * configuração (o editor tirou o handle/id do channels.yaml ou do dicionário de emissoras): o CLI desativa,
 * senão o canal continuaria tratado como oficial. `unmatched` = a entrada continua no arquivo mas ficou sem
 * par (time ambíguo, competição renomeada, handle não conferido na prévia): só vai para o log, porque desativar
 * por um casamento que falhou tiraria um canal conferido à mão.
 */
export function staleConfigChannels<T extends ChannelKey & { sourceRef: string | null }>(
  active: readonly T[],
  rows: readonly ChannelKey[],
  configRefs: ReadonlySet<string>,
): { gone: T[]; unmatched: T[] } {
  const current = new Set(rows.map(channelKey));
  const stale = active.filter((r) => !current.has(channelKey(r)));
  return {
    gone: stale.filter((r) => !r.sourceRef || !configRefs.has(r.sourceRef)),
    unmatched: stale.filter((r) => !!r.sourceRef && configRefs.has(r.sourceRef)),
  };
}

/** Emissoras com canal no mapa (para saber, sem consulta, se o jogo tem canal de detentor). */
export async function broadcastersWithChannels(db: Database): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ id: relatedChannel.broadcasterId })
    .from(relatedChannel)
    .where(and(eq(relatedChannel.kind, 'broadcaster'), eq(relatedChannel.active, true)));
  return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
}

/**
 * Uploads de canal que são deste jogo, antes do `videos.list`: publicados entre o apito e `windowDays` depois
 * e citando os dois times — ou, no canal de um dos clubes, o adversário (ou o próprio time até
 * `OWN_TEAM_ONLY_HOURS` depois do apito: coletiva e bastidores do pós-jogo). Canal de liga ou emissora cobre
 * vários jogos: só com os dois times.
 */
export function matchUploads(
  items: readonly PlaylistVideo[],
  input: {
    kickoff: Date;
    home: TeamRef;
    away: TeamRef;
    kind: RelatedChannelKind;
    /** Lado do clube dono do canal (kind = club). */
    side?: 'home' | 'away' | null;
    windowDays?: number;
  },
): PlaylistVideo[] {
  const from = input.kickoff.getTime();
  const to = from + (input.windowDays ?? 7) * 86_400_000;
  const homeV = teamVariants(input.home);
  const awayV = teamVariants(input.away);
  return items.filter((it) => {
    const t = Date.parse(it.publishedAt);
    if (!Number.isFinite(t) || t < from || t > to) return false;
    const text = matchText(`${it.title} ${it.description.slice(0, 500)}`);
    const h = mentions(text, homeV);
    const a = mentions(text, awayV);
    if (h && a) return true;
    if (input.kind !== 'club' || !input.side) return false;
    const opponent = input.side === 'home' ? a : h;
    const own = input.side === 'home' ? h : a;
    return opponent || (own && t <= from + OWN_TEAM_ONLY_HOURS * 3_600_000);
  });
}

interface UploadsCache {
  items: PlaylistVideo[];
  next: string | null;
  pages: number;
}

/**
 * Canais de uma execução: o mapa do banco, os detalhes (cache permanente, renovado a cada 30 dias) e os
 * uploads lidos uma vez por execução — o canal da liga ou da emissora serve a todos os jogos da rodada.
 */
export class ChannelBook {
  private readonly uploadsCache = new Map<string, UploadsCache>();
  private readonly detailCache = new Map<string, ChannelDetail | null>();
  readonly minSubscribers: number;
  readonly maxPages: number;

  constructor(
    private readonly db: Database,
    private readonly yt: YoutubeClient | null,
    private readonly opts: { now: Date; minSubscribers?: number; maxPages?: number },
  ) {
    this.minSubscribers = opts.minSubscribers ?? ALLOWLIST_MIN_SUBSCRIBERS;
    this.maxPages = opts.maxPages ?? DEFAULT_CHANNEL_MAX_PAGES;
  }

  /** Canais do mapa ligados ao jogo: os dois clubes, a competição e as emissoras detentoras nos mercados. */
  async linksFor(input: {
    participantIds: string[];
    competitionId: string | null;
    holders: ReadonlySet<string>;
    markets: readonly string[];
  }): Promise<ChannelLink[]> {
    const conds = [
      and(eq(relatedChannel.kind, 'club'), inArray(relatedChannel.participantId, input.participantIds)),
    ];
    if (input.competitionId)
      conds.push(
        and(eq(relatedChannel.kind, 'competition'), eq(relatedChannel.competitionId, input.competitionId)),
      );
    if (input.holders.size)
      conds.push(
        and(
          eq(relatedChannel.kind, 'broadcaster'),
          inArray(relatedChannel.broadcasterId, [...input.holders]),
          or(sql`${relatedChannel.country} is null`, inArray(relatedChannel.country, [...input.markets])),
        ),
      );
    const rows = await this.db
      .select({
        channelId: relatedChannel.channelId,
        kind: relatedChannel.kind,
        participantId: relatedChannel.participantId,
        competitionId: relatedChannel.competitionId,
        broadcasterId: relatedChannel.broadcasterId,
        source: relatedChannel.source,
      })
      .from(relatedChannel)
      .where(and(eq(relatedChannel.active, true), or(...conds)));
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.channelId) && seen.add(r.channelId));
  }

  /**
   * Detalhes dos canais: do cache (memória, depois `enrich.youtube_channel`); o que falta ou venceu vai ao
   * `channels.list` (1 unidade por 50) quando há cliente. Canal que a API não devolve fica marcado `missing`.
   */
  async details(ids: readonly string[]): Promise<Map<string, ChannelDetail>> {
    const want = [...new Set(ids)].filter((id) => id && !this.detailCache.has(id));
    if (want.length) {
      const cached = await this.db.select().from(youtubeChannel).where(inArray(youtubeChannel.id, want));
      const stale = this.opts.now.getTime() - CHANNEL_CACHE_DAYS * 86_400_000;
      const fresh = new Set<string>();
      for (const c of cached) {
        if (c.fetchedAt.getTime() < stale) continue;
        fresh.add(c.id);
        this.detailCache.set(
          c.id,
          c.missing
            ? null
            : {
                id: c.id,
                title: c.title,
                handle: c.handle,
                subscribers: c.subscribers,
                country: c.country,
                uploadsPlaylistId: c.uploadsPlaylistId,
              },
        );
      }
      const fetchIds = want.filter((id) => !fresh.has(id));
      if (fetchIds.length && this.yt) {
        const got = await this.yt.channels(fetchIds);
        const byId = new Map(got.map((c) => [c.id, c]));
        for (const id of fetchIds) {
          const c = byId.get(id) ?? null;
          this.detailCache.set(id, c);
          await this.saveDetail(id, c);
        }
      }
    }
    const out = new Map<string, ChannelDetail>();
    for (const id of ids) {
      const d = this.detailCache.get(id);
      if (d) out.set(id, d);
    }
    return out;
  }

  /** Guarda o canal no cache permanente (também usado pelo CLI que resolve os handles do channels.yaml). */
  async saveDetail(id: string, c: ChannelDetail | null): Promise<void> {
    const values = {
      id,
      title: c?.title ?? '',
      handle: c?.handle ?? null,
      uploadsPlaylistId: c?.uploadsPlaylistId ?? null,
      country: c?.country ?? null,
      subscribers:
        c?.subscribers === null || c?.subscribers === undefined
          ? null
          : Math.min(c.subscribers, 2_147_483_647),
      missing: !c,
      fetchedAt: this.opts.now,
    };
    await this.db
      .insert(youtubeChannel)
      .values(values)
      .onConflictDoUpdate({ target: youtubeChannel.id, set: values });
  }

  /**
   * Canais do jogo com playlist de uploads. Canal do Wikidata abaixo do piso de inscritos fica de fora (o dado
   * é aberto; o piso é o mesmo da allowlist por handle).
   */
  async knownChannels(input: Parameters<ChannelBook['linksFor']>[0]): Promise<KnownChannel[]> {
    const links = await this.linksFor(input);
    const det = await this.details(links.map((l) => l.channelId));
    return links.flatMap((l) => {
      const d = det.get(l.channelId);
      if (!d?.uploadsPlaylistId) return [];
      if (l.source === 'wikidata' && d.subscribers !== null && d.subscribers < this.minSubscribers) return [];
      return [
        {
          ...l,
          title: d.title,
          handle: d.handle,
          subscribers: d.subscribers,
          uploadsPlaylistId: d.uploadsPlaylistId,
        },
      ];
    });
  }

  /**
   * Uploads de um canal publicados desde `since`, do mais novo para o mais antigo: lê páginas de 50 até passar
   * de `since`, acabar a playlist ou chegar a `maxPages`. Cada página é lida uma vez por execução.
   */
  async recentUploads(playlistId: string, since: Date): Promise<PlaylistVideo[]> {
    let c = this.uploadsCache.get(playlistId);
    if (!c) {
      c = { items: [], next: null, pages: 0 };
      this.uploadsCache.set(playlistId, c);
    }
    const covered = () => {
      const last = c!.items.at(-1);
      return !!last && Date.parse(last.publishedAt) < since.getTime();
    };
    while (this.yt && c.pages < this.maxPages && (c.pages === 0 || (c.next && !covered()))) {
      const page = await this.yt.playlistItems(playlistId, c.next);
      c.items.push(...page.items);
      c.next = page.nextPageToken;
      c.pages++;
      if (!page.nextPageToken) break;
    }
    return c.items.filter((it) => Date.parse(it.publishedAt) >= since.getTime());
  }
}
