import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { event, venue, type Database } from '@galaxie/db';
import { readEventContext } from '../src/context/store.js';
import { languageOf } from '../src/guardrails/index.js';
import { onEventFinished } from '../src/recap/run.js';
import { FakeLlmClient } from '../src/testing/fake-llm.js';
import { requestedLocales } from '../src/testing/samples.js';
import { disposableDb, idOf, ingest, seedCatalog, syntheticFixture } from './helpers.js';

const env = disposableDb();
let db: Database;
let secondLeg: string;
let cupFirstRound: string;

const LIB = { id: 13, name: 'CONMEBOL Libertadores', country: 'World', season: 2026 };
const PAL = { id: 121, name: 'Palmeiras' };
const FLU = { id: 124, name: 'Fluminense' };
const CDB = { id: 73, name: 'Copa Do Brasil', country: 'Brazil', season: 2026 };
const MANDANTE = { id: 7301, name: 'Mandante FC' };
const VISITANTE = { id: 7302, name: 'Visitante EC' };

/** Volta: Palmeiras 0 × 1 Fluminense, 5 × 3 nos pênaltis, no estádio que o fornecedor ainda chama de Allianz Parque. */
function secondLegFixture() {
  const f = syntheticFixture({
    id: 9302,
    league: { ...LIB, round: 'Semi-finals' },
    date: '2026-10-21T00:30:00Z',
    home: PAL,
    away: FLU,
    status: 'FT',
    goals: { home: 0, away: 1 },
  });
  f.fixture.status = { long: 'Match Finished', short: 'PEN', elapsed: 90, extra: null };
  f.fixture.venue = { id: 258, name: 'Allianz Parque', city: 'São Paulo, São Paulo' };
  f.score.penalty = { home: 5, away: 3 };
  return f;
}

const GOOD: Record<'pt' | 'es', string[]> = {
  pt: [
    'O Palmeiras se classificou para a final: o agregado ficou 2 a 2 e venceu nos pênaltis por 5 a 3.',
    'No Nubank Parque, perdeu por 0 a 1 para o Fluminense; na ida, tinha vencido por 2 a 1.',
  ],
  es: [
    'Palmeiras se clasificó a la final: la serie quedó 2-2 en el global y ganó 5-3 en los penales.',
    'En el Nubank Parque perdió 0-1 ante Fluminense.',
  ],
};

beforeAll(async () => {
  db = await env.setup();
  await seedCatalog(db, [
    {
      slug: 'conmebol-libertadores',
      name: 'CONMEBOL Libertadores',
      leagueId: 13,
      tier: 1,
      type: 'cup',
      country: 'WORLD',
    },
    { slug: 'copa-do-brasil', name: 'Copa do Brasil', leagueId: 73, tier: 1, type: 'cup', country: 'BR' },
  ]);
  await ingest(
    db,
    [
      syntheticFixture({
        id: 9301,
        league: { ...LIB, round: 'Semi-finals' },
        date: '2026-10-14T00:30:00Z',
        home: FLU,
        away: PAL,
        status: 'FT',
        goals: { home: 1, away: 2 },
      }),
      secondLegFixture(),
      // Copa do Brasil, 1ª fase: jogo único, o visitante avança com o empate (draw_advantage: away)
      syntheticFixture({
        id: 7311,
        league: { ...CDB, round: '1st Round' },
        date: '2026-10-20T22:00:00Z',
        home: MANDANTE,
        away: VISITANTE,
        status: 'FT',
        goals: { home: 1, away: 1 },
      }),
    ],
    new Date('2026-10-21T03:00:00Z'),
  );
  secondLeg = await idOf(db, 'event', 9302);
  cupFirstRound = await idOf(db, 'event', 7311);
  // reconciliação da base semântica (pnpm db:seed:semantic) já ligou o estádio ao nome curado
  const [ev] = await db.select({ venueId: event.venueId }).from(event).where(eq(event.id, secondLeg));
  await db
    .update(venue)
    .set({
      curated: {
        name: 'Nubank Parque',
        city: 'São Paulo',
        nicknames: ['Arena'],
        former_names: [{ name: 'Allianz Parque', until: '2026-05-03' }],
        team_slugs: ['palmeiras'],
        matched_by: 'provider_id',
      },
    })
    .where(eq(venue.id, ev!.venueId!));
}, 120_000);

