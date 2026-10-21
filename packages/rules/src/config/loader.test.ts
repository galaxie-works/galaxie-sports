import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { knockoutStageRules } from './parse.js';
import { defaultRulesDir, loadAllCompetitionRules, loadCompetitionRules, RulesConfigError } from './loader.js';

/** Competições que o issue #24/#28 exige configuradas. */
const REQUIRED = [
  'default',
  'brasileirao-serie-a',
  'premier-league',
  'laliga',
  'serie-a-italia',
  'bundesliga',
  'ligue-1',
  'argentina-liga-profesional',
  'conmebol-libertadores',
  'conmebol-sudamericana',
  'uefa-champions-league',
  'copa-do-brasil',
];

describe('config/rules — todos os YAML do repositório', () => {
  it('carregam, validam e têm slug igual ao nome do arquivo', async () => {
    const all = await loadAllCompetitionRules();
    for (const slug of REQUIRED) expect(all.has(slug), slug).toBe(true);
  });

  it('usam slugs do catálogo de competições (exceto default)', async () => {
    const catalog = parse(
      readFileSync(new URL('../../../../config/competitions/football.yaml', import.meta.url), 'utf8'),
    ) as { competitions: { slug: string }[] };
    const slugs = new Set(catalog.competitions.map((c) => c.slug));
    for (const slug of (await loadAllCompetitionRules()).keys()) {
      if (slug !== 'default') expect(slugs.has(slug), slug).toBe(true);
    }
  });

  it.each([2018, 2020, 2021, 2023, 2024, 2026])('continuam válidos com as exceções da temporada %i', async (season) => {
    const all = await loadAllCompetitionRules({ season });
    for (const rules of all.values()) {
      expect(rules.season).toBe(season);
      expect(rules.standings.tieBreakers.length).toBeGreaterThan(0);
      if (rules.league?.teams) {
        for (const z of rules.league.zones) expect(z.to).toBeLessThanOrEqual(rules.league.teams);
      }
    }
  });

  it('todo regulamento termina os desempates em sorteio (ordem determinística)', async () => {
    for (const rules of (await loadAllCompetitionRules()).values()) {
      expect(rules.standings.tieBreakers.at(-1)?.criterion, rules.slug).toBe('drawing_of_lots');
    }
  });
});

