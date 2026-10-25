import { describe, expect, it } from 'vitest';
import type { TeamRef } from '../context/event-core.js';
import { matchUploads } from './channel-map.js';
import { ChannelAllowlist } from './channels.js';

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
