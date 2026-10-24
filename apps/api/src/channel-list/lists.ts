/**
 * Lista de canais do tenant na API: o casamento por código no envio e no reprocessamento (as sobras
 * ficam para o job da IA, na VPS), o DTO de `/v1/channel-list` e os `client_channels` do onde assistir,
 * a partir da versão confirmada (memoizada por tenant, como a operadora em `Lineup`).
 */
import type { ChannelList, ChannelListMatch, ClientChannelRef } from '@galaxie/contracts';
import {
  getConfirmedChannelList,
  saveChannelList,
  type Database,
  type StoredChannelMatch,
  type StoredClientChannel,
  type TenantChannelList,
} from '@galaxie/db';
import {
  analyzeChannel,
  proposeChannelMatches,
  type ChannelOverride,
  type WtwConfig,
  type WtwCountry,
} from '@galaxie/where-to-watch';

/** Grava a lista (nova ou reprocessada) com o casamento por código. */
export async function storeChannelList(
  db: Database,
  config: WtwConfig,
  tenantId: string,
  input: {
    source: 'm3u' | 'text';
    channels: StoredClientChannel[];
    tenantMarkets: readonly string[];
    defaultCountry: WtwCountry | null;
    overrides: ChannelOverride[];
    userId?: string | null;
  },
): Promise<TenantChannelList> {
  const { matches, aiPending, markets } = await proposeChannelMatches(config, {
    channels: input.channels,
    tenantMarkets: input.tenantMarkets,
    defaultCountry: input.defaultCountry,
    overrides: input.overrides,
  });
  return saveChannelList(db, tenantId, {
    source: input.source,
    defaultCountry: input.defaultCountry,
    markets,
    channels: input.channels,
    proposed: matches,
    overrides: input.overrides,
    aiStatus: aiPending ? 'pending' : 'not_needed',
    userId: input.userId ?? null,
  });
}

const matchDto = (m: StoredChannelMatch, channels: StoredClientChannel[]): ChannelListMatch => ({
  country: m.country,
  provider_id: m.broadcasterId,
  provider: m.name,
  access: m.access,
  match: m.match,
  channels: m.channels.flatMap((i) => (channels[i] ? [{ index: i, name: channels[i].name }] : [])),
  origin: m.origin,
  note: m.note,
});

export function channelListDto(row: TenantChannelList, format: (d: Date) => string): ChannelList {
  return {
    status: row.status,
    ai_status: row.aiStatus,
    source: row.source,
    default_country: row.defaultCountry,
    markets: row.markets,
    processed_at: format(row.processedAt),
    confirmed_at: row.confirmedAt ? format(row.confirmedAt) : null,
    channels: row.channels.map((c) => ({ index: c.idx, name: c.name, group: c.group })),
    matches: row.proposed.map((m) => matchDto(m, row.channels)),
    confirmed_matches: row.confirmed
      ? row.confirmed.matches.map((m) => matchDto(m, row.confirmed!.channels))
      : null,
  };
}

/** Versão confirmada, indexada por `país:emissora`, pronta para o onde assistir. */
export class ConfirmedChannels {
  private readonly by = new Map<string, StoredChannelMatch>();
  private readonly feeds = new Map<number, string | null>();

  constructor(
    readonly confirmedAt: Date,
    readonly channels: StoredClientChannel[],
    matches: StoredChannelMatch[],
  ) {
    for (const m of matches) {
      this.by.set(`${m.country}:${m.broadcasterId}`, m);
      for (const i of m.channels)
        if (channels[i] && !this.feeds.has(i)) this.feeds.set(i, analyzeChannel(channels[i]).feed);
    }
  }

  /**
   * Canais da lista que levam a emissora no país (todos, de todas as praças). Com o canal da opção
   * ("ESPN 2"), os do mesmo feed vêm primeiro quando a lista os tem.
   */
  forBroadcaster(country: string, broadcasterId: string | null, channel?: string | null): ClientChannelRef[] {
    if (!broadcasterId) return [];
    const m = this.by.get(`${country.toUpperCase()}:${broadcasterId}`);
    if (!m || m.match === 'sem_canal_na_lista') return [];
    const match = m.match;
    const refs = m.channels.flatMap((i) =>
      this.channels[i] ? [{ index: i, name: this.channels[i].name, match }] : [],
    );
    const feed = channel ? analyzeChannel({ idx: 0, name: channel, group: null }).feed : null;
    if (!feed) return refs;
    const sameFeed = (r: ClientChannelRef) => this.feeds.get(r.index) === feed;
    return [...refs.filter(sameFeed), ...refs.filter((r) => !sameFeed(r))];
  }
}

/** Lista confirmada de cada tenant, memoizada (60 s; invalidada quando o próprio tenant muda a lista). */
export class ClientChannelLists {
  private readonly memo = new Map<string, { value: ConfirmedChannels | null; expiresAt: number }>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async confirmedOf(db: Database, tenantId: string | undefined): Promise<ConfirmedChannels | null> {
    if (!tenantId) return null;
    const hit = this.memo.get(tenantId);
    if (hit && hit.expiresAt > this.now()) return hit.value;
    const row = await getConfirmedChannelList(db, tenantId);
    const value = row ? new ConfirmedChannels(row.confirmedAt, row.channels, row.matches) : null;
    if (this.memo.size > 10_000) this.memo.clear();
    this.memo.set(tenantId, { value, expiresAt: this.now() + this.ttlMs });
    return value;
  }

  invalidate(tenantId: string): void {
    this.memo.delete(tenantId);
  }
}

/** Parte do `vary` do cache: a resposta do onde assistir muda com a lista confirmada do tenant. */
export function channelListVary(tenantId: string | undefined, list: ConfirmedChannels | null): string[] {
  return list && tenantId ? [`cl:${tenantId}:${list.confirmedAt.getTime()}`] : [];
}
