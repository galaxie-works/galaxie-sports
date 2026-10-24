'use server';

/**
 * Ações do portal "Minha lista de canais". O tenant sai sempre da sessão (`readClientContext`), nunca
 * do navegador: o cliente envia, corrige e confirma só a lista do próprio tenant. Só nomes de canais
 * chegam aqui (o navegador já cortou as URLs do M3U); EPG nunca é pedido nem guardado.
 */
import { ChannelListError } from '@galaxie/where-to-watch/channel-list';
import { revalidatePath } from 'next/cache';

import {
  isWtwCountry,
  overrideChannels,
  reprocessChannelList,
  uploadChannelList,
} from '@/lib/channel-list/server';
import { channelListDb, confirmChannelList } from '@/lib/channel-list/store';
import { UPLOAD_MAX_BYTES, type UploadInput } from '@/lib/channel-list/types';
import { readClientContext } from '@/lib/client/session';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

export interface ChannelListActionResult {
  ok: boolean;
  error?: string;
  /** Avisos do envio (nomes repetidos descartados, canais acima do limite). */
  duplicates?: number;
  truncated?: number;
}

const PATH = '/cliente/canais';

async function texts() {
  return getDictionary(await getRequestLocale()).channels.errors;
}

async function tenantOrError() {
  const ctx = await readClientContext();
  const t = await texts();
  if (!ctx) return { error: t.forbidden } as const;
  if (!ctx.tenant) return { error: t.noTenant } as const;
  return { ctx, tenant: ctx.tenant } as const;
}

/** Envia (ou substitui) a lista: M3U ou nomes colados, com o país padrão opcional. */
export async function uploadChannels(input: UploadInput): Promise<ChannelListActionResult> {
  const t = await texts();
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  const content = typeof input?.content === 'string' ? input.content : '';
  if (!content.trim()) return { ok: false, error: t.empty };
  if (new TextEncoder().encode(content).length > UPLOAD_MAX_BYTES)
    return { ok: false, error: fill(t.tooLarge, { max: '2 MB' }) };
  if (input.defaultCountry && !isWtwCountry(input.defaultCountry)) return { ok: false, error: t.country };
  const format = input.format === 'm3u' || input.format === 'text' ? input.format : undefined;
  try {
    const res = await uploadChannelList(r.tenant, r.ctx.userId, {
      content,
      ...(format ? { format } : {}),
      defaultCountry: input.defaultCountry ?? null,
    });
    revalidatePath(PATH);
    return { ok: true, duplicates: res.duplicates, truncated: res.truncated };
  } catch (err) {
    if (err instanceof ChannelListError)
      return { ok: false, error: err.code === 'too_large' ? fill(t.tooLarge, { max: '2 MB' }) : t.empty };
    console.error('[cliente] falha ao gravar a lista de canais', err);
    return { ok: false, error: t.generic };
  }
}

/** Refaz o casamento com o dicionário de emissoras atual (correções mantidas). */
export async function reprocessChannels(): Promise<ChannelListActionResult> {
  const t = await texts();
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  try {
    const row = await reprocessChannelList(r.tenant, r.ctx.userId);
    if (!row) return { ok: false, error: t.noList };
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    console.error('[cliente] falha ao reprocessar a lista de canais', err);
    return { ok: false, error: t.generic };
  }
}

export interface OverrideInput {
  country: string;
  broadcasterId: string;
  /** Índices dos canais da lista; [] = nenhum canal; null = desfazer a correção. */
  channels: number[] | null;
}

/** Correção do cliente numa emissora × país. */
export async function correctChannels(input: OverrideInput): Promise<ChannelListActionResult> {
  const t = await texts();
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  const channels =
    input?.channels === null
      ? null
      : Array.isArray(input?.channels)
        ? [...new Set(input.channels.filter((i) => Number.isInteger(i) && i >= 0))]
        : undefined;
  if (channels === undefined || !isWtwCountry(input.country) || typeof input.broadcasterId !== 'string')
    return { ok: false, error: t.notFound };
  try {
    const row = await overrideChannels(r.tenant, {
      country: input.country,
      broadcasterId: input.broadcasterId,
      channels,
    });
    if (!row) return { ok: false, error: t.notFound };
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    console.error('[cliente] falha ao corrigir a lista de canais', err);
    return { ok: false, error: t.generic };
  }
}

/** Confirma o casamento: a API passa a mandar `client_channels` no onde assistir. */
export async function confirmChannels(): Promise<ChannelListActionResult> {
  const t = await texts();
  const r = await tenantOrError();
  if ('error' in r) return { ok: false, error: r.error };
  try {
    const row = await confirmChannelList(channelListDb(), r.tenant.id, r.ctx.userId);
    if (!row) return { ok: false, error: t.noList };
    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    console.error('[cliente] falha ao confirmar a lista de canais', err);
    return { ok: false, error: t.generic };
  }
}
