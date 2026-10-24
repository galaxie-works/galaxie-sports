/**
 * Exemplo de referência do casamento, o mesmo do teste no AI Studio que validou o prompt: Palmeiras ×
 * Fluminense (semifinal de volta da Libertadores, evento 994821 no teste), a lista de 11 canais de uma
 * operadora e os direitos de BR, AR, CL, CO e MX. Usado nos testes do pacote, do agente e da API; os
 * nomes são de emissoras, não de clientes.
 */
import type { WtwConfig } from '../config/directory.js';
import { rightAccess, type ChannelMatchKind, type ChannelRight, type ClientChannel } from './types.js';

/** Canais do cliente, texto exato do teste (índice = posição). */
export const FIXTURE_CHANNELS: readonly string[] = [
  'BR: |SP| GLOBO HD', //       0 → Globo (BR) exato; a praça não conta
  'BR: FOX SPORTS OMITIDO', //  1 → sem direito no jogo
  'ARG: TELEFE SD', //          2 → sem direito no jogo
  'AR: FOX SPORTS 1 HD', //     3 → Fox Sports (AR) exato; o "1" é o número do feed
  'CL: CHILEVISION SPORTS', //  4 → Chilevisión (CL) nome_divergente
  'ESPN 2 LATAM', //            5 → ESPN (CL e CO) feed_generico: pan-regional, sem o feed do país
  'DISNEY PLUS PREMIUM VOD', // 6 → VOD: não é transmissão ao vivo
  'MX: TNT SPORTS HD', //       7 → sem direito no jogo
  'BR: PREMIERE 4K', //         8 → sem direito no jogo
  'COL: WIN SPORTS+', //        9 → sem direito no jogo
  'MEX: VIX PREMIUM', //        10 → sem direito no jogo
];

export const fixtureChannels = (): ClientChannel[] =>
  FIXTURE_CHANNELS.map((name, idx) => ({ idx, name, group: null }));

/**
 * Direitos do jogo por país. `testId` é o `plataforma_id` usado no AI Studio; `broadcasterId` é o id
 * da nossa biblioteca de emissoras (config/broadcasters/<iso2>.yaml).
 */
export const FIXTURE_RIGHTS: readonly {
  country: 'BR' | 'AR' | 'CL' | 'CO' | 'MX';
  broadcasterId: string;
  testId: string;
  testAccess: string;
}[] = [
  { country: 'BR', broadcasterId: 'globo', testId: 'br-globo', testAccess: 'aberto' },
  {
    country: 'BR',
    broadcasterId: 'paramount_plus',
    testId: 'latam-paramount-plus',
    testAccess: 'streaming_assinatura',
  },
  {
    country: 'BR',
    broadcasterId: 'disney_plus',
    testId: 'latam-disney-plus',
    testAccess: 'streaming_assinatura',
  },
  { country: 'AR', broadcasterId: 'fox_sports', testId: 'ar-fox-sports', testAccess: 'assinatura_base' },
  {
    country: 'AR',
    broadcasterId: 'disney_plus',
    testId: 'latam-disney-plus',
    testAccess: 'streaming_assinatura',
  },
  { country: 'CL', broadcasterId: 'chilevision', testId: 'cl-chilevision', testAccess: 'aberto' },
  { country: 'CL', broadcasterId: 'espn', testId: 'latam-espn', testAccess: 'assinatura_base' },
  {
    country: 'CL',
    broadcasterId: 'disney_plus',
    testId: 'latam-disney-plus',
    testAccess: 'streaming_assinatura',
  },
  { country: 'CO', broadcasterId: 'espn', testId: 'latam-espn', testAccess: 'assinatura_base' },
  {
    country: 'CO',
    broadcasterId: 'disney_plus',
    testId: 'latam-disney-plus',
    testAccess: 'streaming_assinatura',
  },
  { country: 'MX', broadcasterId: 'hbo_max', testId: 'mx-max', testAccess: 'streaming_assinatura' },
];

/** Direitos numerados com o meio e o acesso do dicionário. */
export function fixtureRights(config: WtwConfig): ChannelRight[] {
  return FIXTURE_RIGHTS.map(({ country, broadcasterId }, idx) => {
    const b = config.directory(country).byIdOrNull(broadcasterId);
    if (!b) throw new Error(`Fixture: ${broadcasterId} fora do dicionário de ${country}`);
    return {
      idx,
      country,
      broadcasterId,
      name: b.name,
      medium: b.medium,
      accessModel: b.accessModel,
      access: rightAccess(b.medium),
    };
  });
}

/** Resultado esperado por direito (`país:emissora` → casamento e canais), o que o modelo devolveu no teste. */
export const FIXTURE_EXPECTED: Record<string, { match: ChannelMatchKind; channels: number[] }> = {
  'BR:globo': { match: 'exato', channels: [0] },
  'BR:paramount_plus': { match: 'sem_canal_na_lista', channels: [] },
  'BR:disney_plus': { match: 'sem_canal_na_lista', channels: [] },
  'AR:fox_sports': { match: 'exato', channels: [3] },
  'AR:disney_plus': { match: 'sem_canal_na_lista', channels: [] },
  'CL:chilevision': { match: 'nome_divergente', channels: [4] },
  'CL:espn': { match: 'feed_generico', channels: [5] },
  'CL:disney_plus': { match: 'sem_canal_na_lista', channels: [] },
  'CO:espn': { match: 'feed_generico', channels: [5] },
  'CO:disney_plus': { match: 'sem_canal_na_lista', channels: [] },
  'MX:hbo_max': { match: 'sem_canal_na_lista', channels: [] },
};

/** Canais que não casam com nenhum direito do jogo (o 6 é VOD). */
export const FIXTURE_UNMATCHED = [1, 2, 6, 7, 8, 9, 10];
