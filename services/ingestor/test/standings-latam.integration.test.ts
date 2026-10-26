/**
 * Tabelas da América Latina pelo regulamento (`tables:` em config/rules): Argentina com zonas do Apertura e
 * do Clausura + anual + promedios, Liga MX com a Liguilla fora da tabela, Brasileirão de pontos corridos,
 * fase de grupos da Libertadores e Uruguai com Apertura/Intermedio/Clausura/anual. Nomes de grupo e rodada:
 * os vistos na API (Argentina, Libertadores, Brasileirão) ou o padrão da api-sports (os demais).
 * Também o resíduo do recálculo antigo (tabela no grupo sem nome ao lado dos grupos do fornecedor).
 */
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  competition,
  event,
  eventParticipant,
  participant,
  season,
  sport,
  stage,
  standing,
  type Database,
} from '@galaxie/db';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultRulesDir } from '@galaxie/rules/config';
import { computeEventStakes } from '@galaxie/rules/db';
import { cleanupEmptyGroupResidue } from '../src/standings/empty-group-cleanup.js';
import { recomputeSeasonStandings } from '../src/standings/recompute.js';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;
const OLD = new Date('2026-01-01T00:00:00Z');

beforeAll(async () => {
  db = await disposable.setup();
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
});
afterAll(() => disposable.teardown());

interface World {
  seasonId: string;
  team: (name: string) => string;
  /** Jogo encerrado com o placar; `null`: ainda por jogar. */
  play: (
    round: string,
    home: string,
    away: string,
    score: [number, number] | null,
    kind?: string,
  ) => Promise<{ eventId: string; stageId: string; startsAt: Date }>;
  provider: (group: string, teams: readonly string[], source?: string) => Promise<void>;
  table: () => Promise<
    { group: string; team: string; played: number; points: number; source: string; zone: string | null }[]
  >;
}

async function world(slug: string, year: number, teams: readonly string[]): Promise<World> {
  // a mesma competição em temporadas diferentes
  await db
    .insert(competition)
    .values({ sport: 'football', slug, name: slug, type: 'league' })
    .onConflictDoNothing();
  const [comp] = await db.select().from(competition).where(eq(competition.slug, slug));
  const [s] = await db
    .insert(season)
    .values({ competitionId: comp!.id, label: String(year), year, current: true })
    .returning();
  const ids = new Map<string, string>();
  const names = new Map<string, string>();
  for (const name of teams) {
    const [p] = await db.insert(participant).values({ sport: 'football', kind: 'club', name }).returning();
    ids.set(name, p!.id);
    names.set(p!.id, name);
  }
  const stages = new Map<string, string>();
  let day = 0;
  return {
    seasonId: s!.id,
    team: (n) => ids.get(n)!,
    async play(round, home, away, score, kind = 'regular') {
      let stageId = stages.get(round);
      if (!stageId) {
        const [st] = await db
          .insert(stage)
          .values({ seasonId: s!.id, kind, name: { 'pt-BR': round }, providerLabel: round })
          .returning();
        stageId = st!.id;
        stages.set(round, stageId);
      }
      const startsAt = new Date(Date.UTC(year, 1, 1 + day++, 20));
      const [e] = await db
        .insert(event)
        .values({
          sport: 'football',
          seasonId: s!.id,
          stageId,
          startsAt,
          endsAtExpected: new Date(startsAt.getTime() + 7_200_000),
          status: score ? 'finished' : 'scheduled',
          score: score ? { home: score[0], away: score[1] } : null,
        })
        .returning();
      await db.insert(eventParticipant).values([
        { eventId: e!.id, participantId: ids.get(home)!, side: 'home' },
        { eventId: e!.id, participantId: ids.get(away)!, side: 'away' },
      ]);
      return { eventId: e!.id, stageId, startsAt };
    },
    async provider(group, list, source = 'provider') {
      await db.insert(standing).values(
        list.map((t, i) => ({
          seasonId: s!.id,
          group,
          participantId: ids.get(t)!,
          rank: i + 1,
          points: 50 - i,
          played: 30,
          source,
          updatedAt: OLD,
        })),
      );
    },
    async table() {
      const rows = await db
        .select()
        .from(standing)
        .where(eq(standing.seasonId, s!.id))
        .orderBy(asc(standing.group), asc(standing.rank));
      return rows.map((r) => ({
        group: r.group,
        team: names.get(r.participantId)!,
        played: r.played,
        points: r.points,
        source: r.source,
        zone: r.description,
      }));
    },
  };
}

