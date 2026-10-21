import { readFileSync } from 'node:fs';
import { parseCompetitionRules } from './config/parse.js';
import type { CompetitionRules } from './config/types.js';
import type { MatchResult } from './standings/types.js';

/** PRNG determinístico (mulberry32) para testes de propriedade reprodutíveis. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rand: () => number, max: number): number {
  return Math.floor(rand() * (max + 1));
}

/** Placar aleatório com distribuição parecida com a do futebol (muitos 0, 1 e 2 gols). */
export function randomGoals(rand: () => number): number {
  const r = rand();
  return r < 0.25 ? 0 : r < 0.6 ? 1 : r < 0.82 ? 2 : r < 0.94 ? 3 : r < 0.98 ? 4 : 5;
}

/** Turno e returno entre `teams`, com placares aleatórios e datas crescentes. */
export function randomDoubleRoundRobin(
  teams: readonly string[],
  rand: () => number,
  group = '',
): MatchResult[] {
  const out: MatchResult[] = [];
  let day = 0;
  for (const home of teams) {
    for (const away of teams) {
      if (home === away) continue;
      day++;
      const m: MatchResult = {
        id: `${group}${home}-${away}`,
        homeId: home,
        awayId: away,
        homeGoals: randomGoals(rand),
        awayGoals: randomGoals(rand),
        playedAt: new Date(Date.UTC(2024, 0, 1) + day * 3_600_000).toISOString(),
      };
      if (group) m.group = group;
      out.push(m);
    }
  }
  return out;
}

/** Calendário de turno e returno pelo método do círculo: cada time joga uma vez por rodada. */
export function doubleRoundRobinRounds(teams: readonly string[]): { homeId: string; awayId: string }[][] {
  const list = teams.length % 2 === 0 ? [...teams] : [...teams, '__folga__'];
  const n = list.length;
  const first: { homeId: string; awayId: string }[][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: { homeId: string; awayId: string }[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i]!;
      const b = list[n - 1 - i]!;
      if (a === '__folga__' || b === '__folga__') continue;
      round.push(r % 2 === 0 ? { homeId: a, awayId: b } : { homeId: b, awayId: a });
    }
    first.push(round);
    list.splice(1, 0, list.pop()!);
  }
  return [...first, ...first.map((round) => round.map((f) => ({ homeId: f.awayId, awayId: f.homeId })))];
}

/** Atalho de partida: `match('A', 'B', 2, 1)`. */
export function match(
  homeId: string,
  awayId: string,
  homeGoals: number,
  awayGoals: number,
  extra: Partial<MatchResult> = {},
): MatchResult {
  return { homeId, awayId, homeGoals, awayGoals, ...extra };
}

/** Regulamento mínimo a partir de um objeto no formato do YAML. */
export function rulesFrom(raw: Record<string, unknown>, season?: number): CompetitionRules {
  return parseCompetitionRules({ slug: 'teste', ...raw }, season === undefined ? {} : { season });
}

export interface Fixture2024 {
  id: number;
  round: number;
  date: string;
  home: number;
  away: number;
  goals: [number, number];
}

export interface Season2024 {
  teams: Record<string, string>;
  fixtures: Fixture2024[];
}

export function loadSerieA2024(): Season2024 {
  const url = new URL('../fixtures/brasileirao-serie-a-2024.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Season2024;
}

export function toMatch(f: Fixture2024): MatchResult {
  return {
    id: String(f.id),
    homeId: String(f.home),
    awayId: String(f.away),
    homeGoals: f.goals[0],
    awayGoals: f.goals[1],
    playedAt: `${f.date}:00Z`,
    round: f.round,
  };
}
