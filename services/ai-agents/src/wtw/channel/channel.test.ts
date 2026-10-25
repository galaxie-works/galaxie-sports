import { describe, expect, it } from 'vitest';
import { loadWtwConfig } from '@galaxie/where-to-watch';
import { FakeLlmClient } from '../../llm/fake.js';
import { strictSchemaProblems } from '../../llm/json-schema.js';
import type { EventInfo } from '../event-info.js';
import { MatchChannelAgent } from './agent.js';
import { buildChannelUserPrompt, roundLabel } from './prompt.js';
import { buildChannelSchema } from './schema.js';
import { dayBucket, dueChannelWindow } from './windows.js';

const H = 3_600_000;
const config = loadWtwConfig({ env: {} });

describe('janelas do canal do jogo', () => {
  const roundStart = new Date('2026-10-24T19:30:00Z');
  const start = new Date('2026-10-26T22:00:00Z');
  const anchors = { roundStart, dayStart: start, dayLastStart: new Date('2026-10-26T23:00:00Z') };
  const at = (ms: number) => new Date(ms);
  const due = (now: Date, status = 'scheduled') =>
    dueChannelWindow({ startsAt: start, status }, anchors, now);

  it('T-5d e T-48h pelo primeiro jogo da rodada; T-6h pelo primeiro jogo do dia', () => {
    expect(due(at(roundStart.getTime() - 6 * 24 * H))).toBeNull();
    expect(due(at(roundStart.getTime() - 4 * 24 * H))).toMatchObject({
      window: 'T-5d',
      bucket: 'round',
      phase: 'pre',
    });
    expect(due(at(roundStart.getTime() - 24 * H))).toMatchObject({ window: 'T-48h', bucket: 'round' });
    // entre o início da rodada e o T-6h do jogo, a vigente segue a T-48h (já pesquisada)
    expect(due(at(roundStart.getTime() + H))).toMatchObject({ window: 'T-48h' });
    expect(due(at(start.getTime() - 5 * H))).toMatchObject({ window: 'T-6h', bucket: dayBucket(start) });
    expect(due(at(start.getTime() + H), 'live')).toBeNull();
  });

  it('depois do jogo: 3 h depois do último jogo do dia, até 72 h', () => {
    expect(due(at(start.getTime() + 3 * H), 'finished')).toBeNull();
    expect(due(at(anchors.dayLastStart.getTime() + 3 * H), 'finished')).toMatchObject({
      window: 'post',
      phase: 'post',
    });
    expect(due(at(start.getTime() + 73 * H), 'finished')).toBeNull();
  });

  it('o dia do jogo das 21h30 de Brasília (00h30 UTC) é o dia em que é jogado', () => {
    expect(dayBucket(new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-24');
  });
});

const info = (id: string, home: string, away: string, startsAt: string): EventInfo => ({
  id,
  sport: 'football',
  startsAt: new Date(startsAt),
  status: 'scheduled',
  competition: {
    id: 'c1',
    slug: 'brasileirao-serie-a',
    name: 'Brasileirão Série A',
    tier: 1,
    countryCode: 'BR',
  },
  home,
  away,
  participants: [home, away],
  round: 'Regular Season - 32',
  season: 2026,
});

describe('agente do canal do jogo', () => {
  const events = [
    info('e1', 'Sao Paulo', 'Mirassol', '2026-10-24T19:30:00Z'),
    info('e2', 'Gremio', 'Coritiba', '2026-10-26T22:30:00Z'),
  ];
  const markets = [
    { directory: config.directory('BR'), holders: ['globo', 'premiere', 'sportv'], matches: ['J1', 'J2'] },
  ];

  it('schema estrito com os enums da chamada (jogos, países, emissoras e canais)', () => {
    const schema = buildChannelSchema({
      matches: ['J1', 'J2'],
      countries: ['BR'],
      broadcasters: ['globo', 'premiere'],
      channels: ['SporTV 2'],
    });
    expect(strictSchemaProblems(schema)).toEqual([]);
    const item = (
      schema as {
        properties: { assignments: { items: { properties: Record<string, { enum?: unknown[] }> } } };
      }
    ).properties.assignments.items.properties;
    expect(item.broadcaster!.enum).toEqual(['globo', 'premiere']);
    expect(item.match!.enum).toEqual(['J1', 'J2']);
    expect(item.channel!.enum).toEqual(['SporTV 2', null]);
  });

  it('prompt da rodada: "rodada 32", ids dos detentores e consultas sugeridas', () => {
    expect(roundLabel('Regular Season - 32')).toBe('rodada 32');
    expect(roundLabel('data:2026-10-24')).toBe('jogos de 24/10/2026');
    const text = buildChannelUserPrompt({
      competition: { slug: 'brasileirao-serie-a', name: 'Brasileirão Série A' },
      season: 2026,
      round: 'Regular Season - 32',
      phase: 'pre',
      matches: events.map((e, i) => ({ code: `J${i + 1}`, info: e })),
      markets,
    });
    expect(text).toContain('Rodada: rodada 32');
    expect(text).toContain('- J1: Sao Paulo x Mirassol — 24/10/2026 16:30');
    expect(text).toContain('· premiere = Premiere');
    expect(text).toContain('transmissão rodada 32 Brasileirão Série A 2026');
  });

  it('só ids da lista: linha de jogo, país ou emissora fora dela é ignorada', async () => {
    const llm = new FakeLlmClient([
      {
        data: {
          assignments: [
            {
              match: 'J1',
              country: 'BR',
              broadcaster: 'premiere',
              channel: null,
              evidence: [
                {
                  url: 'https://ge.globo.com/x',
                  excerpt: 'São Paulo x Mirassol no Premiere',
                  published_at: null,
                },
              ],
            },
            { match: 'J2', country: 'BR', broadcaster: 'sportv', channel: 'SporTV 2', evidence: [] },
          ],
          notes: null,
        },
        groundedUrls: ['https://ge.globo.com/x'],
      },
    ]);
    const agent = new MatchChannelAgent(llm);
    const res = await agent.research({
      competition: { slug: 'brasileirao-serie-a', name: 'Brasileirão Série A' },
      season: 2026,
      round: 'Regular Season - 32',
      phase: 'pre',
      window: 'T-48h',
      events,
      markets: [{ ...markets[0]!, holders: ['premiere', 'sportv'], matches: ['J1'] }],
    });
    // J2 não foi pedido para o BR nesta chamada
    expect(res.ignored).toBe(1);
    expect(res.byEvent.get('e1')!.get('BR')).toEqual([
      {
        broadcasterId: 'premiere',
        channel: null,
        evidence: [
          { url: 'https://ge.globo.com/x', excerpt: 'São Paulo x Mirassol no Premiere', publishedAt: null },
        ],
      },
    ]);
    expect(res.groundedUrls).toEqual(['https://ge.globo.com/x']);
    expect(llm.calls[0]!.purpose).toBe('wtw:channel:brasileirao-serie-a:Regular_Season_-_32:T-48h:BR');
    expect(llm.calls[0]!.webSearch).toBe(true);
  });

  it('o schema recusa emissora fora do enum (texto livre)', async () => {
    const llm = new FakeLlmClient([
      {
        data: {
          assignments: [
            { match: 'J1', country: 'BR', broadcaster: 'TV Qualquer', channel: null, evidence: [] },
          ],
          notes: null,
        },
      },
    ]);
    await expect(
      new MatchChannelAgent(llm).research({
        competition: { slug: 'brasileirao-serie-a', name: 'Brasileirão Série A' },
        season: 2026,
        round: 'Regular Season - 32',
        phase: 'post',
        window: 'post',
        events,
        markets,
      }),
    ).rejects.toThrow(/schema/);
  });
});
