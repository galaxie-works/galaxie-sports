/**
 * Precedência entre as opções publicadas do onde assistir e o canal do jogo confirmado pelo job `wtw-channel`
 * (`enrich.match_channel`), num jogo e num país. Puro: a página pública (`publicWhereToWatch`) e a grade nos
 * canais do cliente (`/v1/widgets/{id}/channel-guide`) usam as mesmas regras.
 */
import { normalizeName } from './normalize.js';
import { isEditorial } from './store.js';

/** O que a precedência lê de uma opção (versão vigente). */
export interface PrecedenceOption {
  broadcasterId: string | null;
  channelName: string | null;
  /** UF/praça da opção regional; null = nacional. */
  region: string | null;
  status: string;
  producedBy: string;
}

/** O que a precedência lê de um canal do jogo confirmado. */
export interface PrecedenceMatchChannel {
  broadcasterId: string;
  channelName: string | null;
}

export const sameChannel = (a: string | null, b: string | null) =>
  normalizeName(a ?? '') === normalizeName(b ?? '');

/**
 * Canais do jogo que entram como opção `confirmed`: os de emissora sem opção confirmada publicada. A correção
 * editorial vence: emissora retirada/omitida pela editoria não volta por aqui.
 */
export function matchChannelsToPromote<M extends PrecedenceMatchChannel>(
  options: readonly PrecedenceOption[],
  channels: readonly M[],
): M[] {
  if (!channels.length) return [];
  const published = new Set(options.filter((r) => r.status === 'confirmed').map((r) => r.broadcasterId));
  const removedByEditorial = new Set(
    options
      .filter((r) => isEditorial(r) && (r.status === 'retracted' || r.status === 'omitted'))
      .map((r) => r.broadcasterId),
  );
  return channels.filter((m) => !published.has(m.broadcasterId) && !removedByEditorial.has(m.broadcasterId));
}

/**
 * Opção publicada cuja emissora tem canal do jogo confirmado com outro canal: vale o canal do jogo, que é o
 * que a fonte exibida (`match_channel.channels[].source`) sustenta — senão nome e fonte se contradizem
 * ("SporTV 2" com a fonte que diz "SporTV 3"). Só nas opções nacionais (as regionais trazem a afiliada no nome
 * do canal) e nunca na escolha da editoria.
 */
export function withMatchChannel<R extends PrecedenceOption>(
  row: R,
  channels: readonly PrecedenceMatchChannel[],
): R {
  if (row.region !== null || !row.broadcasterId || isEditorial(row)) return row;
  const m = channels.find((c) => c.broadcasterId === row.broadcasterId);
  if (!m?.channelName || sameChannel(m.channelName, row.channelName)) return row;
  return { ...row, channelName: m.channelName };
}