const ZONE_A = ['A1', 'A2', 'A3', 'A4'];
const ZONE_B = ['B1', 'B2', 'B3', 'B4'];

describe('Argentina (2026): zonas do Apertura e do Clausura, anual e promedios', () => {
  let w: World;
  beforeAll(async () => {
    w = await world('argentina-liga-profesional', 2026, [...ZONE_A, ...ZONE_B]);
    // tabelas do fornecedor (nomes vistos na API) e o que o recálculo antigo deixou no grupo sem nome
    await w.provider('Apertura - Group A', ZONE_A);
    await w.provider('Apertura - Group B', ZONE_B);
    await w.provider('Clausura - Group A', ZONE_A);
    await w.provider('Clausura - Group B', ZONE_B);
    await w.provider('Promedios', [...ZONE_A, ...ZONE_B]);
    await w.provider('', [...ZONE_A, ...ZONE_B], 'computed');
    await w.play('Apertura - 1', 'A1', 'A2', [2, 0]);
    await w.play('Apertura - 1', 'A3', 'A4', [1, 1]);
    await w.play('Apertura - 1', 'B1', 'B2', [1, 0]);
    await w.play('Apertura - 1', 'B3', 'B4', [0, 0]);
    // fecha interzonal: conta na tabela de cada zona
    await w.play('Apertura - 2', 'A1', 'B1', [0, 1]);
    // mata-mata do Apertura: fora de qualquer tabela
    await w.play('Apertura - Round of 16', 'A1', 'A3', [5, 0]);
    await w.play('Clausura - 1', 'A2', 'A1', [3, 0]);
  });

  it('cada fase com as suas rodadas e zonas; a anual soma as fases; promedios ficam do fornecedor', async () => {
    const report = await recomputeSeasonStandings(db, w.seasonId, { publish: false });
    expect(report.outcome).toBe('written');
    expect(report.skipped).toBeUndefined();
    const t = await w.table();
    const row = (group: string, team: string) => t.find((r) => r.group === group && r.team === team);
    // A1: vitória sobre A2 e derrota no interzonal; o 5 a 0 do mata-mata não entra
    expect(row('Apertura - Group A', 'A1')).toMatchObject({
      played: 2,
      points: 3,
      source: 'computed',
      zone: 'playoffs',
    });
    expect(row('Apertura - Group B', 'B1')).toMatchObject({ played: 2, points: 6, source: 'computed' });
    // a zona A não ganha o B1 (ele entrou só pelo interzonal)
    expect(
      t
        .filter((r) => r.group === 'Apertura - Group A')
        .map((r) => r.team)
        .sort(),
    ).toEqual(ZONE_A);
    expect(row('Clausura - Group A', 'A2')).toMatchObject({ played: 1, points: 3, source: 'computed' });
    expect(row('Tabla Anual', 'A1')).toMatchObject({ played: 3, points: 3, source: 'computed' });
    expect(t.filter((r) => r.group === 'Tabla Anual')).toHaveLength(8);
    expect(
      t.filter((r) => r.group === 'Promedios').every((r) => r.source === 'provider' && r.played === 30),
    ).toBe(true);
    // o resíduo no grupo sem nome sai
    expect(t.filter((r) => r.group === '')).toHaveLength(0);
  });

  it('stakes do jogo do Clausura usam a zona do Clausura (não a anual nem o Apertura)', async () => {
    const next = await w.play('Clausura - 2', 'A1', 'A3', null);
    const stakes = await computeEventStakes(db, {
      id: next.eventId,
      sport: 'football',
      startsAt: next.startsAt,
      competition: { slug: 'argentina-liga-profesional' },
      season: { id: w.seasonId, year: 2026 },
      stage: { id: next.stageId, kind: 'regular' },
      home: { id: w.team('A1') },
      away: { id: w.team('A3') },
    });
    // a tabela escolhida é a zona do Clausura (4 times aqui), conferida contra a matemática da fase (zonas de
    // 15); sem as fases, valeria a de mais jogos (a anual, 8 de 30)
    expect(stakes).toMatchObject({ stakes: [], reason: 'tabela incompleta (4 de 15 times)' });
  });

  it('idempotente: recalcular de novo não muda nada', async () => {
    const before = await w.table();
    await w.play('Clausura - 1', 'B2', 'B1', [0, 0]);
    await recomputeSeasonStandings(db, w.seasonId, { publish: false });
    const after = await w.table();
    expect(after.length).toBe(before.length);
    await recomputeSeasonStandings(db, w.seasonId, { publish: false });
    expect(await w.table()).toEqual(after);
  });
});

