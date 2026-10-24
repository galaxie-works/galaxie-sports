/**
 * Lista de canais do cliente casada com os nossos direitos de transmissão (docs/07 §2.2.3). Só nomes
 * de canais, nunca EPG: o guia de programação é licenciado ao cliente pelo fornecedor dele.
 */
import type { BroadcastMedium, ChannelMatchKind } from '@galaxie/db';
import type { WtwCountry } from '../config/types.js';

/**
 * Tipos de casamento (definidos em @galaxie/db): exato = o canal é a emissora no país (qualquer praça conta: a geolocalização é da operadora) ·
 * feed_generico = sinal pan-regional, sem feed do país na lista · nome_divergente = mesma marca com
 * sufixo diferente (ex.: "CHILEVISION SPORTS" para a Chilevisión) · sem_canal_na_lista.
 */
export { CHANNEL_MATCH_KINDS, type ChannelMatchKind } from '@galaxie/db/schema';

/** Casamento com canal (o que a API publica em `client_channels`). */
export type ChannelLinkKind = Exclude<ChannelMatchKind, 'sem_canal_na_lista'>;

/** Linear (TV aberta, TV paga, rádio) ou só streaming (SVOD, gratuito, YouTube, app oficial). */
export type RightAccess = 'linear' | 'streaming';

/** Quem decidiu o casamento: o código, a IA (validada) ou o cliente no portal. */
export type ChannelMatchOrigin = 'codigo' | 'ia' | 'cliente';

/** Canal como o cliente mandou (índice = posição na lista, a partir de 0). */
export interface ClientChannel {
  idx: number;
  name: string;
  /** `group-title` do M3U (pode trazer o país); null na lista colada. */
  group: string | null;
}

/** O que o código extrai do nome antes de qualquer casamento. */
export interface ChannelFacts extends ClientChannel {
  /** País do canal (prefixo, grupo ou país padrão da lista); null = pan-regional ou desconhecido. */
  country: WtwCountry | null;
  /** De onde veio o país. */
  countryFrom: 'nome' | 'grupo' | 'lista' | 'emissora' | null;
  /** Marcado como pan-regional ("LATAM:", "LAT |"). */
  pan: boolean;
  /** "VOD": não é transmissão ao vivo, nunca casa. */
  vod: boolean;
  /** Marca de praça retirada ("SP", "RJ"); só informativa. */
  praca: string | null;
  quality: string | null;
  /** Número de feed ("2" em "ESPN 2"). */
  feed: string | null;
  /** Nome limpo (sem prefixo de país, praça, qualidade e VOD). */
  base: string;
  /** `base` sem o país por extenso no fim ("FOX SPORTS ARGENTINA" → "FOX SPORTS"). */
  brand: string;
  /** `brand` sem o número de feed. */
  brandNoFeed: string;
}

/** Direito numerado: uma emissora num país, com o acesso (o que o casamento precisa saber). */
export interface ChannelRight {
  idx: number;
  country: WtwCountry;
  broadcasterId: string;
  name: string;
  medium: BroadcastMedium;
  access: RightAccess;
}

/** Resultado de um direito: o tipo de casamento e os canais da lista (índices). */
export interface RightMatch {
  country: WtwCountry;
  broadcasterId: string;
  /** Nome da emissora no país (dicionário). */
  name: string;
  access: RightAccess;
  match: ChannelMatchKind;
  /** Índices dos canais do cliente (vazio em `sem_canal_na_lista`). */
  channels: number[];
  origin: ChannelMatchOrigin;
  /** Nota de auditoria (divergência de nome, violação do validador, correção do cliente). */
  note: string | null;
}

/** Campos do direito que o resultado carrega. */
export const matchBase = (r: ChannelRight) => ({
  country: r.country,
  broadcasterId: r.broadcasterId,
  name: r.name,
  access: r.access,
});

export const rightKey = (r: { country: string; broadcasterId: string }) => `${r.country}:${r.broadcasterId}`;

export function rightAccess(medium: BroadcastMedium): RightAccess {
  return medium === 'free_tv' || medium === 'pay_tv' || medium === 'radio' ? 'linear' : 'streaming';
}
