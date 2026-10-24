/**
 * Formato da lista de canais no portal (serializável para o navegador). Só nomes de canais: nunca
 * URL de stream nem EPG.
 */
export const MATCH_KINDS = ['exato', 'feed_generico', 'nome_divergente', 'sem_canal_na_lista'] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export interface ChannelView {
  idx: number;
  name: string;
  group: string | null;
}

/** Uma emissora num país (direito) e os canais da lista que a levam. */
export interface RightView {
  country: string;
  broadcasterId: string;
  name: string;
  access: 'linear' | 'streaming';
  match: MatchKind;
  channels: number[];
  origin: 'codigo' | 'ia' | 'cliente';
  note: string | null;
}

export interface ChannelListView {
  status: 'review' | 'confirmed';
  aiStatus: 'not_needed' | 'pending' | 'done' | 'failed';
  aiNote: string | null;
  source: 'm3u' | 'text';
  defaultCountry: string | null;
  markets: string[];
  processedAt: string;
  confirmedAt: string | null;
  channels: ChannelView[];
  rights: RightView[];
}

/** Envio do portal: o conteúdo (já sem as URLs, cortadas no navegador) e o país padrão opcional. */
export interface UploadInput {
  content: string;
  format?: 'm3u' | 'text';
  defaultCountry?: string | null;
}

/** Limite do envio (o mesmo do pacote; o navegador corta as URLs antes). */
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Tira do M3U tudo que não é nome de canal antes de mandar ao servidor: só as linhas `#EXT...` ficam
 * (as URLs de stream nem saem do navegador).
 */
export function stripStreamUrls(text: string): string {
  if (!/^\s*#EXT(M3U|INF)/im.test(text)) return text;
  return text
    .split(/\r?\n/)
    .filter((l) => /^\s*#EXT/i.test(l))
    .join('\n');
}

/** Canais sem emissora no casamento (só informativo no portal). */
export function unmatchedChannels(view: Pick<ChannelListView, 'channels' | 'rights'>): ChannelView[] {
  const used = new Set(view.rights.flatMap((r) => r.channels));
  return view.channels.filter((c) => !used.has(c.idx));
}

/** Mercados do onde assistir (os mesmos de `WTW_COUNTRIES`, sem importar o pacote no navegador). */
export const WTW_MARKETS = ['BR', 'AR', 'MX', 'CO', 'CL', 'PE', 'UY', 'EC'] as const;
