/**
 * Mapa de canais oficiais pelo Wikidata (CLI `canais:wikidata`, docs/12 §3.2) com banco descartável: alvos da janela
 * (times com e sem QID, competição com QID da cobertura de títulos), gravação com a fonte e o QID, reativação e
 * desativação quando o P2397 muda.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  competition,
  competitionTitleCoverage,
  country,
  event,
  eventParticipant,
  participant,
  providerMap,
  relatedChannel,
  sport,
  type Database,
} from '@galaxie/db';
import { channelTargets, saveChannelLinks } from '../src/assets/wikidata-channels.js';
import { disposableDb } from './db.js';

const env = disposableDb();
let db: Database;
let vasco: string;
let corinthians: string;
let serieA: string;
const KICKOFF = new Date('2026-10-25T00:30:00Z');

beforeAll(async () => {
  db = await env.setup();
  await db
    .insert(sport)
    .values({ slug: 'football', name: { 'pt-BR': 'Futebol' } })
    .onConflictDoNothing();
  await db
    .insert(country)
    .values({ code: 'BR', name: { en: 'Brazil' } })
    .onConflictDoNothing();
  const [c] = await db
    .insert(competition)
    .values({
      sport: 'football',
      slug: 'brasileirao-serie-a',
      name: 'Serie A',
      countryCode: 'BR',
      type: 'league',
      tier: 1,
    })
    .returning();
  serieA = c!.id;
  await db.insert(competitionTitleCoverage).values({ competitionId: serieA, competitionQid: 'Q206813' });
  const teams = await db
    .insert(participant)
    .values([
      { sport: 'football', kind: 'club', name: 'Vasco da Gama', countryCode: 'BR' },
      { sport: 'football', kind: 'club', name: 'Corinthians', countryCode: 'BR' },
    ])
    .returning();
  [vasco, corinthians] = [teams[0]!.id, teams[1]!.id];
  await db.insert(providerMap).values([
    {
      entityType: 'participant',
      entityId: vasco,
      provider: 'api-sports',
      sport: 'football',
      providerId: '133',
    },
    {
      entityType: 'participant',
      entityId: corinthians,
      provider: 'api-sports',
      sport: 'football',
      providerId: '131',
    },
    {
      entityType: 'participant',
      entityId: vasco,
      provider: 'wikidata',
      sport: 'football',
      providerId: 'Q5014111',
    },
  ]);
  const [e] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId: serieA,
      startsAt: KICKOFF,
      endsAtExpected: new Date(KICKOFF.getTime() + 7_200_000),
    })
    .returning();
  await db.insert(eventParticipant).values([
    { eventId: e!.id, participantId: vasco, side: 'home' },
    { eventId: e!.id, participantId: corinthians, side: 'away' },
  ]);
}, 120_000);

afterAll(async () => {
  await env.teardown();
});

describe('mapa de canais pelo Wikidata (integração)', () => {
  it('alvos: times da janela (com e sem QID) e a competição com QID', async () => {
    const t = await channelTargets(db, {
      since: new Date('2026-10-24T00:00:00Z'),
      until: new Date('2026-10-26T00:00:00Z'),
      maxTier: 2,
    });
    expect(t.teams.map((x) => [x.name, x.qid]).sort()).toEqual([
      ['Corinthians', null],
      ['Vasco da Gama', 'Q5014111'],
    ]);
    expect(t.unresolved).toEqual([
      { providerId: '131', name: 'Corinthians', country: 'Brazil', leagues: ['Serie A'] },
    ]);
    expect(t.competitions).toEqual([{ competitionId: serieA, slug: 'brasileirao-serie-a', qid: 'Q206813' }]);
  });

  it('grava com a fonte e o QID; P2397 trocado desativa o canal antigo (nunca apaga)', async () => {
    const checked = { club: [vasco], competition: [serieA] };
    const first = await saveChannelLinks(
      db,
      [{ kind: 'club', participantId: vasco, channelId: 'UCZD5qcen7lbLPFTjfvdLFcw', qid: 'Q5014111' }],
      checked,
    );
    expect(first).toEqual({ inserted: 1, kept: 0, deactivated: 0 });
    const again = await saveChannelLinks(
      db,
      [{ kind: 'club', participantId: vasco, channelId: 'UCZD5qcen7lbLPFTjfvdLFcw', qid: 'Q5014111' }],
      checked,
    );
    expect(again).toEqual({ inserted: 0, kept: 1, deactivated: 0 });
    const changed = await saveChannelLinks(
      db,
      [{ kind: 'club', participantId: vasco, channelId: 'UCnovoCanalDoVasco0000000', qid: 'Q5014111' }],
      checked,
    );
    expect(changed).toEqual({ inserted: 1, kept: 0, deactivated: 1 });
    const rows = await db
      .select()
      .from(relatedChannel)
      .where(and(eq(relatedChannel.participantId, vasco), eq(relatedChannel.source, 'wikidata')));
    expect(rows.map((r) => [r.channelId, r.active, r.sourceRef]).sort()).toEqual([
      ['UCZD5qcen7lbLPFTjfvdLFcw', false, 'Q5014111'],
      ['UCnovoCanalDoVasco0000000', true, 'Q5014111'],
    ]);
  });
});