afterAll(async () => {
  await env.teardown();
});

describe('Resumo de mata-mata (integração)', () => {
  it('fatos com agregado, classificado, fase seguinte e nome curado do estádio', async () => {
    const llm = new FakeLlmClient((req: { messages: { content: string }[] }) => ({
      texts: requestedLocales(req.messages[0]!.content).map((locale) => ({
        locale,
        sentences: GOOD[languageOf(locale)],
      })),
    }));
    const report = await onEventFinished(db, secondLeg, llm, { force: true, locales: ['pt-BR', 'es-AR'] });
    expect(report.items[0]).toMatchObject({ action: 'generated', origins: { llm: 2, fallback: 0 } });
    const facts = JSON.parse(llm.requests[0]!.messages[0]!.content.split('\n').slice(2).join('\n')) as Record<
      string,
      unknown
    >;
    expect(facts['tie']).toEqual({
      legs: 2,
      leg: 2,
      first_leg: { home: 2, away: 1 },
      aggregate: { home: 2, away: 2 },
      winner: 'home',
      decided_by: 'penalties',
      outcome: 'advances',
      next_stage: 'final',
    });
    expect((facts['match'] as { venue: string }).venue).toBe('Nubank Parque');
    expect(llm.requests[0]!.messages.map((m) => m.content).join('\n')).not.toContain('Allianz');
    const [pt] = await readEventContext(db, secondLeg, { kinds: ['recap'], locales: ['pt-BR'] });
    expect(pt!.content.text).toBe(GOOD.pt.join(' '));
  });

  it('sem LLM, o texto determinístico abre dizendo quem foi à final', async () => {
    const down = new FakeLlmClient(() => new Error('fora do ar'));
    await onEventFinished(db, secondLeg, down, { force: true, locales: ['pt-BR', 'es-AR'] });
    const rows = await readEventContext(db, secondLeg, { kinds: ['recap'], locales: ['pt-BR', 'es-AR'] });
    const by = new Map(rows.map((r) => [r.locale, r.content.text]));
    expect(by.get('pt-BR')).toBe(
      'Palmeiras se classificou para a final; o agregado ficou 2 x 2 e a vaga foi decidida nos pênaltis. ' +
        'Fim de jogo: Palmeiras 0 x 1 Fluminense; nos pênaltis, Palmeiras venceu por 5 x 3.',
    );
    expect(by.get('es-AR')).toMatch(/^Palmeiras se clasificó a la final; la serie quedó 2-2 en el global/);
  });

  it('fase numerada de copa ("1st Round"): o regulamento da fase vale e o empate classifica o visitante', async () => {
    const down = new FakeLlmClient(() => new Error('fora do ar'));
    await onEventFinished(db, cupFirstRound, down, { force: true, locales: ['pt-BR', 'es-AR'] });
    const facts = JSON.parse(
      down.requests[0]!.messages[0]!.content.split('\n').slice(2).join('\n'),
    ) as Record<string, unknown>;
    expect(facts['tie']).toEqual({
      legs: 1,
      leg: null,
      first_leg: null,
      aggregate: null,
      winner: 'away',
      decided_by: 'draw_advantage',
      outcome: 'advances',
      next_stage: 'next_round',
    });
    const rows = await readEventContext(db, cupFirstRound, { kinds: ['recap'], locales: ['pt-BR', 'es-AR'] });
    const by = new Map(rows.map((r) => [r.locale, r.content]));
    expect(by.get('pt-BR')!.text).toMatch(
      /^Visitante EC se classificou para a próxima fase; o empate bastava pelo regulamento\. Fim de jogo: Mandante FC 1 x 1 Visitante EC/,
    );
    expect(by.get('es-AR')!.text).toMatch(
      /^Visitante EC se clasificó a la siguiente fase; el empate le alcanzaba/,
    );
    expect(by.get('pt-BR')!.fallbackViolations).toBeUndefined();
  });
});
