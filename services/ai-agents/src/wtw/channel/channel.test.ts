import { describe, expect, it } from 'vitest';
import { loadWtwConfig } from '@galaxie/where-to-watch';
import { FakeLlmClient } from '../../llm/fake.js';
import { strictSchemaProblems } from '../../llm/json-schema.js';
import type { EventInfo } from '../event-info.js';
import { MatchChannelAgent } from './agent.js';
import { buildChannelUserPrompt, roundLabel } from './prompt.js';
import { buildChannelSchema } from './schema.js';

const config = loadWtwConfig({ env: {} });

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
      window: 'retry-1d',
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
    expect(llm.calls[0]!.purpose).toBe('wtw:channel:brasileirao-serie-a:Regular_Season_-_32:retry-1d:BR');
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