describe('Argentina: stakes de jogo encerrado da zona depois da fecha interzonal', () => {
  it('a tabela de antes desfaz o interzonal posterior só do lado da zona', async () => {
    // o regulamento real com zonas de 4 (o de produção pede 15 por zona para ter stakes)
    const dir = await mkdtemp(join(tmpdir(), 'rules-'));
    const yaml = (await readFile(join(defaultRulesDir(), 'argentina-liga-profesional.yaml'), 'utf8'))
      .replaceAll('teams: 15', 'teams: 4')
      .replaceAll('matches_per_team: 16', 'matches_per_team: 6')
      .replaceAll('from: 1, to: 8', 'from: 1, to: 2');
    await writeFile(join(dir, 'argentina-liga-profesional.yaml'), yaml);
    const X = ['X1', 'X2', 'X3', 'X4'];
    const Y = ['Y1', 'Y2', 'Y3', 'Y4'];
    const w = await world('argentina-liga-profesional', 2027, [...X, ...Y]);
    await w.provider('Apertura - Group A', X);
    await w.provider('Apertura - Group B', Y);
    await w.play('Apertura - 1', 'X1', 'X2', [2, 0]);
    await w.play('Apertura - 1', 'X3', 'X4', [1, 1]);
    await w.play('Apertura - 1', 'Y1', 'Y2', [1, 0]);
    await w.play('Apertura - 1', 'Y3', 'Y4', [0, 0]);
    // fecha interzonal antes do jogo
    await w.play('Apertura - 2', 'X1', 'Y1', [0, 1]);
    await w.play('Apertura - 2', 'X2', 'Y2', [1, 1]);
    await w.play('Apertura - 2', 'X3', 'Y3', [2, 0]);
    await w.play('Apertura - 2', 'X4', 'Y4', [0, 0]);
    const target = await w.play('Apertura - 3', 'X1', 'X3', [1, 0]);
    await w.play('Apertura - 3', 'X2', 'X4', [0, 0]);
    // e um interzonal depois (outra rodada), que a tabela atual já soma
    await w.play('Apertura - 4', 'X3', 'Y2', [3, 0]);
    expect((await recomputeSeasonStandings(db, w.seasonId, { publish: false })).outcome).toBe('written');
    const ref = {
      id: target.eventId,
      sport: 'football',
      startsAt: target.startsAt,
      status: 'finished',
      score: { home: 1, away: 0 },
      competition: { slug: 'argentina-liga-profesional' },
      season: { id: w.seasonId, year: 2027 },
      stage: { id: target.stageId, kind: 'regular' },
      home: { id: w.team('X1') },
      away: { id: w.team('X3') },
    } as const;
    const stakes = await computeEventStakes(db, ref, { rulesDir: dir });
    // antes da correção: "motor de regras recusou a entrada: A tabela atual (…) não bate com os resultados"
    expect(stakes.reason).toBeUndefined();
    expect(stakes.league?.group).toBe('Apertura - Group A');
    // antes do jogo: X1 com 3 pontos em 2 jogos (vitória + derrota no interzonal); X3 com 4 em 2 (o 3 × 0
    // interzonal posterior desfeito)
    expect(stakes.league?.rows).toEqual([
      expect.objectContaining({ teamId: w.team('X1'), played: 2, points: 3 }),
      expect.objectContaining({ teamId: w.team('X3'), played: 2, points: 4 }),
    ]);
  });
});

