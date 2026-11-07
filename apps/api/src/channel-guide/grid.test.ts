import { describe, expect, it } from 'vitest';
import { ConfirmedChannels } from '../channel-list/lists.js';
import {
  guideChannelNames,
  guideChannelsByEvent,
  parseGuideChannels,
  parseGuideSports,
  type GuideOptionRow,
} from './grid.js';

const E1 = '00000000-0000-7000-8000-000000000001';
const E2 = '00000000-0000-7000-8000-000000000002';
const E3 = '00000000-0000-7000-8000-000000000003';

// lista do cliente: Globo (duas praças), SporTV 1 e 2, ESPN; o casamento confirmado por emissora no país
const list = new ConfirmedChannels(
  new Date('2026-11-01T00:00:00Z'),
  [
    { idx: 0, name: 'Globo SP HD', group: 'Abertos' },
    { idx: 1, name: 'Globo RJ HD', group: 'Abertos' },
    { idx: 2, name: 'SporTV HD', group: 'Esportes' },
    { idx: 3, name: 'SporTV 2 HD', group: 'Esportes' },
    { idx: 4, name: 'ESPN HD', group: 'Esportes' },
  ],
  [
    {
      country: 'BR',
      broadcasterId: 'globo',
      name: 'Globo',
      access: 'free',
      match: 'exato',
      channels: [0, 1],
      origin: 'code',
      note: null,
    },
    {
      country: 'BR',
      broadcasterId: 'sportv',
      name: 'SporTV',
      access: 'pay',
      match: 'exato',
      channels: [2, 3],
      origin: 'code',
      note: null,
    },
    {
      country: 'BR',
      broadcasterId: 'espn',
      name: 'ESPN',
      access: 'pay',
      match: 'exato',
      channels: [4],
      origin: 'code',
      note: null,
    },
    {
      country: 'BR',
      broadcasterId: 'premiere',
      name: 'Premiere',
      access: 'pay',
      match: 'sem_canal_na_lista',
      channels: [],
      origin: 'code',
      note: null,
    },
  ] as never,
);

const opt = (
  eventId: string,
  broadcasterId: string,
  extra: Partial<GuideOptionRow> = {},
): GuideOptionRow => ({
  eventId,
  broadcasterId,
  channelName: null,
  region: null,
  status: 'confirmed',
  producedBy: 'agent:wtw@v1',
  ...extra,
});

describe('grade nos canais do cliente', () => {
  it('leva as opções confirmadas aos canais da lista, com o feed do canal quando a opção diz', () => {
    const byEvent = guideChannelsByEvent(
      'BR',
      [
        opt(E1, 'globo'),
        opt(E1, 'sportv', { channelName: 'SporTV 2' }),
        // a confirmar não entra na grade
        opt(E2, 'espn', { status: 'probable' }),
        // emissora fora da lista do cliente
        opt(E2, 'premiere'),
      ],
      [],
      list,
      null,
    );
    expect(byEvent.get(E1)).toEqual(['Globo RJ HD', 'Globo SP HD', 'SporTV 2 HD']);
    expect(byEvent.has(E2)).toBe(false);
    expect(guideChannelNames(byEvent)).toEqual(['Globo RJ HD', 'Globo SP HD', 'SporTV 2 HD']);
  });

  it('soma o canal do jogo confirmado, menos o que a editoria retirou', () => {
    const byEvent = guideChannelsByEvent(
      'BR',
      [opt(E3, 'espn', { status: 'retracted', producedBy: 'editorial:ana' })],
      [
        { eventId: E2, broadcasterId: 'espn', channelName: null },
        { eventId: E3, broadcasterId: 'espn', channelName: null },
      ],
      list,
      null,
    );
    expect(byEvent.get(E2)).toEqual(['ESPN HD']);
    expect(byEvent.has(E3)).toBe(false);
  });

  it('o canal confirmado do jogo afina a opção genérica da mesma emissora (a editorial vence)', () => {
    const byEvent = guideChannelsByEvent(
      'BR',
      [opt(E1, 'sportv'), opt(E2, 'sportv', { producedBy: 'editorial:ana' })],
      [
        { eventId: E1, broadcasterId: 'sportv', channelName: 'SporTV 2' },
        { eventId: E2, broadcasterId: 'sportv', channelName: 'SporTV 2' },
      ],
      list,
      null,
    );
    expect(byEvent.get(E1)).toEqual(['SporTV 2 HD']);
    // a escolha da editoria (a emissora inteira) não é afinada pelo canal do jogo
    expect(byEvent.get(E2)).toEqual(['SporTV 2 HD', 'SporTV HD']);
  });

  it('feed confirmado fora da lista: só os canais sem número da emissora, nunca o feed de outro número', () => {
    const byEvent = guideChannelsByEvent(
      'BR',
      [opt(E1, 'sportv', { channelName: 'SporTV 3' })],
      [],
      list,
      null,
    );
    expect(byEvent.get(E1)).toEqual(['SporTV HD']);
  });

  it('com canais escolhidos no widget, só eles; jogo sem nenhum deles sai da grade', () => {
    const byEvent = guideChannelsByEvent(
      'BR',
      [opt(E1, 'globo'), opt(E2, 'espn')],
      [],
      list,
      parseGuideChannels('Globo SP HD\n\n  SporTV HD  '),
    );
    expect([...byEvent]).toEqual([[E1, ['Globo SP HD']]]);
  });

  it('confere as opções salvas (canais um por linha, esportes por vírgula)', () => {
    expect(parseGuideChannels('')).toBeNull();
    expect(parseGuideChannels(42)).toBeNull();
    expect([...parseGuideChannels('A\nB\nA')!]).toEqual(['A', 'B']);
    expect(parseGuideSports('football, basketball,football,NBA!')).toEqual(['basketball', 'football']);
    expect(parseGuideSports(',')).toBeNull();
  });
});
