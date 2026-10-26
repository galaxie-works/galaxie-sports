import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  competition,
  competitionProfile,
  country,
  event,
  eventParticipant,
  participant,
  sport,
  type Database,
} from '@galaxie/db';
import { competitionName, eventNames, loadEventCore } from '../src/context/event-core.js';
import { disposableDb } from './helpers.js';

/*
 * Perfil da competição nos agentes (Cenário, Resumo): o rótulo de `semantic.competition_profile` só entra
 * no texto quando o perfil está aprovado, o mesmo piso padrão da API.
 */

const env = disposableDb();
let db: Database;
let eventId: string;

beforeAll(async () => {
  db = await env.setup();
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  await db.insert(country).values({ code: 'WORLD', name: { en: 'World', 'pt-BR': 'Mundo', es: 'Mundo' } });
  const [ucl] = await db
    .insert(competition)
    .values({
      sport: 'football',
      slug: 'uefa-champions-league',
      name: 'UEFA Champions League',
      countryCode: 'WORLD',
      type: 'cup',
      tier: 1,
    })
    .returning();
  await db.insert(competitionProfile).values({
    slug: 'uefa-champions-league',
    competitionId: ucl!.id,
    labels: { 'pt-BR': 'Liga dos Campeões' },
    sourceFile: 'competitions/football-europe-world.yaml',
    reviewStatus: 'draft',
  });
  const teams = await db
    .insert(participant)
    .values([
      { sport: 'football', kind: 'club', name: 'Arsenal' },
      { sport: 'football', kind: 'club', name: 'Inter' },
    ])
    .returning();
  const [e] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId: ucl!.id,
      startsAt: new Date('2026-10-28T20:00:00Z'),
      endsAtExpected: new Date('2026-10-28T22:00:00Z'),
      status: 'scheduled',
    })
    .returning();
  eventId = e!.id;
  await db.insert(eventParticipant).values([
    { eventId, participantId: teams[0]!.id, side: 'home' },
    { eventId, participantId: teams[1]!.id, side: 'away' },
  ]);
}, 60_000);

afterAll(async () => {
  await env.teardown();
});

describe('loadEventCore × piso editorial do perfil da competição', () => {
  it('perfil em rascunho não dá nome à competição', async () => {
    const core = (await loadEventCore(db, eventId))!;
    expect(competitionName(core, 'pt-BR')).toBe('UEFA Champions League');
    expect(eventNames(core)).not.toContain('Liga dos Campeões');
  });

  it('perfil aprovado (YAML ou painel) passa a valer', async () => {
    await db
      .update(competitionProfile)
      .set({ reviewStatus: 'approved' })
      .where(eq(competitionProfile.slug, 'uefa-champions-league'));
    const core = (await loadEventCore(db, eventId))!;
    expect(competitionName(core, 'pt-BR')).toBe('Liga dos Campeões');
    expect(eventNames(core)).toContain('Liga dos Campeões');
  });
});
