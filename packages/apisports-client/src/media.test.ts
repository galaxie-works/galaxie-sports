import { describe, expect, it } from 'vitest';
import {
  coachPhotoUrl,
  extractMediaUrls,
  flagUrl,
  isProviderMediaUrl,
  MediaDenylist,
  mediaKindFromUrl,
  mediaUrl,
  mediaStorageKey,
  normalizeMediaUrl,
  playerPhotoUrl,
  publicAssetUrl,
  rewriteMediaUrl,
  rewriteMediaUrls,
} from './media.js';

const BASE = 'http://localhost:9000/galaxie-sports-assets/';
const PAULISTAO = 'https://media.api-sports.io/football/leagues/475.png';

describe('construtores de URL da CDN de mídia', () => {
  it('monta a URL de um caminho, com ou sem barra inicial', () => {
    expect(mediaUrl('football/teams/121.png')).toBe('https://media.api-sports.io/football/teams/121.png');
    expect(mediaUrl('/flags/br.svg')).toBe('https://media.api-sports.io/flags/br.svg');
  });

  it('monta bandeira, foto de jogador e foto de técnico', () => {
    expect(flagUrl('US')).toBe('https://media.api-sports.io/flags/us.svg');
    expect(flagUrl('au')).toBe('https://media.api-sports.io/flags/au.svg');
    expect(playerPhotoUrl('154')).toBe('https://media.api-sports.io/football/players/154.png');
    expect(coachPhotoUrl('12')).toBe('https://media.api-sports.io/football/coachs/12.png');
  });

  it('o que o construtor monta é reconhecido como mídia do fornecedor e volta com o tipo certo', () => {
    expect(isProviderMediaUrl(flagUrl('BR'))).toBe(true);
    expect(mediaKindFromUrl(flagUrl('BR'))).toBe('flag');
    expect(mediaKindFromUrl(playerPhotoUrl('1'))).toBe('player');
    expect(mediaKindFromUrl(coachPhotoUrl('1'))).toBe('coach');
    expect(normalizeMediaUrl(playerPhotoUrl('1'))).toBe(playerPhotoUrl('1'));
  });
});

describe('URLs de mídia', () => {
  it('reconhece a CDN e seus espelhos, e só ela', () => {
    expect(isProviderMediaUrl('https://media.api-sports.io/flags/br.svg')).toBe(true);
    expect(isProviderMediaUrl('https://media-2.api-sports.io/football/teams/1.png')).toBe(true);
    expect(isProviderMediaUrl('https://upload.wikimedia.org/x.png')).toBe(false);
    expect(isProviderMediaUrl('https://v3.football.api-sports.io/leagues')).toBe(false);
    expect(isProviderMediaUrl('não é url')).toBe(false);
  });

  it('normaliza host, protocolo e query', () => {
    expect(normalizeMediaUrl('http://media-3.api-sports.io//volley/teams/7.png?x=1')).toBe(
      'https://media.api-sports.io/volley/teams/7.png',
    );
    expect(normalizeMediaUrl('https://example.com/a.png')).toBeUndefined();
  });

  it('deriva chave e tipo pelo caminho', () => {
    expect(mediaStorageKey('https://media.api-sports.io/football/teams/121.png')).toBe(
      'api-sports/football/teams/121.png',
    );
    expect(mediaKindFromUrl('https://media.api-sports.io/flags/gb-eng.svg')).toBe('flag');
    expect(mediaKindFromUrl('https://media.api-sports.io/basketball/leagues/26.png')).toBe('league_logo');
    expect(mediaKindFromUrl('https://media.api-sports.io/football/coachs/2.png')).toBe('coach');
    expect(mediaKindFromUrl('https://media.api-sports.io/formula-1/circuits/16.png')).toBe('circuit');
    expect(mediaKindFromUrl('https://media.api-sports.io/mma/fighters/9.png')).toBe('fighter');
    expect(mediaKindFromUrl('https://media.api-sports.io/x/y/z.png')).toBe('other');
  });

  it('extrai URLs de JSON, inclusive com barras escapadas, sem repetir', () => {
    const body = {
      league: { logo: 'https://media.api-sports.io/football/leagues/71.png' },
      country: { flag: 'https://media-1.api-sports.io/flags/br.svg' },
      other: 'https://media.api-sports.io/football/leagues/71.png',
    };
    expect(extractMediaUrls(body)).toEqual([
      'https://media.api-sports.io/flags/br.svg',
      'https://media.api-sports.io/football/leagues/71.png',
    ]);
    expect(extractMediaUrls('{"logo":"https:\\/\\/media.api-sports.io\\/afl\\/teams\\/1.png"}')).toEqual([
      'https://media.api-sports.io/afl/teams/1.png',
    ]);
  });
});

describe('reescrita e lista de bloqueio', () => {
  const denylist = new MediaDenylist([{ url: PAULISTAO, reason: 'escudo de clube homônimo' }]);

  it('reescreve para o nosso CDN e bloqueia o que está na lista', () => {
    expect(publicAssetUrl('/api-sports/flags/br.svg', BASE)).toBe(
      'http://localhost:9000/galaxie-sports-assets/api-sports/flags/br.svg',
    );
    expect(publicAssetUrl('api-sports/flags/br.svg', BASE, '8370504ef875aa')).toBe(
      'http://localhost:9000/galaxie-sports-assets/api-sports/flags/br.svg?v=8370504e',
    );
    expect(
      rewriteMediaUrl('https://media-2.api-sports.io/football/teams/121.png', { publicBaseUrl: BASE }),
    ).toBe('http://localhost:9000/galaxie-sports-assets/api-sports/football/teams/121.png');
    expect(
      rewriteMediaUrl('http://media.api-sports.io/football/leagues/475.png', {
        publicBaseUrl: BASE,
        denylist,
      }),
    ).toBeNull();
    expect(denylist.reason(PAULISTAO)).toBe('escudo de clube homônimo');
    // fora da CDN: intacta
    expect(rewriteMediaUrl('https://upload.wikimedia.org/a.svg', { publicBaseUrl: BASE })).toBe(
      'https://upload.wikimedia.org/a.svg',
    );
  });

  it('reescreve um envelope inteiro', () => {
    const envelope = {
      response: [
        {
          league: { id: 475, logo: PAULISTAO },
          country: { flag: 'https://media.api-sports.io/flags/br.svg' },
        },
      ],
      results: 1,
    };
    expect(rewriteMediaUrls(envelope, { publicBaseUrl: BASE, denylist })).toEqual({
      response: [
        {
          league: { id: 475, logo: null },
          country: { flag: 'http://localhost:9000/galaxie-sports-assets/api-sports/flags/br.svg' },
        },
      ],
      results: 1,
    });
  });

  it('recusa URLs fora da CDN na lista', () => {
    expect(() => new MediaDenylist([{ url: 'https://example.com/a.png', reason: 'x' }])).toThrow();
  });
});