describe('Argentina: zona do fornecedor mais nova não segura a anual calculada', () => {
  it('a fase fresca do fornecedor prevalece; a anual (que o fornecedor não mandou) é calculada', async () => {
    const X = ['F1', 'F2'];
    const Y = ['G1', 'G2'];
    const w = await world('argentina-liga-profesional', 2028, [...X, ...Y]);
    await w.provider('Apertura - Group A', X);
    await w.provider('Apertura - Group B', Y);
    await w.provider('', [...X, ...Y], 'computed');
    await w.play('Apertura - 1', 'F1', 'F2', [1, 0]);
    await w.play('Apertura - 1', 'G1', 'G2', [2, 2]);
    // o fornecedor atualizou as zonas depois do último resultado
    await db
      .update(standing)
      .set({ updatedAt: new Date(Date.now() + 60_000) })
      .where(and(eq(standing.seasonId, w.seasonId), eq(standing.source, 'provider')));
    const report = await recomputeSeasonStandings(db, w.seasonId, { publish: false });
    // antes: "provider_fresh" para a temporada inteira, sem a anual e com o resíduo sem nome
    expect(report).toMatchObject({ outcome: 'written', fresh: ['apertura'] });
    const t = await w.table();
    expect(t.filter((r) => r.group.startsWith('Apertura')).every((r) => r.source === 'provider')).toBe(true);
    expect(t.filter((r) => r.group === 'Tabla Anual').map((r) => [r.team, r.played, r.points])).toEqual([
      ['F1', 1, 3],
      ['G2', 1, 1], // empate com o G1 desfeito pelos gols como visitante
      ['G1', 1, 1],
      ['F2', 1, 0],
    ]);
    expect(t.filter((r) => r.group === '')).toHaveLength(0);
    // com tudo do fornecedor mais novo, nada é regravado
    await db
      .update(standing)
      .set({ source: 'provider', updatedAt: new Date(Date.now() + 120_000) })
      .where(eq(standing.seasonId, w.seasonId));
    expect(await recomputeSeasonStandings(db, w.seasonId, { publish: false })).toMatchObject({
      outcome: 'provider_fresh',
      fresh: ['apertura', 'annual'],
    });
  });
});

