import { describe, expect, it } from 'vitest';
import type { TeamRef } from '../context/event-core.js';
import { configChannelRows, matchUploads, staleConfigChannels } from './channel-map.js';
import { ChannelAllowlist, type ChannelEntry } from './channels.js';

const team = (id: string, side: 'home' | 'away', name: string): TeamRef => ({
  id,
  side,
  name,
  shortName: null,
  aliases: [],
  labels: {},
});
const KICKOFF = new Date('2026-10-25T00:30:00Z');
const home = { ...team('vasco', 'home', 'Vasco da Gama'), shortName: 'Vasco' };
const away = team('corinthians', 'away', 'Corinthians');
const up = (videoId: string, title: string, publishedAt: string, description = '') => ({
  videoId,
  channelId: 'UC',
  title,
  description,
  publishedAt,
});

describe('uploads de canal que são do jogo', () => {
  const uploads = [
    up('hl', 'MELHORES MOMENTOS | VASCO DA GAMA 2 X 1 CORINTHIANS', '2026-10-25T02:40:00Z'),
    up('col', 'COLETIVA PÓS-JOGO | Vasco', '2026-10-25T03:10:00Z'),
    up('treino', 'Treino do Vasco para a próxima rodada', '2026-10-26T15:00:00Z'),
    up('antes', 'Vasco x Corinthians: prévia', '2026-10-24T20:00:00Z'),
    up('outro', 'Flamengo x Palmeiras | melhores momentos', '2026-10-25T02:00:00Z'),
    up('vs', 'Tudo sobre o duelo contra o Corinthians', '2026-10-25T05:00:00Z'),
  ];

  it('canal do clube: os dois times, o adversário, ou o próprio time até 6 h do apito', () => {
    const ids = matchUploads(uploads, { kickoff: KICKOFF, home, away, kind: 'club', side: 'home' }).map(
      (u) => u.videoId,
    );
    expect(ids).toEqual(['hl', 'col', 'vs']);
  });

  it('canal da liga ou da emissora cobre vários jogos: só com os dois times, depois do apito', () => {
    const ids = matchUploads(uploads, { kickoff: KICKOFF, home, away, kind: 'competition' }).map(
      (u) => u.videoId,
    );
    expect(ids).toEqual(['hl']);
  });
});

describe('allowlist com o mapa do Wikidata', () => {
  it('canal do Wikidata por id vale como oficial, mas passa pelo piso de inscritos', () => {
    const allow = new ChannelAllowlist({
      entries: [
        {
          handle: null,
          id: 'UCvasco',
          kind: 'club',
          broadcaster: null,
          country: 'BR',
          label: null,
          source: 'wikidata',
        },
        {
          handle: null,
          id: 'UCcfg',
          kind: 'club',
          broadcaster: null,
          country: 'BR',
          label: null,
          source: 'config',
        },
      ],
    });
    const ch = (id: string, subscribers: number) => ({ id, title: 'x', handle: null, subscribers });
    expect(allow.classify(ch('UCvasco', 2_000_000), new Set()).tier).toBe('official');
    expect(allow.classify(ch('UCvasco', 500), new Set()).tier).toBe('unknown');
    // entrada conferida à mão (channels.yaml) por id não tem piso
    expect(allow.classify(ch('UCcfg', 500), new Set()).tier).toBe('official');
  });
});

describe('mapa de canais da configuração', () => {
  const entry = (over: Partial<ChannelEntry>): ChannelEntry => ({
    handle: null,
    id: null,
    kind: 'competition',
    broadcaster: null,
    country: null,
    label: null,
    ...over,
  });
  const comps = [
    { id: 'lib', slug: 'conmebol-libertadores' },
    { id: 'sul', slug: 'conmebol-sudamericana' },
    { id: 'ucl', slug: 'uefa-champions-league' },
    { id: 'bra', slug: 'brasileirao-serie-a' },
  ];
  const teams = [{ id: 'pal', name: 'Palmeiras', shortName: null, country: 'BR' }];
  const idOf = new Map([
    ['@conmebol', 'UCcmb'],
    ['@libertadoresbr', 'UClib'],
    ['@uefa', 'UCuefa'],
    ['@palmeiras', 'UCpal'],
  ]);

  it('federação vira uma linha por competição dela; slug só casa com ele mesmo', () => {
    const { rows, unmatched } = configChannelRows(
      [
        entry({ handle: '@conmebol', label: 'conmebol' }),
        entry({ handle: '@libertadoresbr', label: 'conmebol-libertadores' }),
        entry({ handle: '@uefa', label: 'uefa' }),
        entry({ handle: '@palmeiras', kind: 'club', label: 'Palmeiras', country: 'BR' }),
        entry({ handle: '@sumiu', label: 'liga-x' }),
      ],
      { idOf, teams, comps },
    );
    expect(rows.map((r) => `${r.channelId}:${r.competitionId ?? r.participantId}`)).toEqual([
      'UCcmb:lib',
      'UCcmb:sul',
      'UClib:lib',
      'UCuefa:ucl',
      'UCpal:pal',
    ]);
    expect(unmatched).toEqual([]); // @sumiu não foi resolvido: nem entra
    expect(
      configChannelRows([entry({ id: 'UCx', label: 'liga-x' })], { idOf, teams, comps }).unmatched,
    ).toEqual(['liga-x (sem competição)']);
  });

  it('só a linha cuja entrada saiu do arquivo é desativada; a que ficou sem par só vai para o log', () => {
    const row = (channelId: string, sourceRef: string, competitionId: string | null = 'lib') => ({
      id: channelId,
      channelId,
      kind: 'competition' as const,
      participantId: null,
      competitionId,
      broadcasterId: null,
      sourceRef,
    });
    const active = [row('UCcmb', '@conmebol'), row('UCold', '@antigo'), row('UCprev', '@prev')];
    const rows = [{ channelId: 'UCcmb', kind: 'competition' as const, competitionId: 'lib' }];
    // @prev continua no arquivo (handle não conferido, time ambíguo...): fica ativo
    const res = staleConfigChannels(active, rows, new Set(['@conmebol', '@prev']));
    expect(res.gone.map((r) => r.channelId)).toEqual(['UCold']);
    expect(res.unmatched.map((r) => r.channelId)).toEqual(['UCprev']);
    // a mesma entrada, ainda no arquivo, que hoje casa com outra competição: só log
    expect(
      staleConfigChannels([row('UCcmb', '@conmebol', 'ucl')], rows, new Set(['@conmebol'])).gone,
    ).toHaveLength(0);
  });
});
