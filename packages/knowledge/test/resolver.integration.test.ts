import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiResponse,
  country,
  participant,
  providerMap,
  sport,
  teamProfile,
  type Database,
} from '@galaxie/db';
import { loadKnowledge, type KnowledgeBase } from '../src/load.js';
import { applyResolutionsToDb } from '../src/resolver/apply-db.js';
import { resolveTeams, teamRef } from '../src/resolver/match.js';
import { loadCandidatePool } from '../src/resolver/sources.js';
import { seedSemantic } from '../src/seed.js';
import { createTestDb } from './helpers.js';

let db: Database;
let drop: () => Promise<void>;
let kb: KnowledgeBase;

const team = (id: number, name: string, extra: Record<string, unknown> = {}, city: string | null = null) => ({
  team: { id, name, code: null, country: 'Brazil', founded: null, national: false, ...extra },
  venue: { city },
});

async function rawResponse(endpoint: string, params: Record<string, string>, response: unknown[]) {
  const body = {
    get: endpoint.slice(1),
    parameters: params,
    errors: [],
    results: response.length,
    paging: { current: 1, total: 1 },
    response,
  };
  await db.insert(apiResponse).values({
    sport: 'football',
    apiVersion: 'v3',
    endpoint,
    params,
    requestHash: `${endpoint}:${JSON.stringify(params)}`,
    statusCode: 200,
    results: response.length,
    body,
    bodyHash: `${endpoint}:${JSON.stringify(params)}`,
  });
}

beforeAll(async () => {
  ({ db, drop } = await createTestDb());
  kb = await loadKnowledge();
  await rawResponse('/leagues', {}, [
    { league: { id: 71 }, country: { name: 'Brazil', code: 'BR' } },
    { league: { id: 140 }, country: { name: 'Spain', code: 'ES' } },
  ]);
  await rawResponse('/teams', { country: 'Brazil' }, [
    team(121, 'Palmeiras', { code: 'PAL', founded: 1914 }),
    team(12968, 'Palmeiras U20'),
    team(126, 'Sao Paulo', { founded: 1930 }),
    team(131, 'Corinthians'),
    team(753, 'Santa Cruz', { founded: 1914 }, 'Recife, Pernambuco'),
    team(13974, 'Santa Cruz'),
    team(6, 'Brazil', { national: true, founded: 1914 }),
  ]);
  await rawResponse('/fixtures', { date: '2026-10-21' }, [
    {
      league: { id: 140, name: 'La Liga', country: 'Spain' },
      teams: { home: { id: 531, name: 'Athletic Club' }, away: { id: 541, name: 'Real Madrid' } },
    },
  ]);
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  await db.insert(country).values({ code: 'BR', name: { en: 'Brazil' } });
  await seedSemantic(db, kb);
}, 60_000);

afterAll(async () => {
  if (drop) await drop();
});

describe('resolver de IDs contra o banco', () => {
  it('lê candidatos do raw e do core e resolve os times do Brasil', async () => {
    const [palmeiras] = await db
      .insert(participant)
      .values({ sport: 'football', kind: 'club', name: 'Palmeiras', countryCode: 'BR' })
      .returning();
    await db.insert(providerMap).values({
      entityType: 'participant',
      entityId: palmeiras!.id,
      provider: 'api-sports',
      sport: 'football',
      providerId: '121',
    });

    // participante vindo de outro provedor, ainda sem ID da api-sports
    const [corinthians] = await db
      .insert(participant)
      .values({ sport: 'football', kind: 'club', name: 'Corinthians', countryCode: 'BR' })
      .returning();

    const pool = await loadCandidatePool(db);
    expect([...pool.coveredCountries]).toEqual(['brazil']);
    const fromCore = pool.candidates.find((c) => c.apiId === 121);
    expect(fromCore).toMatchObject({ participantId: palmeiras!.id, countryCode: 'BR', source: 'teams' });
    expect(pool.candidates.find((c) => c.apiId === 531)).toMatchObject({
      countryCode: 'ES',
      source: 'fixtures',
    });

    const refs = kb.teams
      .filter((t) =>
        ['palmeiras', 'corinthians', 'santa-cruz', 'brazil-nt', 'flamengo', 'athletic-club'].includes(
          t.entry.slug,
        ),
      )
      .map(teamRef);
    // estado do YAML antes do write-back desta issue: santa-cruz, brazil-nt e athletic-club sem ID
    for (const r of refs)
      if (['santa-cruz', 'brazil-nt', 'athletic-club'].includes(r.slug)) r.currentId = null;
    const results = Object.fromEntries(resolveTeams(refs, pool).map((r) => [r.slug, r]));
    expect(results['palmeiras']).toMatchObject({
      status: 'verified',
      apiId: 121,
      participantId: palmeiras!.id,
    });
    expect(results['corinthians']).toMatchObject({
      status: 'verified',
      apiId: 131,
      participantId: corinthians!.id,
    });
    expect(results['santa-cruz']).toMatchObject({ status: 'resolved', apiId: 753 });
    expect(results['brazil-nt']).toMatchObject({ status: 'resolved', apiId: 6 });
    expect(results['athletic-club']).toMatchObject({ status: 'resolved', apiId: 531 });
    // Flamengo tem team_id 127 no YAML, mas o /teams do Brasil (fixture) não tem esse ID
    expect(results['flamengo']).toMatchObject({ status: 'conflict', apiId: null });

    // participantes surgiram depois do seed: o resolvedor liga os perfis e mapeia o Corinthians
    expect(await applyResolutionsToDb(db, Object.values(results))).toEqual({
      providerMap: 1,
      teamProfiles: 2,
    });
    expect(await applyResolutionsToDb(db, Object.values(results))).toEqual({
      providerMap: 0,
      teamProfiles: 0,
    });
    const [row] = await db.select().from(teamProfile).where(eq(teamProfile.slug, 'palmeiras'));
    expect(row!.participantId).toBe(palmeiras!.id);
    const mapped = await db.select().from(providerMap).where(eq(providerMap.entityId, corinthians!.id));
    expect(mapped).toMatchObject([{ provider: 'api-sports', providerId: '131', entityType: 'participant' }]);
  });
});
