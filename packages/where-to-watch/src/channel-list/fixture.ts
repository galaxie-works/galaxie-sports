/**
 * Exemplo de referência do casamento (testado no AI Studio): Palmeiras × Fluminense, Brasileirão, com
 * a lista de 11 canais de uma operadora e os direitos de BR, AR, CL, CO e MX. Usado nos testes do
 * pacote, do agente e da API; os nomes são de emissoras, não de clientes.
 */
import type { WtwConfig } from '../config/directory.js';
import { rightAccess, type ChannelMatchKind, type ChannelRight, type ClientChannel } from './types.js';

export const FIXTURE_CHANNELS: readonly string[] = [
  'BR: |SP| GLOBO HD', //  0 → Globo (BR) exato; a praça não conta
  'BR: SBT HD', //         1 → sem direito no jogo
  'ARG: TELEFE HD', //     2 → sem direito no jogo
  'ARG: FOX SPORTS HD', // 3 → Fox Sports (AR) exato
  'CL: CHILEVISION SPORTS', // 4 → Chilevisión (CL) nome_divergente
  'ESPN HD', //            5 → ESPN (CL e CO) feed_generico: pan-regional, sem o feed do país
  'MX: MAX VOD', //        6 → VOD: não é transmissão ao vivo
  'MX: TNT SPORTS HD', //  7 → sem direito no jogo
  'COL: CARACOL TV HD', // 8 → sem direito no jogo
  'COL: WIN SPORTS+ HD', // 9 → sem direito no jogo
  'MEX: AZTECA 7 HD', //   10 → sem direito no jogo
];

export const fixtureChannels = (): ClientChannel[] =>
  FIXTURE_CHANNELS.map((name, idx) => ({ idx, name, group: null }));

/** Direitos do jogo por país (id do dicionário config/broadcasters). */
export const FIXTURE_RIGHTS: readonly { country: 'BR' | 'AR' | 'CL' | 'CO' | 'MX'; broadcasterId: string }[] =
  [
    { country: 'BR', broadcasterId: 'globo' },
    { country: 'AR', broadcasterId: 'fox_sports' },
    { country: 'CL', broadcasterId: 'chilevision' },
    { country: 'CL', broadcasterId: 'espn' },
    { country: 'CL', broadcasterId: 'paramount_plus' },
    { country: 'CO', broadcasterId: 'espn' },
    { country: 'CO', broadcasterId: 'disney_plus' },
    { country: 'MX', broadcasterId: 'hbo_max' },
  ];

/** Direitos numerados com o meio e o acesso do dicionário. */
export function fixtureRights(config: WtwConfig): ChannelRight[] {
  return FIXTURE_RIGHTS.map((r, idx) => {
    const b = config.directory(r.country).byIdOrNull(r.broadcasterId);
    if (!b) throw new Error(`Fixture: ${r.broadcasterId} fora do dicionário de ${r.country}`);
    return { idx, ...r, name: b.name, medium: b.medium, access: rightAccess(b.medium) };
  });
}

/** Resultado esperado por direito (`país:emissora` → casamento e canais). */
export const FIXTURE_EXPECTED: Record<string, { match: ChannelMatchKind; channels: number[] }> = {
  'BR:globo': { match: 'exato', channels: [0] },
  'AR:fox_sports': { match: 'exato', channels: [3] },
  'CL:chilevision': { match: 'nome_divergente', channels: [4] },
  'CL:espn': { match: 'feed_generico', channels: [5] },
  'CL:paramount_plus': { match: 'sem_canal_na_lista', channels: [] },
  'CO:espn': { match: 'feed_generico', channels: [5] },
  'CO:disney_plus': { match: 'sem_canal_na_lista', channels: [] },
  'MX:hbo_max': { match: 'sem_canal_na_lista', channels: [] },
};

/** Canais que não casam com nenhum direito do jogo. */
export const FIXTURE_UNMATCHED = [1, 2, 6, 7, 8, 9, 10];