describe('grupo renomeado pelo fornecedor', () => {
  it('as linhas do nome antigo saem; zona de outros times com a mesma idade fica', async () => {
    const w = await world('conmebol-libertadores', 2029, ['R1', 'R2', 'S1', 'S2']);
    // recálculo anterior gravou "Group A" e "Group B"; o fornecedor depois mandou o grupo A como "Group 1"
    await w.provider('Group A', ['R1', 'R2'], 'computed');
    await w.provider('Group B', ['S1', 'S2'], 'computed');
    await w.provider('Group 1', ['R1', 'R2']);
    await db
      .update(standing)
      .set({ updatedAt: new Date(OLD.getTime() + 86_400_000) })
      .where(and(eq(standing.seasonId, w.seasonId), eq(standing.group, 'Group 1')));
    await w.play('Group Stage - 1', 'R1', 'R2', [1, 0]);
    await w.play('Group Stage - 1', 'S1', 'S2', [0, 0]);
    const report = await recomputeSeasonStandings(db, w.seasonId, { publish: false });
    expect(report).toMatchObject({ outcome: 'written', superseded: ['Group A'] });
    const t = await w.table();
    // antes: "Group A" (calculado, nome velho) ficava ao lado de "Group 1" na API e no chaveamento
    expect(t.map((r) => [r.group, r.team, r.points, r.source])).toEqual([
      ['Group 1', 'R1', 3, 'computed'],
      ['Group 1', 'R2', 0, 'computed'],
      ['Group B', 'S1', 1, 'computed'],
      ['Group B', 'S2', 1, 'computed'],
    ]);
    // idempotente
    const again = await recomputeSeasonStandings(db, w.seasonId, { publish: false });
    expect(again.superseded).toBeUndefined();
    expect(await w.table()).toEqual(t);
  });
});

describe('Liga MX: Apertura e Clausura de tabela única, Liguilla fora', () => {
  it('sem tabela do fornecedor, grava "Apertura" e "Clausura" só com as rodadas numeradas', async () => {
    const w = await world('liga-mx', 2025, ['América', 'Chivas', 'Cruz Azul', 'Pumas']);
    await w.play('Apertura - 1', 'América', 'Chivas', [2, 1]);
    await w.play('Apertura - 1', 'Cruz Azul', 'Pumas', [0, 0]);
    await w.play('Apertura - Quarter-finals', 'América', 'Pumas', [4, 0]);
    await w.play('Clausura - 1', 'Chivas', 'América', [1, 0]);
    const report = await recomputeSeasonStandings(db, w.seasonId, { publish: false });
    expect(report).toMatchObject({ outcome: 'written', results: 3, rows: 6 });
    const t = await w.table();
    expect([...new Set(t.map((r) => r.group))]).toEqual(['Apertura', 'Clausura']);
    expect(t.find((r) => r.group === 'Apertura' && r.team === 'América')).toMatchObject({
      played: 1,
      points: 3,
      zone: 'liguilla',
    });
    expect(t.find((r) => r.group === 'Clausura' && r.team === 'Chivas')).toMatchObject({
      played: 1,
      points: 3,
    });
    // jogo da Liguilla (rodada sem número): sem stakes de pontos corridos
    const ko = await w.play('Apertura - Semi-finals', 'América', 'Chivas', null);
    const stakes = await computeEventStakes(db, {
      id: ko.eventId,
      sport: 'football',
      startsAt: ko.startsAt,
      competition: { slug: 'liga-mx' },
      season: { id: w.seasonId, year: 2025 },
      stage: { id: ko.stageId, kind: 'regular' },
      home: { id: w.team('América') },
      away: { id: w.team('Chivas') },
    });
    expect(stakes).toMatchObject({ stakes: [], reason: 'rodada fora das fases do regulamento' });
  });
});