describe('regulamentos específicos', () => {
  it('Brasileirão: vitórias, saldo, gols pró, confronto direto (2 clubes), vermelhos, amarelos', async () => {
    const r = await loadCompetitionRules('brasileirao-serie-a');
    expect(r.standings.tieBreakers).toEqual([
      { criterion: 'wins' },
      { criterion: 'goal_difference' },
      { criterion: 'goals_for' },
      { criterion: 'h2h_points', maxTeams: 2 },
      { criterion: 'fewest_red_cards' },
      { criterion: 'fewest_yellow_cards' },
      { criterion: 'drawing_of_lots' },
    ]);
    expect(r.league).toMatchObject({ teams: 20, matchesPerTeam: 38, title: true });
    expect(r.league!.zones.find((z) => z.kind === 'relegation')).toMatchObject({ from: 17, to: 20 });
  });

  it('LaLiga: confronto direto antes do saldo geral, só com todos os jogos disputados', async () => {
    const r = await loadCompetitionRules('laliga');
    expect(r.standings.tieBreakers[0]).toEqual({ criterion: 'h2h_points', requireComplete: true });
    expect(r.standings.tieBreakers[1]).toEqual({ criterion: 'h2h_goal_difference', requireComplete: true });
    expect(r.standings.tieBreakers[2]!.criterion).toBe('goal_difference');
  });

  it.each([
    ['premier-league', ['goal_difference', 'goals_for', 'h2h_points']],
    ['serie-a-italia', ['h2h_points', 'h2h_goal_difference', 'goal_difference']],
    ['bundesliga', ['goal_difference', 'goals_for', 'h2h_points']],
    ['ligue-1', ['goal_difference', 'h2h_points', 'h2h_goal_difference']],
    ['conmebol-libertadores', ['goal_difference', 'goals_for', 'away_goals_for']],
    ['uefa-champions-league', ['goal_difference', 'goals_for', 'away_goals_for']],
  ])('%s começa por %j', async (slug, first) => {
    const r = await loadCompetitionRules(slug);
    expect(r.standings.tieBreakers.slice(0, first.length).map((t) => t.criterion)).toEqual(first);
  });

  it('Libertadores: sem gol fora desde 2022, pênaltis direto; final única com prorrogação', async () => {
    const r = await loadCompetitionRules('conmebol-libertadores', { season: 2024 });
    expect(r.knockout!.default).toMatchObject({ legs: 2, awayGoals: false, extraTime: false, penalties: true });
    expect(knockoutStageRules(r, 'final')).toMatchObject({ legs: 1, extraTime: true, decidesTitle: true });
    expect(r.league!.zones.map((z) => z.id)).toEqual(['round_of_16', 'sudamericana_knockout_playoff', 'elimination']);
  });

  it('Libertadores 2021: gol fora no mata-mata, não na final', async () => {
    const r = await loadCompetitionRules('conmebol-libertadores', { season: 2021 });
    expect(r.knockout!.default.awayGoals).toBe(true);
    expect(knockoutStageRules(r, 'final')).toMatchObject({ legs: 1, awayGoals: false });
  });

  it('Libertadores 2017: final em ida e volta com prorrogação', async () => {
    const r = await loadCompetitionRules('conmebol-libertadores', { season: 2017 });
    expect(knockoutStageRules(r, 'final')).toMatchObject({ legs: 2, awayGoals: false, extraTime: true });
  });

  it('Champions: fase de liga de 36 (2024+) e fase de grupos com confronto direto (até 2023)', async () => {
    const now = await loadCompetitionRules('uefa-champions-league', { season: 2024 });
    expect(now.format).toBe('league_phase');
    expect(now.league).toMatchObject({ teams: 36, matchesPerTeam: 8, meetingsPerPair: 1, title: false });
    expect(now.league!.zones.map((z) => [z.id, z.from, z.to])).toEqual([
      ['round_of_16', 1, 8],
      ['knockout_playoff', 9, 24],
      ['elimination', 25, 36],
    ]);
    const old = await loadCompetitionRules('uefa-champions-league', { season: 2022 });
    expect(old.format).toBe('groups_and_knockout');
    expect(old.standings.tieBreakers[0]!.criterion).toBe('h2h_points');
    expect(old.league).toMatchObject({ teams: 4, matchesPerTeam: 6 });
    const older = await loadCompetitionRules('uefa-champions-league', { season: 2019 });
    expect(older.knockout!.default).toMatchObject({ awayGoals: true, awayGoalsInExtraTime: true });
    expect(older.standings.tieBreakers.map((t) => t.criterion)).toContain('h2h_away_goals');
  });

  it('Copa do Brasil: 1ª fase com vantagem do empate para o visitante', async () => {
    const r = await loadCompetitionRules('copa-do-brasil');
    expect(knockoutStageRules(r, 'first_round')).toMatchObject({ legs: 1, drawAdvantage: 'away' });
    expect(knockoutStageRules(r, 'final')).toMatchObject({ legs: 2, decidesTitle: true });
  });
});

describe('loadCompetitionRules — fallback', () => {
  it('sem arquivo próprio, falha ou usa o default mantendo o slug', async () => {
    await expect(loadCompetitionRules('liga-inexistente')).rejects.toThrow(RulesConfigError);
    const r = await loadCompetitionRules('liga-inexistente', { fallbackToDefault: true });
    expect(r.slug).toBe('liga-inexistente');
    expect(r.standings.tieBreakers[0]!.criterion).toBe('goal_difference');
  });

  it('acusa slug interno diferente do nome do arquivo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rules-'));
    try {
      await writeFile(join(dir, 'a.yaml'), 'slug: b\n');
      await expect(loadAllCompetitionRules({ dir })).rejects.toThrow(/difere do nome do arquivo/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('defaultRulesDir aponta para config/rules', () => {
    expect(defaultRulesDir().replace(/\\/g, '/')).toMatch(/config\/rules\/?$/);
  });
});
