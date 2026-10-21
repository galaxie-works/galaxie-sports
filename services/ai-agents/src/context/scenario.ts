import { stakeText, zoneLabel, type Stake } from '@galaxie/rules';
import {
  FactSheetBuilder,
  guardrailSystemRules,
  languageOf,
  type AgentLocale,
  type FactSheet,
} from '../guardrails/index.js';
import { competitionName, eventNames, stageName, teamName, type EventCore } from './event-core.js';
import type { EventStakes } from './stakes.js';

/**
 * Agente Cenário pré-jogo (issue #57, docs/07 §2.3): os stakes são CALCULADOS pelo motor de
 * regras; o LLM só os REDIGE em 1–3 frases por locale, em tom informativo. Este módulo monta os
 * fatos enviados ao LLM, o `FactSheet` do validador e o texto determinístico de fallback
 * (rótulos fixos de `@galaxie/rules`).
 */

/** Versão do prompt/fatos: mudar invalida o cache (força regenerar). */
export const SCENARIO_PROMPT_VERSION = 'scenario@v1';

export interface ScenarioStakeFact {
  team: Stake['team'];
  code: string;
  /** Rótulo fixo por locale (significado exato do código). */
  labels: Partial<Record<AgentLocale, string>>;
}

/** Fatos enviados ao LLM (sem IDs internos). */
export interface ScenarioFacts {
  match: {
    competition: Partial<Record<AgentLocale, string>> | null;
    stage: Partial<Record<AgentLocale, string>> | null;
    round: number | null;
    venue: string | null;
    derby: string | null;
  };
  teams: {
    home: { names: Partial<Record<AgentLocale, string>> };
    away: { names: Partial<Record<AgentLocale, string>> };
  };
  knockout?: {
    legs: 1 | 2;
    leg: 1 | 2 | null;
    first_leg?: { home: string; away: string; home_goals: number; away_goals: number };
    aggregate_before?: { home: number; away: number };
    extra_time: boolean;
    penalties: boolean;
    decides_title: boolean;
  };
  league?: {
    teams_in_table: number;
    home: { rank: number; points: number; played: number; remaining: number | null };
    away: { rank: number; points: number; played: number; remaining: number | null };
  };
  stakes: ScenarioStakeFact[];
}

/** Número da rodada a partir do rótulo do fornecedor ("Regular Season - 30" → 30). */
export function roundNumber(core: EventCore): number | null {
  const m = /-\s*(\d+)\s*$/.exec(core.stage?.providerLabel ?? '');
  return m ? Number(m[1]) : null;
}

const perLocale = <T>(locales: readonly AgentLocale[], fn: (l: AgentLocale) => T | null) =>
  Object.fromEntries(
    locales.flatMap((l) => {
      const v = fn(l);
      return v === null ? [] : [[l, v]];
    }),
  ) as Partial<Record<AgentLocale, T>>;

export function buildScenarioFacts(
  core: EventCore,
  result: EventStakes,
  locales: readonly AgentLocale[],
): ScenarioFacts {
  const facts: ScenarioFacts = {
    match: {
      competition: core.competition ? perLocale(locales, (l) => competitionName(core, l)) : null,
      stage: core.stage ? perLocale(locales, (l) => stageName(core, l)) : null,
      round: roundNumber(core),
      venue: core.venue?.name ?? null,
      derby: core.derby?.name ?? null,
    },
    teams: {
      home: { names: perLocale(locales, (l) => teamName(core.home, l)) },
      away: { names: perLocale(locales, (l) => teamName(core.away, l)) },
    },
    stakes: result.stakes.map((s) => ({
      team: s.team,
      code: s.code,
      labels: perLocale(locales, (l) => stakeText(s, l)),
    })),
  };
  const ko = result.knockout;
  if (ko) {
    facts.knockout = {
      legs: ko.legs,
      leg: ko.leg,
      extra_time: ko.extraTime,
      penalties: ko.penalties,
      decides_title: ko.decidesTitle,
    };
    if (ko.firstLeg) {
      const name = (id: string) => (id === core.home.id ? core.home.name : core.away.name);
      facts.knockout.first_leg = {
        home: name(ko.firstLeg.homeTeamId),
        away: name(ko.firstLeg.awayTeamId),
        home_goals: ko.firstLeg.homeGoals,
        away_goals: ko.firstLeg.awayGoals,
      };
    }
    if (ko.aggregateBefore) facts.knockout.aggregate_before = ko.aggregateBefore;
  }
  const lg = result.league;
  if (lg) {
    const row = (id: string, remaining: number | null) => {
      const r = lg.rows.find((x) => x.teamId === id)!;
      return { rank: r.rank, points: r.points, played: r.played, remaining };
    };
    facts.league = {
      teams_in_table: lg.teams,
      home: row(core.home.id, lg.remaining.home),
      away: row(core.away.id, lg.remaining.away),
    };
  }
  return facts;
}

