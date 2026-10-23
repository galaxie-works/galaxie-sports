import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { participant, venue, type Database } from '@galaxie/db';
import { DEFAULT_KNOWLEDGE_DIR, loadKnowledge } from '@galaxie/knowledge';
import { findKnowledgeGaps } from '../src/curator/gaps.js';
import { runCurator, writeDryRun } from '../src/curator/run.js';
import { FakeLlmClient } from '../src/testing/fake-llm.js';
import { disposableDb, idOf, ingest, seedCatalog, syntheticFixture } from './helpers.js';

const env = disposableDb();
let db: Database;
let out: string;
const SERIE_A = { id: 71, name: 'Serie A', country: 'Brazil', season: 2026 };
const NOW = new Date('2026-10-21T12:00:00Z');

beforeAll(async () => {
  db = await env.setup();
  await seedCatalog(db, [
    { slug: 'brasileirao-serie-a', name: 'Serie A', leagueId: 71, tier: 1, type: 'league', country: 'BR' },
  ]);
  await ingest(
    db,
    [
      syntheticFixture({
        id: 9201,
        league: { ...SERIE_A, round: 'Regular Season - 31' },
        date: '2026-10-25T19:00:00Z',
        home: { id: 121, name: 'Palmeiras' },
        away: { id: 99901, name: 'Exemplo FC' },
        status: 'NS',
      }),
    ],
    NOW,
  );
  // o provedor passou a informar outro nome para o estádio do Palmeiras
  const [v] = await db.insert(venue).values({ name: 'Arena Nova Exemplo', city: 'São Paulo' }).returning();
  await db
    .update(participant)
    .set({ homeVenueId: v!.id, countryCode: 'BR' })
    .where(eq(participant.id, await idOf(db, 'participant', 121)));
  await db
    .update(participant)
    .set({ countryCode: 'BR' })
    .where(eq(participant.id, await idOf(db, 'participant', 99901)));
  out = await mkdtemp(join(tmpdir(), 'galaxie-curator-test-'));
}, 120_000);

afterAll(async () => {
  await env.teardown();
  if (out) await rm(out, { recursive: true, force: true });
});

describe('Agente Curador (integração, dry-run)', () => {
  it('detecta clube ausente e estádio divergente a partir do core', async () => {
    const kb = await loadKnowledge();
    const gaps = await findKnowledgeGaps(db, kb, { now: NOW });
    expect(gaps.map((g) => g.kind)).toEqual(['missing_team', 'venue_mismatch']);
    expect(gaps[0]).toMatchObject({
      name: 'Exemplo FC',
      countryCode: 'BR',
      countryName: 'Brazil',
      apiSportsTeamId: 99901,
    });
    expect(gaps[1]).toMatchObject({
      slug: 'palmeiras',
      yamlStadium: 'Nubank Parque',
      providerVenue: 'Arena Nova Exemplo',
    });
  });

  it('pesquisa, valida e grava só a saída dry-run (data/knowledge intacto)', async () => {
    const kb = await loadKnowledge();
    const before = readFileSync(join(DEFAULT_KNOWLEDGE_DIR, 'football/teams/br.yaml'), 'utf8');
    const llm = new FakeLlmClient((req) =>
      req.schemaName === 'team_profile_proposal'
        ? {
            found: true,
            names: { official: 'Exemplo Futebol Clube', short: 'Exemplo FC', abbreviation: 'EXE' },
            founded: null,
            city: 'Cidade Exemplo',
            region: null,
            colors: ['azul'],
            nicknames: [],
            fans: { demonym: null },
            mascot: null,
            stadium: null,
            identity: [],
            sources: ['https://exemplofc.test/'],
          }
        : {
            current_name: 'Arena Nova Exemplo',
            previous_names: ['Nubank Parque'],
            sources: ['https://x.test/estadio'],
            confident: true,
          },
    );
    const result = await runCurator(db, kb, { llm, now: NOW });
    expect(result.proposals.map((p) => [p.kind, p.status])).toEqual([
      ['add_team', 'accepted'],
      // Palmeiras é approved: a troca de estádio fica só no relatório, para a revisão editorial
      ['update_stadium', 'needs_review'],
    ]);
    expect(result.changes.validation).toEqual([]);
    const files = await writeDryRun(out, result);
    expect(files.map((f) => f.slice(out.length + 1).replaceAll('\\', '/')).sort()).toEqual([
      'changes.diff',
      'files/football/teams/br.yaml',
      'proposals.json',
      'report.md',
    ]);
    const diff = readFileSync(join(out, 'changes.diff'), 'utf8');
    expect(diff).toContain('+  - slug: exemplo-fc');
    expect(diff).not.toContain('Arena Nova Exemplo');
    expect(diff).toMatch(/\+\s+review_status: draft/);
    expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('Revisão editorial obrigatória');
    // dry-run: o repositório não muda
    expect(readFileSync(join(DEFAULT_KNOWLEDGE_DIR, 'football/teams/br.yaml'), 'utf8')).toBe(before);
    expect(existsSync(join(out, 'files/football/teams/br.yaml'))).toBe(true);
  });

  it('sem LLM: só relata as lacunas', async () => {
    const kb = await loadKnowledge();
    const result = await runCurator(db, kb, { llm: null, now: NOW });
    expect(result.proposals).toEqual([]);
    expect(result.changes.files.size).toBe(0);
    expect(result.report).toContain('sem LLM: só detecção de lacunas');
  });
});
