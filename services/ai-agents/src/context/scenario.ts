import type { TitleRecord } from '@galaxie/db';
import {
  salienceFight,
  salienceGap,
  salienceWindow,
  salientStakes,
  stakeText,
  zoneLabel,
  type SalienceStanding,
  type Stake,
} from '@galaxie/rules';
import {
  FactSheetBuilder,
  guardrailSystemRules,
  languageOf,
  type AgentLocale,
  type FactSheet,
} from '../guardrails/index.js';
import { competitionName, eventNames, stageName, teamName, type EventCore } from './event-core.js';
import type { LastFinal } from './history.js';
import type { EventStakes } from './stakes.js';

/**
 * Agente Cenário pré-jogo (issue #57, docs/07 §2.3): os stakes são CALCULADOS pelo motor de
 * regras; o LLM entende a estrutura do jogo a partir dos fatos (final, ida e volta, prorrogação,
 * pênaltis, histórico de títulos) e a conta em 1–3 frases por locale, em tom informativo, sem
 * inventar nada fora dos fatos. Este módulo monta os fatos enviados ao LLM, o `FactSheet` do
 * validador e o texto determinístico de fallback (rótulos fixos de `@galaxie/rules`).
 */

/** Versão do prompt/fatos: mudar invalida o cache (força regenerar). */
// v3: só os stakes salientes (até 3 por time, docs/rules §3.5) e a distância em pontos de cada briga
// v4: última final de temporada anterior; em ida e volta, pelo agregado (`legs = 2`)
export const SCENARIO_PROMPT_VERSION = 'scenario@v4';

/** Títulos anteriores de um time na competição (antes da partida). */
export interface ScenarioTeamTitles {
  /** Títulos já conquistados. */
  won: number;
  /** Título que busca nesta partida (won + 1): 4 = tetra. */
  seeking: number;
  /** Edições vencidas, em ordem. */
  seasons: string[];
  /** Última edição vencida (null = nenhuma). */
  last_title: string | null;
}

/** Fatos históricos (Wikidata e core), só quando a contagem é confiável. */
export interface ScenarioHistory {
  /** Títulos anteriores por lado, nesta competição. */
  titles?: { home?: ScenarioTeamTitles; away?: ScenarioTeamTitles };
  /** Última final entre os dois nesta competição (core). */
  last_final_between?: {
    season: number;
    home: string;
    away: string;
    home_goals: number;
    away_goals: number;
    /** Lado DESTE jogo que venceu aquela final (null = sem dado). */
    winner: 'home' | 'away' | null;
    /** 2 = final em ida e volta: o placar é o agregado. */
    legs?: 2;
  };
}

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
  history?: ScenarioHistory;
  league?: {
    teams_in_table: number;
    home: ScenarioLeagueRow;
    away: ScenarioLeagueRow;
  };
  stakes: ScenarioStakeFact[];
}

/** Distância em pontos, por briga saliente do time (só as que aparecem nos stakes escolhidos). */
export interface ScenarioDistances {
  /** Pontos atrás do líder (briga pelo título). */
  to_leader?: number;
  /** Pontos acima do primeiro time na zona de rebaixamento (0 = já está nela). */
  above_relegation_zone?: number;
  /** Zona boa (rótulo por locale) → pontos atrás do último time dentro dela. */
  to_zone?: { zone: Partial<Record<AgentLocale, string>>; points: number }[];
}

export interface ScenarioLeagueRow {
  rank: number;
  points: number;
  played: number;
  remaining: number | null;
  distances?: ScenarioDistances;
}

/**
 * Stakes que o Cenário conta: os salientes (até 3 por time; mata-mata passa inteiro). O motor calcula
 * todos; o texto fala só dos relevantes (o 2º colocado não "corre risco de rebaixamento").
 */
export function scenarioStakes(result: Pick<EventStakes, 'stakes' | 'league'>): Stake[] {
  return salientStakes(result.stakes, result.league?.salience ?? {});
}