/** Fatos citáveis no texto do locale (validador). */
export function scenarioFactSheet(
  core: EventCore,
  facts: ScenarioFacts,
  stakes: readonly Stake[],
  locale: AgentLocale,
): FactSheet {
  const b = new FactSheetBuilder().name(...eventNames(core));
  b.name(facts.teams.home.names[locale], facts.teams.away.names[locale]);
  for (const s of stakes) {
    b.name(stakeText(s, locale));
    if (s.params?.zone) b.name(zoneLabel(s.params.zone, locale));
    if (s.params?.n !== undefined) {
      b.number(s.params.n);
      // empates específicos ("2 a 2") e margens
      if (/draw/.test(s.family)) b.score(s.params.n, s.params.n);
    }
  }
  b.number(facts.match.round);
  const ko = facts.knockout;
  if (ko?.first_leg) b.score(ko.first_leg.home_goals, ko.first_leg.away_goals);
  if (ko?.aggregate_before) b.score(ko.aggregate_before.home, ko.aggregate_before.away);
  if (ko) b.number(ko.legs === 2 ? 2 : null);
  if (facts.league) {
    for (const r of [facts.league.home, facts.league.away]) b.number(r.rank, r.points, r.played, r.remaining);
    b.number(facts.league.teams_in_table);
  }
  return b.build();
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLocaleLowerCase() + s.slice(1) : s);

/** Texto determinístico: rótulos fixos dos stakes agrupados por time (máx. 3 frases). */
export function scenarioFallback(
  core: EventCore,
  facts: ScenarioFacts,
  stakes: readonly Stake[],
  locale: AgentLocale,
): string[] {
  const pt = languageOf(locale) === 'pt';
  const side = (team: 'home' | 'away') => {
    const labels = stakes.filter((s) => s.team === team).map((s) => stakeText(s, locale));
    if (!labels.length) return null;
    const name = team === 'home' ? teamName(core.home, locale) : teamName(core.away, locale);
    return `${name}: ${labels.map(lowerFirst).join('; ')}`;
  };
  const both = stakes.filter((s) => s.team === 'both').map((s) => stakeText(s, locale));
  const sentences = [side('home'), side('away'), both.length ? both.join('; ') : null].filter(
    (s): s is string => !!s,
  );
  const fl = facts.knockout?.first_leg;
  if (fl && sentences.length < 3) {
    sentences.unshift(
      pt
        ? `Jogo de ida: ${fl.home} ${fl.home_goals} x ${fl.away_goals} ${fl.away}`
        : `Partido de ida: ${fl.home} ${fl.home_goals}-${fl.away_goals} ${fl.away}`,
    );
  }
  return sentences.slice(0, 3);
}

/** Variantes regionais que o LLM deve respeitar (iguais às dos rótulos fixos). */
const REGIONAL_HINTS = [
  'pt-BR: prorrogação, pênaltis, rodada.',
  'es-AR, es-UY, es-CL: alargue, penales, fecha.',
  'es-MX: tiempos extra, penales, jornada.',
  'es-CO, es-EC: tiempo extra, penales, fecha.',
  'es-PE: tiempo suplementario, penales, fecha.',
].join(' ');

export function scenarioSystemPrompt(): string {
  return [
    'Você é redator esportivo de uma API de dados esportivos para a América Latina.',
    'Tarefa: escrever o CENÁRIO PRÉ-JOGO — o que está em jogo para cada time — a partir dos stakes',
    'calculados pelo motor de regras. Você só redige: não calcule nem deduza cenários novos.',
    '',
    'Regras:',
    guardrailSystemRules(),
    '- Para cada locale pedido, escreva de 1 a 3 frases curtas (até 320 caracteres no total; texto lido em TV).',
    '- Escreva no idioma e na variante regional do locale; não traduza literalmente. ' + REGIONAL_HINTS,
    '- O significado de cada stake está em `stakes[].labels[locale]`; reescreva-o de forma natural, sem acrescentar condições.',
    '- Cite os times exatamente como em `teams.<lado>.names[locale]`. Não mencione data, horário, odds, arbitragem ou jogadores.',
  ].join('\n');
}

export function scenarioUserPrompt(facts: ScenarioFacts, locales: readonly AgentLocale[]): string {
  return [`Locales: ${locales.join(', ')}`, 'Fatos (JSON):', JSON.stringify(facts)].join('\n');
}
