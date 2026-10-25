import { describe, expect, it } from 'vitest';
import { wikidataChannelLinks, youtubeChannelIds } from './wikidata-channels.js';

const claim = (value: string, rank = 'normal', qualifiers?: Record<string, unknown[]>) => ({
  rank,
  mainsnak: { datavalue: { value } },
  ...(qualifiers ? { qualifiers } : {}),
});
const VASCO = 'UCZD5qcen7lbLPFTjfvdLFcw';
const OLD = 'UC0uRT_armQXqds_rjTjqJ0g';

describe('P2397 (YouTube channel ID) do Wikidata', () => {
  it('sem depreciadas e encerradas; preferida vence; só ids no formato do YouTube', () => {
    expect(youtubeChannelIds([claim(VASCO), claim(OLD, 'normal', { P582: [{}] })])).toEqual([VASCO]);
    expect(youtubeChannelIds([claim(OLD), claim(VASCO, 'preferred')])).toEqual([VASCO]);
    expect(youtubeChannelIds([claim(VASCO, 'deprecated')])).toEqual([]);
    expect(youtubeChannelIds([claim('@vasco'), claim('UCcurto')])).toEqual([]);
    expect(youtubeChannelIds(undefined)).toEqual([]);
  });

  it('QID do time e da competição → linhas do mapa (clube e competição)', async () => {
    const client = {
      claims: async (ids: string[]) =>
        new Map(ids.map((id) => [id, { P2397: id === 'Q5014111' ? [claim(VASCO)] : [] }])),
    };
    const links = await wikidataChannelLinks(client, {
      teams: [
        { participantId: 'p-vasco', qid: 'Q5014111' },
        { participantId: 'p-sem', qid: 'Q1' },
      ],
      competitions: [{ competitionId: 'c-br', qid: 'Q206813' }],
    });
    expect(links).toEqual([{ kind: 'club', participantId: 'p-vasco', channelId: VASCO, qid: 'Q5014111' }]);
  });
});