describe('Liguilla (Liga MX): empate no agregado classifica o de melhor campanha', () => {
  it('stakes da volta das quartas: o mais bem colocado no Apertura passa com o empate', async () => {
    const w = await world('liga-mx', 2026, ['Toluca', 'Tigres', 'Monterrey', 'Atlas']);
    // Apertura: Toluca 1º, Atlas 4º (tabela recalculada a partir das rodadas)
    await w.play('Apertura - 1', 'Toluca', 'Tigres', [2, 0]);
    await w.play('Apertura - 1', 'Monterrey', 'Atlas', [1, 0]);
    await w.play('Apertura - 2', 'Toluca', 'Monterrey', [1, 0]);
    await w.play('Apertura - 2', 'Tigres', 'Atlas', [1, 0]);
    expect((await recomputeSeasonStandings(db, w.seasonId, { publish: false })).outcome).toBe('written');
    // quartas (ida e volta na mesma fase): ida 1 × 1 no Atlas, volta no Toluca
    await w.play('Apertura - Quarter-finals', 'Atlas', 'Toluca', [1, 1], 'quarter_final');
    const second = await w.play('Apertura - Quarter-finals', 'Toluca', 'Atlas', null, 'quarter_final');
    const stakes = await computeEventStakes(db, {
      id: second.eventId,
      sport: 'football',
      startsAt: second.startsAt,
      competition: { slug: 'liga-mx' },
      season: { id: w.seasonId, year: 2026 },
      stage: { id: second.stageId, kind: 'quarter_final' },
      home: { id: w.team('Toluca') },
      away: { id: w.team('Atlas') },
    });
    expect(stakes.knockout).toMatchObject({ legs: 2, leg: 2, seed: { home: 1, away: 4 } });
    const codes = stakes.stakes.map((s) => `${s.team}:${s.code}`);
    expect(codes).toContain('home:advances_with_draw');
    expect(codes).toContain('away:needs_win');
    expect(codes.some((c) => c.includes('penalties'))).toBe(false);
  });
});

describe('Brasileirão: pontos corridos no grupo do fornecedor', () => {
  it('com "Serie A" do fornecedor e resíduo sem nome: regrava "Serie A" e apaga o resíduo', async () => {
    const w = await world('brasileirao-serie-a', 2026, ['Palmeiras', 'Flamengo', 'Bahia', 'Ceará']);
    await w.provider('Serie A', ['Palmeiras', 'Flamengo', 'Bahia', 'Ceará']);
    await w.provider('', ['Palmeiras', 'Flamengo', 'Bahia', 'Ceará'], 'computed');
    await w.play('Regular Season - 1', 'Palmeiras', 'Flamengo', [1, 0]);
    await w.play('Regular Season - 1', 'Bahia', 'Ceará', [2, 2]);
    expect((await recomputeSeasonStandings(db, w.seasonId, { publish: false })).outcome).toBe('written');
    const t = await w.table();
    expect(new Set(t.map((r) => r.group))).toEqual(new Set(['Serie A']));
    expect(t.every((r) => r.source === 'computed' && r.played === 1)).toBe(true);
  });

  it('sem tabela do fornecedor: grava no grupo do regulamento ("Serie A"), nunca no sem nome', async () => {
    const w = await world('brasileirao-serie-a', 2027, ['Palmeiras', 'Flamengo']);
    await w.play('Regular Season - 1', 'Palmeiras', 'Flamengo', [1, 0]);
    await recomputeSeasonStandings(db, w.seasonId, { publish: false });
    expect([...new Set((await w.table()).map((r) => r.group))]).toEqual(['Serie A']);
  });
});

