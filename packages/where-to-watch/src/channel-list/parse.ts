/**
 * Leitura da lista de canais do cliente: um M3U (só o nome do `#EXTINF` e o `group-title`) ou nomes
 * colados, um por linha. Nada além do nome é guardado: URLs de stream, `tvg-id`, logos e qualquer dado
 * de EPG são descartados na leitura.
 */
import type { ClientChannel } from './types.js';

/** Limites da lista (o portal e a API recusam acima disso). */
export const CHANNEL_LIST_MAX_CHANNELS = 5000;
export const CHANNEL_LIST_MAX_BYTES = 2 * 1024 * 1024;
export const CHANNEL_NAME_MAX = 120;

export type ChannelListFormat = 'm3u' | 'text';

export interface ParsedChannelList {
  format: ChannelListFormat;
  channels: ClientChannel[];
  /** Nomes repetidos (mesmo nome e grupo) descartados. */
  duplicates: number;
  /** Linhas acima do limite de canais. */
  truncated: number;
}

export class ChannelListError extends Error {
  constructor(
    message: string,
    readonly code: 'empty' | 'too_large' | 'no_channels',
  ) {
    super(message);
    this.name = 'ChannelListError';
  }
}

const attr = (line: string, name: string) => {
  const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(line);
  return m?.[1]?.trim() || null;
};

const clean = (s: string) =>
  s
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHANNEL_NAME_MAX);

/** Nome de exibição do `#EXTINF` (depois da última vírgula fora de aspas), ou o `tvg-name`. */
function extinfName(line: string): string | null {
  let inQuotes = false;
  let comma = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) comma = i;
  }
  const display = comma >= 0 ? line.slice(comma + 1).trim() : '';
  return display || attr(line, 'tvg-name');
}

const looksLikeUrl = (s: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(www\.|\/)/i.test(s);

/** Detecta o formato e lê os nomes (só nomes; URLs e atributos de EPG ficam de fora). */
export function parseChannelList(text: string, format?: ChannelListFormat): ParsedChannelList {
  if (new TextEncoder().encode(text).length > CHANNEL_LIST_MAX_BYTES)
    throw new ChannelListError('Lista acima de 2 MB.', 'too_large');
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!body.trim()) throw new ChannelListError('Lista vazia.', 'empty');
  const lines = body.split(/\r?\n/);
  const fmt: ChannelListFormat =
    format ?? (lines.some((l) => /^#EXT(M3U|INF)/i.test(l.trim())) ? 'm3u' : 'text');

  const raw: { name: string; group: string | null }[] = [];
  if (fmt === 'm3u') {
    let group: string | null = null;
    for (const l of lines) {
      const line = l.trim();
      if (/^#EXTGRP:/i.test(line)) group = clean(line.slice(8)) || null;
      if (!/^#EXTINF/i.test(line)) continue;
      const name = extinfName(line);
      if (name) raw.push({ name: clean(name), group: attr(line, 'group-title') ?? group });
      group = null;
    }
  } else {
    for (const l of lines) {
      const name = clean(l);
      if (name && !name.startsWith('#') && !looksLikeUrl(name)) raw.push({ name, group: null });
    }
  }

  const seen = new Set<string>();
  const channels: ClientChannel[] = [];
  let duplicates = 0;
  let truncated = 0;
  for (const r of raw) {
    if (!r.name) continue;
    const key = `${r.name.toLowerCase()}\u0000${(r.group ?? '').toLowerCase()}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    if (channels.length >= CHANNEL_LIST_MAX_CHANNELS) {
      truncated++;
      continue;
    }
    channels.push({ idx: channels.length, name: r.name, group: r.group ? clean(r.group) : null });
  }
  if (!channels.length) throw new ChannelListError('Nenhum nome de canal na lista.', 'no_channels');
  return { format: fmt, channels, duplicates, truncated };
}
