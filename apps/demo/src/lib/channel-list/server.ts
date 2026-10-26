/**
 * Lista de canais do cliente no portal (só no servidor): leitura para a página e o casamento por
 * código no envio, na correção e no reprocessamento, com as mesmas funções da API
 * (`@galaxie/where-to-watch`). As sobras ficam para o job `channel-lists` (IA na VPS). Quem chama já
 * conferiu a sessão: o tenant vem dela.
 */
import { join } from 'node:path';

import {
  clientChannelKey,
  loadWtwConfig,
  parseChannelList,
  proposeChannelMatches,
  WTW_COUNTRIES,
  type ChannelOverride,
  type WtwConfig,
  type WtwCountry,
} from '@galaxie/where-to-watch/channel-list';

import {
  channelListDb,
  getChannelList,
  saveChannelList,
  setChannelListOverrides,
  type TenantChannelList,
} from './store';
import type { ChannelListView, UploadInput } from './types';

declare global {
  var __galaxieWtwConfig: WtwConfig | undefined;
}

/** Dicionário de emissoras (config/broadcasters): WTW_CONFIG_DIR na imagem Docker; no dev, o do repositório. */
export function wtwConfig(): WtwConfig {
  globalThis.__galaxieWtwConfig ??= loadWtwConfig({
    root: process.env.WTW_CONFIG_DIR ?? join(process.cwd(), '..', '..', 'config'),
  });
  return globalThis.__galaxieWtwConfig;
}

export const isWtwCountry = (c: unknown): c is WtwCountry =>
  typeof c === 'string' && (WTW_COUNTRIES as readonly string[]).includes(c);

const isMissingTable = (err: unknown) => (err as { code?: string }).code === '42P01';

export function channelListView(row: TenantChannelList): ChannelListView {
  return {
    status: row.status,
    aiStatus: row.aiStatus,
    aiNote: row.aiNote,
    source: row.source,
    defaultCountry: row.defaultCountry,
    markets: row.markets,
    processedAt: row.processedAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    channels: row.channels,
    rights: row.proposed,
  };
}

/** Lista do tenant para a página (null = ainda não enviou; banco sem a tabela também). */
export async function readChannelListPortal(tenantId: string): Promise<ChannelListView | null> {
  try {
    const row = await getChannelList(channelListDb(), tenantId);
    return row ? channelListView(row) : null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

interface TenantRef {
  id: string;
  markets: string[];
}

/** Envio: lê os nomes (`ChannelListError` se não houver), casa por código e grava; correções mantidas. */
export async function uploadChannelList(tenant: TenantRef, userId: string, input: UploadInput) {
  const parsed = parseChannelList(input.content, input.format);
  const db = channelListDb();
  const current = await getChannelList(db, tenant.id);
  const defaultCountry = isWtwCountry(input.defaultCountry) ? input.defaultCountry : null;
  const overrides = (current?.overrides ?? []) as ChannelOverride[];
  const { matches, aiPending, markets } = await proposeChannelMatches(wtwConfig(), {
    channels: parsed.channels,
    tenantMarkets: tenant.markets,
    defaultCountry,
    overrides,
  });
  const row = await saveChannelList(db, tenant.id, {
    source: parsed.format,
    defaultCountry,
    markets,
    channels: parsed.channels,
    proposed: matches,
    overrides,
    aiStatus: aiPending ? 'pending' : 'not_needed',
    userId,
  });
  return { row, duplicates: parsed.duplicates, truncated: parsed.truncated };
}

/** Reprocessa com o dicionário atual (mesma lista, mesmas correções). */
export async function reprocessChannelList(tenant: TenantRef, userId: string) {
  const db = channelListDb();
  const current = await getChannelList(db, tenant.id);
  if (!current) return null;
  const overrides = current.overrides as ChannelOverride[];
  const defaultCountry = isWtwCountry(current.defaultCountry) ? current.defaultCountry : null;
  const { matches, aiPending, markets } = await proposeChannelMatches(wtwConfig(), {
    channels: current.channels,
    tenantMarkets: tenant.markets,
    defaultCountry,
    overrides,
  });
  return saveChannelList(db, tenant.id, {
    source: current.source,
    defaultCountry,
    markets,
    channels: current.channels,
    proposed: matches,
    overrides,
    aiStatus: aiPending ? 'pending' : 'not_needed',
    userId,
  });
}

/**
 * Correção do cliente numa emissora × país: os canais escolhidos (índices da lista atual; [] =
 * nenhum) ou `null` para desfazer a correção e voltar ao casamento proposto. A emissora tem de estar
 * entre os direitos da lista (mercados do tenant).
 */
export async function overrideChannels(
  tenant: TenantRef,
  input: { country: string; broadcasterId: string; channels: number[] | null },
): Promise<TenantChannelList | null> {
  const db = channelListDb();
  const current = await getChannelList(db, tenant.id);
  if (!current) return null;
  if (!current.proposed.some((m) => m.country === input.country && m.broadcasterId === input.broadcasterId))
    return null;
  const keys = (input.channels ?? []).flatMap((i) => {
    const c = current.channels[i];
    return c ? [clientChannelKey(c.name)] : [];
  });
  const others = (current.overrides as ChannelOverride[]).filter(
    (o) => !(o.country === input.country && o.broadcasterId === input.broadcasterId),
  );
  const overrides: ChannelOverride[] =
    input.channels === null
      ? others
      : [
          ...others,
          { country: input.country as WtwCountry, broadcasterId: input.broadcasterId, channelKeys: keys },
        ];
  const { matches, aiRights } = await proposeChannelMatches(wtwConfig(), {
    channels: current.channels,
    tenantMarkets: tenant.markets,
    defaultCountry: isWtwCountry(current.defaultCountry) ? current.defaultCountry : null,
    overrides,
  });
  // as decisões da IA já gravadas continuam nas emissoras que o cliente não mexeu
  const fromAi = new Map(
    current.proposed.filter((m) => m.origin === 'ia').map((m) => [`${m.country}:${m.broadcasterId}`, m]),
  );
  const proposed = matches.map((m) =>
    m.origin === 'cliente' ? m : (fromAi.get(`${m.country}:${m.broadcasterId}`) ?? m),
  );
  // sobra que a IA ainda não conferiu (ex.: desfez a correção de uma emissora): volta para o job
  const aiPending = aiRights.some((k) => !fromAi.has(k));
  return setChannelListOverrides(db, tenant.id, {
    overrides,
    proposed,
    ...(aiPending ? { aiStatus: 'pending' as const } : {}),
  });
}