describe('Libertadores: fase de grupos', () => {
  it('grupos do fornecedor ("Group A", vistos na API); o mata-mata fica fora', async () => {
    const w = await world('conmebol-libertadores', 2026, ['P1', 'P2', 'Q1', 'Q2']);
    await w.provider('Group A', ['P1', 'P2']);
    await w.provider('Group B', ['Q1', 'Q2']);
    await w.play('Group Stage - 1', 'P1', 'P2', [1, 0]);
    await w.play('Group Stage - 1', 'Q1', 'Q2', [0, 2]);
    await w.play('Round of 16', 'P1', 'Q2', [3, 0]);
    expect(await recomputeSeasonStandings(db, w.seasonId, { publish: false })).toMatchObject({
      outcome: 'written',
      results: 2,
    });
    const t = await w.table();
    expect(t.map((r) => [r.group, r.team, r.played])).toEqual([
      ['Group A', 'P1', 1],
      ['Group A', 'P2', 1],
      ['Group B', 'Q2', 1],
      ['Group B', 'Q1', 1],
    ]);
  });

  it('rodada de grupo com rótulo pelo grupo ("Group A - 6") conta; rótulo desconhecido conta pelo grupo, com aviso', async () => {
    const w = await world('conmebol-libertadores', 2028, ['P1', 'P2', 'Q1', 'Q2']);
    await w.provider('Group A', ['P1', 'P2']);
    await w.provider('Group B', ['Q1', 'Q2']);
    await w.play('Group A - 6', 'P1', 'P2', [1, 0], 'group');
    // rótulo que o regulamento não conhece, numa fase de grupos (kind group): conta, mas vai para o relatório
    await w.play('Fase de Grupos - 1', 'Q1', 'Q2', [2, 0], 'group');
    const report = await recomputeSeasonStandings(db, w.seasonId, { publish: false });
    expect(report).toMatchObject({ outcome: 'written', results: 2, unmatchedRounds: ['Fase de Grupos - 1'] });
    const t = await w.table();
    expect(t.map((r) => [r.group, r.team, r.points])).toEqual([
      ['Group A', 'P1', 3],
      ['Group A', 'P2', 0],
      ['Group B', 'Q1', 3],
      ['Group B', 'Q2', 0],
    ]);
    // stakes do jogo seguinte nesse rótulo: a tabela do grupo dos dois (aqui 2 de 4 times), não "fora das fases"
    const next = await w.play('Fase de Grupos - 2', 'Q2', 'Q1', null, 'group');
    const stakes = await computeEventStakes(db, {
      id: next.eventId,
      sport: 'football',
      startsAt: next.startsAt,
      competition: { slug: 'conmebol-libertadores' },
      season: { id: w.seasonId, year: 2028 },
      stage: { id: next.stageId, kind: 'group' },
      home: { id: w.team('Q2') },
      away: { id: w.team('Q1') },
    });
    expect(stakes.reason).toBe('tabela incompleta (2 de 4 times)');
    // o mesmo com o estágio tipado como fase de liga (league_phase), que o recálculo também adota
    const lp = await w.play('Fase de Liga - 1', 'P2', 'P1', null, 'league_phase');
    const lpStakes = await computeEventStakes(db, {
      id: lp.eventId,
      sport: 'football',
      startsAt: lp.startsAt,
      competition: { slug: 'conmebol-libertadores' },
      season: { id: w.seasonId, year: 2028 },
      stage: { id: lp.stageId, kind: 'league_phase' },
      home: { id: w.team('P2') },
      away: { id: w.team('P1') },
    });
    expect(lpStakes.reason).toBe('tabela incompleta (2 de 4 times)');
  });

  it('sem os grupos do fornecedor: não inventa a divisão e registra o motivo', async () => {
    const w = await world('conmebol-libertadores', 2027, ['P1', 'P2']);
    await w.play('Group Stage - 1', 'P1', 'P2', [1, 0]);
    const report = await recomputeSeasonStandings(db, w.seasonId, { publish: false });
    expect(report.outcome).toBe('no_groups');
    expect(report.skipped).toEqual([
      { table: 'group_stage', reason: 'sem os grupos do fornecedor para montar a tabela' },
    ]);
    expect(await w.table()).toHaveLength(0);
  });
});