function distancesOf(
  side: 'home' | 'away',
  stakes: readonly Stake[],
  standing: SalienceStanding | null | undefined,
  locales: readonly AgentLocale[],
): ScenarioDistances | undefined {
  if (!standing) return undefined;
  const out: ScenarioDistances = {};
  const window = salienceWindow(standing);
  const zones = new Set<string>();
  for (const s of stakes) {
    if (s.team !== side) continue;
    const gap = salienceGap(s, standing);
    if (gap === null || gap > window) continue;
    const fight = salienceFight(s);
    if (fight === 'title') {
      if (standing.leaderPoints !== null && standing.rank > 1) out.to_leader = gap;
    } else if (fight === 'relegation') {
      out.above_relegation_zone = gap;
    } else if (fight === 'zone' && s.params?.zone && gap > 0 && !zones.has(s.params.zone)) {
      const zone = s.params.zone;
      zones.add(zone);
      (out.to_zone ??= []).push({ zone: perLocale(locales, (l) => zoneLabel(zone, l)), points: gap });
    }
  }
  return Object.keys(out).length ? out : undefined;
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

function teamTitles(rec: TitleRecord | undefined): ScenarioTeamTitles | undefined {
  if (!rec) return undefined;
  return { won: rec.won, seeking: rec.won + 1, seasons: rec.seasons, last_title: rec.seasons.at(-1) ?? null };
}

export function buildScenarioFacts(
  core: EventCore,
  result: EventStakes,
  locales: readonly AgentLocale[],
  extra: { lastFinal?: LastFinal | null } = {},
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
    stakes: scenarioStakes(result).map((s) => ({
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
  const history: ScenarioHistory = {};
  const home = teamTitles(result.titles?.home);
  const away = teamTitles(result.titles?.away);
  if (home || away) history.titles = { ...(home ? { home } : {}), ...(away ? { away } : {}) };
  if (extra.lastFinal) history.last_final_between = extra.lastFinal;
  if (history.titles || history.last_final_between) facts.history = history;
  const lg = result.league;
  if (lg) {
    const chosen = scenarioStakes(result);
    const row = (side: 'home' | 'away', id: string, remaining: number | null): ScenarioLeagueRow => {
      const r = lg.rows.find((x) => x.teamId === id)!;
      const distances = distancesOf(side, chosen, lg.salience?.[side], locales);
      return {
        rank: r.rank,
        points: r.points,
        played: r.played,
        remaining,
        ...(distances ? { distances } : {}),
      };
    };
    facts.league = {
      teams_in_table: lg.teams,
      home: row('home', core.home.id, lg.remaining.home),
      away: row('away', core.away.id, lg.remaining.away),
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
  const h = facts.history;
  for (const t of [h?.titles?.home, h?.titles?.away]) {
    if (!t) continue;
    b.number(t.won, t.seeking);
    for (const season of t.seasons) b.number(...(season.match(/\d{4}/g) ?? []).map(Number));
  }
  if (h?.last_final_between) {
    const f = h.last_final_between;
    b.number(f.season).score(f.home_goals, f.away_goals).name(f.home, f.away);
  }
  if (facts.league) {
    for (const r of [facts.league.home, facts.league.away]) {
      b.number(r.rank, r.points, r.played, r.remaining);
      const d = r.distances;
      b.number(d?.to_leader, d?.above_relegation_zone, ...(d?.to_zone ?? []).map((z) => z.points));
      for (const z of d?.to_zone ?? []) b.name(z.zone[locale]);
    }
    b.number(facts.league.teams_in_table);
  }
  return b.build();
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLocaleLowerCase() + s.slice(1) : s);

/** Frase de abertura da final: quem vencer é campeão (nada de "avançar"). */
function finalLead(ko: NonNullable<ScenarioFacts['knockout']>, pt: boolean): string {
  if (ko.legs === 2 && ko.leg === 1)
    return pt
      ? 'Jogo de ida da final: o título se decide na volta'
      : 'Ida de la final: el título se define en la vuelta';
  if (ko.legs === 2)
    return pt
      ? 'Jogo de volta da final: quem levar o confronto é campeão'
      : 'Vuelta de la final: el que gane la serie es campeón';
  return pt ? 'Final em jogo único: quem vencer é campeão' : 'Final a partido único: el que gane es campeón';
}

/** Texto determinístico da final: abertura, títulos buscados e o que acontece com cada resultado. */
function finalFallback(
  core: EventCore,
  ko: NonNullable<ScenarioFacts['knockout']>,
  stakes: readonly Stake[],
  locale: AgentLocale,
): string[] {
  const pt = languageOf(locale) === 'pt';
  const name = (team: 'home' | 'away') => teamName(team === 'home' ? core.home : core.away, locale);
  const chase = (['home', 'away'] as const).flatMap((team) =>
    stakes
      .filter((s) => s.team === team && s.family === 'seeks_title_n')
      .map((s) => `${name(team)} ${lowerFirst(stakeText(s, locale))}`),
  );
  // no jogo único, "vitória no tempo normal dá o título" para os dois já está na abertura
  const covered = new Set<string>(['seeks_title_n', ...(ko.legs === 1 ? ['needs_win_for_title'] : [])]);
  const side = (team: 'home' | 'away') => {
    const labels = stakes
      .filter((s) => s.team === team && !covered.has(s.family))
      .map((s) => lowerFirst(stakeText(s, locale)));
    return labels.length ? `${name(team)}: ${labels.join('; ')}` : null;
  };
  const both = stakes
    .filter((s) => s.team === 'both' && s.family !== 'decides_title')
    .map((s, i) => (i ? lowerFirst(stakeText(s, locale)) : stakeText(s, locale)));
  return [
    finalLead(ko, pt),
    chase.length ? chase.join('; ') : null,
    side('home'),
    side('away'),
    both.length ? both.join('; ') : null,
  ]
    .filter((s): s is string => !!s)
    .slice(0, 3);
}

/** Texto determinístico: rótulos fixos dos stakes agrupados por time (máx. 3 frases). */
export function scenarioFallback(
  core: EventCore,
  facts: ScenarioFacts,
  stakes: readonly Stake[],
  locale: AgentLocale,
): string[] {
  if (facts.knockout?.decides_title) return finalFallback(core, facts.knockout, stakes, locale);
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
    'Tarefa: escrever o CENÁRIO PRÉ-JOGO — o que está em jogo para cada time — a partir dos fatos (JSON).',
    'Os stakes são calculados pelo motor de regras e dizem exatamente o que cada resultado provoca. Seu',
    'trabalho é entender a estrutura do jogo pelos fatos e contá-la de forma natural, correta e rica.',
    '',
    'Como ler os fatos:',
    '- `knockout.decides_title = true`: é a decisão do título. Quem vencer (o jogo ou o confronto) é CAMPEÃO.',
    '  Nunca fale em avançar, passar de fase, classificar-se ou vaga: fale em título, taça, ser campeão.',
    '- `knockout.legs = 1`: jogo único. `legs = 2`: ida e volta; `leg = 1` é a ida (nada se decide hoje),',
    '  `leg = 2` é a volta, com o placar da ida em `first_leg` e o agregado antes do jogo em `aggregate_before`.',
    '- Em caso de igualdade, conte o que acontece exatamente como os fatos e os stakes dizem: com',
    '  `extra_time = true`, prorrogação e, persistindo, pênaltis; com `extra_time = false`, pênaltis direto',
    '  (não fale em prorrogação).',
    '- `league`: posição, pontos, jogos e jogos restantes de cada time; `distances` (quando houver) = distância em',
    '  pontos de cada briga que importa: `to_leader` (atrás do líder), `above_relegation_zone` (acima do primeiro',
    '  time na zona de rebaixamento; 0 = já está nela), `to_zone` (atrás do último time dentro da vaga).',
    '- `stakes` traz só o que é relevante para cada time (até 3). Não fale de brigas que não estão nos stakes',
    '  (ex.: não diga que um time "luta contra o rebaixamento" se nenhum stake dele trata disso).',
    '- `stakes[].labels[locale]`: o significado exato de cada código. Reescreva com naturalidade, sem mudar a',
    '  condição, sem acrescentar condições e sem omitir a que decide o jogo.',
    '- `history` (quando houver): `titles.<lado>.won` = títulos daquela competição antes deste jogo;',
    '  `seeking` = o título que o time busca (bi = 2, tri = 3, tetra = 4, penta = 5, hexa = 6, hepta = 7,',
    '  octa = 8, enea = 9, deca = 10; acima de 10, "o 11º título"; 1 = o primeiro título); `seasons` = as',
    '  edições vencidas; `last_final_between` = a última final entre os dois nesta competição (legs = 2: ida e',
    '  volta, e o placar é o agregado dos dois jogos).',
    '  Use esses fatos para enriquecer o texto ("busca o tetra"), sempre ligados à competição dos fatos.',
    '',
    'Regras:',
    guardrailSystemRules(),
    '- Não invente números, anos, títulos, campanhas ou fatos que não estejam nos fatos. Sem `history`, não',
    '  fale de títulos anteriores nem de finais passadas.',
    '- Para cada locale pedido, escreva de 1 a 3 frases curtas (até 320 caracteres no total; texto lido em TV).',
    '- Escreva no idioma e na variante regional do locale; não traduza literalmente. ' + REGIONAL_HINTS,
    '- Cite os times exatamente como em `teams.<lado>.names[locale]`. Não mencione data, horário, odds, arbitragem ou jogadores.',
    '',
    'Exemplo (pt-BR, final em jogo único da Libertadores com prorrogação e `history` de títulos):',
    '"Final em jogo único: quem vencer é campeão. O Palmeiras busca o tetra da Libertadores; o Estudiantes, o',
    'penta. Empate leva à prorrogação e, se persistir, pênaltis."',
  ].join('\n');
}

export function scenarioUserPrompt(facts: ScenarioFacts, locales: readonly AgentLocale[]): string {
  return [`Locales: ${locales.join(', ')}`, 'Fatos (JSON):', JSON.stringify(facts)].join('\n');
}