describe('Uruguai (2026): Apertura, Intermedio em séries, Clausura e anual', () => {
  it('cada torneio na sua tabela; a anual soma os três', async () => {
    const teams = ['Nacional', 'Peñarol', 'Defensor', 'Danubio'];
    const w = await world('uruguay-primera', 2026, teams);
    await w.provider('Intermedio - Group A', ['Nacional', 'Peñarol']);
    await w.provider('Intermedio - Group B', ['Defensor', 'Danubio']);
    await w.play('Apertura - 1', 'Nacional', 'Peñarol', [1, 0]);
    await w.play('Apertura - 1', 'Defensor', 'Danubio', [1, 1]);
    await w.play('Intermedio - 1', 'Peñarol', 'Nacional', [2, 0]);
    await w.play('Intermedio - 1', 'Danubio', 'Defensor', [0, 1]);
    await w.play('Clausura - 1', 'Nacional', 'Danubio', [3, 0]);
    const report = await recomputeSeasonStandings(db, w.seasonId, { publish: false });
    expect(report.outcome).toBe('written');
    const t = await w.table();
    expect([...new Set(t.map((r) => r.group))].sort()).toEqual([
      'Apertura',
      'Clausura',
      'Intermedio - Group A',
      'Intermedio - Group B',
      'Tabla Anual',
    ]);
    expect(t.find((r) => r.group === 'Tabla Anual' && r.team === 'Nacional')).toMatchObject({
      played: 3,
      points: 6,
    });
    expect(t.find((r) => r.group === 'Intermedio - Group A' && r.team === 'Peñarol')).toMatchObject({
      played: 1,
      points: 3,
    });
  });
});

describe('sem regulamento de tabelas (comportamento anterior, com registro)', () => {
  it('grupos do fornecedor + sem nome do fornecedor + resíduo calculado: regrava os grupos e apaga só o resíduo', async () => {
    // padrão de produção (Brasileirão Série D 2026): grupos com nome e sem nome do fornecedor, e o recálculo
    // antigo gravando o grupo sem nome por cima
    const w = await world('brasileirao-serie-d', 2026, ['D1', 'D2', 'E1', 'E2']);
    await w.provider('Group A1', ['D1', 'D2']);
    await w.provider('Group A2', ['E1', 'E2']);
    await w.provider('', ['D1', 'D2', 'E1', 'E2']);
    await db
      .update(standing)
      .set({ source: 'computed' })
      .where(
        and(
          eq(standing.seasonId, w.seasonId),
          eq(standing.group, ''),
          eq(standing.participantId, w.team('D1')),
        ),
      );
    await w.play('Regular Season - 1', 'D1', 'D2', [1, 0]);
    await w.play('Regular Season - 1', 'E1', 'E2', [0, 0]);
    expect((await recomputeSeasonStandings(db, w.seasonId, { publish: false })).outcome).toBe('written');
    const t = await w.table();
    expect(t.filter((r) => r.group === '').map((r) => r.source)).toEqual([
      'provider',
      'provider',
      'provider',
    ]);
    expect(t.filter((r) => r.group === 'Group A1').every((r) => r.source === 'computed')).toBe(true);
  });
});

describe('limpeza do resíduo no grupo sem nome', () => {
  it('lista, apaga só as linhas calculadas sem nome ao lado de grupos com nome e é idempotente', async () => {
    // temporada parada (time em dois grupos, sem regulamento de tabelas): o recálculo não regrava, o resíduo fica
    const w = await world('liga-sem-regulamento', 2026, ['X1', 'X2']);
    await w.provider('Regular Season', ['X1', 'X2']);
    await w.provider('Championship Round', ['X1', 'X2']);
    await w.provider('', ['X1', 'X2'], 'computed');
    // liga de grupo único calculada no grupo sem nome: não é resíduo
    const single = await world('liga-unica', 2026, ['Y1', 'Y2']);
    await single.provider('', ['Y1', 'Y2'], 'computed');

    const preview = await cleanupEmptyGroupResidue(db);
    const mine = preview.filter((p) => p.seasonId === w.seasonId);
    expect(mine).toEqual([
      { seasonId: w.seasonId, competition: 'liga-sem-regulamento', year: 2026, rows: 2 },
    ]);
    expect(preview.some((p) => p.seasonId === single.seasonId)).toBe(false);
    expect((await w.table()).filter((r) => r.group === '')).toHaveLength(2);

    await cleanupEmptyGroupResidue(db, { apply: true });
    expect((await w.table()).filter((r) => r.group === '')).toHaveLength(0);
    expect(await single.table()).toHaveLength(2);
    expect(await cleanupEmptyGroupResidue(db, { apply: true })).toEqual([]);
  });
});
