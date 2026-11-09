/**
 * Chaveamento do mata-mata (#829): monta as fases e os confrontos a partir das fases (`core.stage`) e dos
 * jogos já guardados. Puro (sem banco): a rota `/v1/competitions/{id}/seasons/{season}/bracket` carrega as
 * linhas e chama `buildBracket`.
 *
 * - Confronto = os jogos do mesmo par na mesma fase (ida e volta, jogo único ou série melhor de N).
 * - Playoffs que o fornecedor divide por semana ("Play-offs - 1", "Play-offs - 2"…) viram uma fase só e
 *   são separados de novo pela profundidade: o 1º confronto de cada time é a 1ª rodada, o 2º a 2ª…
 * - Os confrontos de cada fase saem na ordem do chaveamento: os vencedores dos dois primeiros se cruzam no
 *   primeiro confronto da fase seguinte, e assim por diante.
 */
import type { Bracket, BracketTie, Event } from '@galaxie/contracts';
import type { EventScore } from '@galaxie/db';
import {
  knockoutSeed,
  knockoutStageRules,
  rulesStageKey,
  type CompetitionRules,
  type SeedRow,
} from '@galaxie/rules';
import { IN_PLAY } from '../events/queries.js';
import { formatInstant, pickText } from '../i18n.js';

/** Fases de mata-mata (as mesmas de `KNOCKOUT_KINDS` em events/builder). */
export const BRACKET_KINDS: ReadonlySet<string> = new Set([
  'playoff',
  'knockout_round',
  'round_of_128',
  'round_of_64',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'final',
]);

/** Esportes em que o playoff é série melhor de N (decidida por vitórias, não pela soma dos placares). */
export const SERIES_SPORTS: ReadonlySet<string> = new Set([
  'basketball',
  'nba',
  'baseball',
  'hockey',
  'volleyball',
]);

export interface BracketStage {
  id: string;
  kind: string;
  name: Record<string, string>;
  label: string | null;
  order: number;
}

export interface BracketMatch {
  id: string;
  stageId: string;
  startsAt: Date;
  updatedAt: Date;
  status: Event['status'];
  score: EventScore | null;
  homeId: string | null;
  awayId: string | null;
  /** Vencedor marcado pelo fornecedor (`event_participant.result.winner`), quando houver. */
  winnerId: string | null;
}

export interface BracketParticipant {
  id: string;
  name: string;
  provider_name: string;
  short_name: string | null;
  logo: string | null;
}

export interface BuildBracketInput {
  sport: string;
  stages: BracketStage[];
  matches: BracketMatch[];
  participants: Map<string, BracketParticipant>;
  locale: string;
  tz: string;
  /** Agora (para saber se um jogo "se necessário" já passou do horário sem ser jogado). */
  now?: Date;
  /** Regulamento da fase (`knockoutStageRules`), quando houver. */
  tieRules?: (stage: BracketStage) => TieRules | null;
}

/**
 * O que o regulamento da fase diz sobre o confronto (futebol, de `knockoutStageRules`): partidas, desempates sem
 * pênaltis e a posição dos dois na tabela de referência (`better_seed`).
 */
export interface TieRules {
  legs: number | null;
  /** Gol fora desempata o agregado (temporadas antigas), salvo em campo neutro. */
  awayGoals?: boolean;
  neutralVenue?: boolean;
  /** Jogo único: o empate classifica este lado da partida (1ª fase da Copa do Brasil: o visitante). */
  drawAdvantage?: 'home' | 'away' | null;
  /** Empate no confronto: passa o de melhor campanha (Liguilla da Liga MX). */
  levelAdvantage?: 'better_seed' | null;
  /** Posição (menor = melhor) dos dois times na tabela de referência, para `better_seed`. */
  seed?: (homeId: string, awayId: string) => { home: number; away: number } | undefined;
}

/**
 * Regulamento da fase para o confronto, a partir do YAML da competição (`config/rules`). `seedRows`: as linhas
 * de `core.standing` da temporada (só precisa delas quem tem `better_seed`).
 */
export function tieRulesOf(
  rules: CompetitionRules | null,
  stage: Pick<BracketStage, 'kind' | 'label'>,
  seedRows: readonly SeedRow[] = [],
): TieRules | null {
  if (!rules?.knockout) return null;
  const r = knockoutStageRules(rules, rulesStageKey(stage.kind, stage.label));
  return {
    legs: r.legs,
    awayGoals: r.awayGoals,
    neutralVenue: r.neutralVenue,
    drawAdvantage: r.drawAdvantage,
    levelAdvantage: r.levelAdvantage,
    seed: (homeId, awayId) => knockoutSeed(rules, stage.label, seedRows, homeId, awayId),
  };
}

type Round = Bracket['rounds'][number];
type Pair = { home: number | null; away: number | null };

/** Nomes das fases deduzidas pela profundidade (playoffs divididos por semana). */
const DERIVED: Record<string, Record<string, string>> = {
  final: { 'pt-BR': 'Final', es: 'Final', en: 'Final' },
  semi_final: { 'pt-BR': 'Semifinal', es: 'Semifinales', en: 'Semi-finals' },
};
const KIND_BY_TIES: Record<number, string> = {
  1: 'final',
  2: 'semi_final',
  4: 'quarter_final',
  8: 'round_of_16',
  16: 'round_of_32',
};
const ROUND_WORD: Record<string, string> = { 'pt-BR': 'Rodada', es: 'Ronda', en: 'Round' };

const started = (m: BracketMatch) => m.status === 'finished' || IN_PLAY.includes(m.status);

/**
 * Folga depois do horário antes de tratar um jogo ainda `scheduled` como não disputado (o "se necessário" que a
 * série dispensou). Cobre o jogo inteiro com prorrogação, um início atrasado e a demora da fonte em trocar o
 * status, para um jogo acontecendo agora não fechar a série; e fica abaixo do dia que costuma separar dois jogos
 * da série. Errar para mais só adia o "decidido" por algumas horas; errar para menos publica um vencedor errado.
 */
export const UNPLAYED_GRACE_MS = 12 * 3600_000;

/**
 * Cancelado que conta no tamanho da série como "se necessário" dispensado. O que foi recriado com outro id não
 * conta: fica antes de (ou junto com) um jogo já iniciado, ou no mesmo horário de um jogo ainda por jogar.
 */
const isDismissedLeg = (cancelledAt: number, legs: BracketMatch[]) =>
  legs.every((l) => (started(l) ? l.startsAt.getTime() < cancelledAt : l.startsAt.getTime() !== cancelledAt));

/** Rótulo da fase sem o número da semana/rodada ("Play-offs - 3" → "Play-offs"). */
const baseLabel = (label: string | null) => (label ?? '').replace(/\s+-\s+\d+$/, '').trim();
/** Nome sem o sufixo de rodada ("Playoffs · Rodada 3" → "Playoffs"). */
const baseName = (name: string) => name.replace(/\s+·\s+(Rodada|Fecha|Matchday|Semana|Week)\s+\d+$/i, '');

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Gols/pontos da partida do ponto de vista de `home`/`away` do confronto. */
function oriented(m: BracketMatch, pair: Pair | null | undefined, home: string): Pair | null {
  if (!pair || pair.home == null || pair.away == null) return null;
  return m.homeId === home ? { home: pair.home, away: pair.away } : { home: pair.away, away: pair.home };
}

function winnerOfMatch(m: BracketMatch): string | null {
  if (m.status !== 'finished' || !m.homeId || !m.awayId) return null;
  const s = m.score;
  if (s?.home != null && s.away != null && s.home !== s.away) return s.home > s.away ? m.homeId : m.awayId;
  const p = s?.penalty;
  if (p?.home != null && p.away != null && p.home !== p.away) return p.home > p.away ? m.homeId : m.awayId;
  return m.winnerId;
}

/**
 * Quem passa no confronto encerrado: agregado (ou placar do jogo único); no empate, gol fora (se o regulamento
 * tiver), pênaltis, vantagem do empate no jogo único, melhor campanha e, por fim, o vencedor que o fornecedor
 * marcou. Null quando nada disso decide.
 */
function levelWinner(
  legs: BracketMatch[],
  totals: { home: number; away: number },
  penalties: Pair | null,
  home: string,
  away: string,
  format: BracketTie['format'],
  rules: TieRules | null,
): string | null {
  if (totals.home !== totals.away) return totals.home > totals.away ? home : away;
  if (format === 'two_legs' && rules?.awayGoals && !rules.neutralVenue) {
    // gols de cada lado nas partidas em que foi visitante
    const awayGoals = { home: 0, away: 0 };
    for (const l of legs) {
      const g = oriented(l, l.score, home);
      if (!g) continue;
      if (l.homeId === home) awayGoals.away += g.away!;
      else awayGoals.home += g.home!;
    }
    if (awayGoals.home !== awayGoals.away) return awayGoals.home > awayGoals.away ? home : away;
  }
  if (penalties && penalties.home !== penalties.away) return penalties.home! > penalties.away! ? home : away;
  const last = legs.at(-1)!;
  if (format === 'single' && rules?.drawAdvantage)
    return rules.drawAdvantage === 'home' ? last.homeId : last.awayId;
  if (rules?.levelAdvantage === 'better_seed') {
    const seed = rules.seed?.(home, away);
    if (seed && seed.home !== seed.away) return seed.home < seed.away ? home : away;
  }
  return last.winnerId === home || last.winnerId === away ? last.winnerId : null;
}

/** Um confronto: formato, pernas, agregado ou vitórias da série, pênaltis, vencedor e situação. */
export function buildTie(
  stageId: string,
  legs: BracketMatch[],
  opts: {
    sport: string;
    participants: Map<string, BracketParticipant>;
    tz: string;
    rules: TieRules | null;
    /** Todos os jogos da fase acabaram (fecha a série sem número de jogos conhecido). */
    stageDone: boolean;
    now?: Date;
    /** Jogos do par que o fornecedor cancelou (os "se necessário" de uma série já fechada). */
    cancelledLegs?: number;
  },
): BracketTie {
  const rules = opts.rules;
  const expectedLegs = rules?.legs ?? null;
  const first = legs[0]!;
  const home = first.homeId!;
  const away = first.awayId!;
  const series = SERIES_SPORTS.has(opts.sport) && (legs.length > 1 || (expectedLegs ?? 0) > 2);
  const format: BracketTie['format'] = series
    ? 'series'
    : (expectedLegs ?? legs.length) >= 2
      ? 'two_legs'
      : 'single';
  const allDone = legs.every((l) => l.status === 'finished');
  const anyStarted = legs.some(started);
  const last = legs.at(-1)!;
  const penalties = started(last) ? oriented(last, last.score?.penalty, home) : null;

  let aggregate: Pair | null = null;
  let wins: Pair | null = null;
  let winner: string | null = null;
  let decided: boolean;

  if (format === 'series') {
    wins = { home: 0, away: 0 };
    for (const l of legs) {
      const w = winnerOfMatch(l);
      if (w === home) wins.home!++;
      else if (w === away) wins.away!++;
    }
    const lead = Math.max(wins.home!, wins.away!);
    // melhor de N: pelo regulamento; sem ele, pelos jogos do par (N ímpar) só quando os que sobram seguem
    // `scheduled` além da margem (`UNPLAYED_GRACE_MS`) ou foram cancelados, sinal de que a série acabou. Um jogo
    // futuro, prestes a começar ou adiado pode ser só o próximo de uma série maior listada aos poucos (3×1 com só
    // o jogo 5 listado não fecha a melhor de 7). Jogos "se necessário" não seguram a série: 4 vitórias fecham a
    // melhor de 7 na hora. O resto fecha com a fase encerrada ou quando o time aparece na fase seguinte
    // (`advanceFromNextRounds`)
    const cancelled = opts.cancelledLegs ?? 0;
    const n = legs.length + cancelled;
    const pending = legs.filter((l) => !started(l));
    const overdue = pending.every(
      (l) =>
        l.status === 'scheduled' &&
        !!opts.now &&
        l.startsAt.getTime() + UNPLAYED_GRACE_MS < opts.now.getTime(),
    );
    const listed = n % 2 === 1 && n >= 3 && pending.length + cancelled > 0 && overdue ? n : null;
    const bestOf = expectedLegs ?? listed;
    const needed = bestOf ? Math.floor(bestOf / 2) + 1 : null;
    const playedDone = legs.filter(started).every((l) => l.status === 'finished');
    decided =
      wins.home !== wins.away && (lead >= (needed ?? 4) || (needed == null && playedDone && opts.stageDone));
    if (decided) winner = wins.home! > wins.away! ? home : away;
  } else {
    const totals = { home: 0, away: 0 };
    let any = false;
    for (const l of legs.filter(started)) {
      const g = oriented(l, l.score, home);
      if (!g) continue;
      any = true;
      totals.home += g.home!;
      totals.away += g.away!;
    }
    if (format === 'two_legs' && any) aggregate = totals;
    const complete = legs.length >= (expectedLegs ?? legs.length);
    if (complete && allDone && any) winner = levelWinner(legs, totals, penalties, home, away, format, rules);
    // empate sem critério que o dado resolva: fica em aberto até o time aparecer na fase seguinte
    decided = winner != null;
  }

  const ref = (id: string) =>
    opts.participants.get(id) ?? { id, name: '', provider_name: '', short_name: null, logo: null };
  return {
    id: `${stageId}|${pairKey(home, away)}`,
    home: ref(home),
    away: ref(away),
    format,
    legs: legs.map((l, i) => ({
      event_id: l.id,
      leg: i + 1,
      starts_at: formatInstant(l.startsAt, opts.tz),
      status: l.status,
      home_id: l.homeId,
      score: { home: l.score?.home ?? null, away: l.score?.away ?? null },
      penalty:
        l.score?.penalty?.home != null && l.score.penalty.away != null
          ? { home: l.score.penalty.home, away: l.score.penalty.away }
          : null,
    })),
    aggregate,
    wins,
    penalties: penalties && penalties.home !== penalties.away ? penalties : null,
    winner_id: winner,
    status: decided ? 'decided' : anyStarted ? 'in_progress' : 'scheduled',
  };
}

/**
 * Ordem do chaveamento: da final para trás, cada fase segue a posição, na fase seguinte, do confronto do
 * time que avançou; o que não casa (fase seguinte ainda sem esse time) vai para o fim, pela data. A
 * disputa de 3º lugar fica fora da corrente.
 */
export function alignRounds(rounds: Round[]): Round[] {
  const chain = rounds.filter((r) => r.kind !== 'third_place');
  const firstStart = (t: BracketTie) => t.legs[0]?.starts_at ?? '';
  for (let i = chain.length - 1; i >= 0; i--) {
    const round = chain[i]!;
    const next = chain[i + 1];
    const slot = new Map<string, number>();
    next?.ties.forEach((t, idx) => {
      if (t.home) slot.set(t.home.id, idx);
      if (t.away) slot.set(t.away.id, idx);
    });
    const key = (t: BracketTie) => {
      const ids = t.winner_id ? [t.winner_id] : [t.home?.id, t.away?.id];
      const hits = ids.map((id) => (id ? slot.get(id) : undefined)).filter((n): n is number => n != null);
      return hits.length ? Math.min(...hits) : Number.MAX_SAFE_INTEGER;
    };
    round.ties = [...round.ties].sort(
      (a, b) => key(a) - key(b) || firstStart(a).localeCompare(firstStart(b)) || a.id.localeCompare(b.id),
    );
  }
  return rounds;
}

/** Fases e confrontos da temporada, em ordem, prontos para a resposta. */
export function buildBracket(input: BuildBracketInput): Round[] {
  const stages = input.stages.filter((s) => BRACKET_KINDS.has(s.kind)).sort((a, b) => a.order - b.order);
  // fases do mesmo tipo e rótulo base (playoffs divididos por semana) viram um grupo só
  const groups = new Map<string, BracketStage[]>();
  for (const s of stages) {
    const key = `${s.kind}|${baseLabel(s.label) || s.id}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const matchesByStage = new Map<string, BracketMatch[]>();
  // horário dos jogos cancelados de cada par (por fase): ficam fora do confronto, mas contam no tamanho da série
  const cancelledBy = new Map<string, number[]>();
  for (const m of input.matches) {
    if (!m.homeId || !m.awayId) continue;
    if (m.status === 'cancelled') {
      const k = `${m.stageId}|${pairKey(m.homeId, m.awayId)}`;
      cancelledBy.set(k, [...(cancelledBy.get(k) ?? []), m.startsAt.getTime()]);
      continue;
    }
    matchesByStage.set(m.stageId, [...(matchesByStage.get(m.stageId) ?? []), m]);
  }

  const rounds: Round[] = [];
  for (const group of groups.values()) {
    const head = group[0]!;
    const matches = group
      .flatMap((s) => matchesByStage.get(s.id) ?? [])
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    if (!matches.length) continue;
    const stageDone = matches.every((m) => m.status === 'finished');
    const rules = input.tieRules?.(head) ?? null;
    // confrontos: o mesmo par dentro do grupo, em ordem cronológica
    const byPair = new Map<string, BracketMatch[]>();
    for (const m of matches) {
      const k = pairKey(m.homeId!, m.awayId!);
      byPair.set(k, [...(byPair.get(k) ?? []), m]);
    }
    // profundidade: o n-ésimo confronto de cada time no grupo é a n-ésima rodada
    const seen = new Map<string, number>();
    const depthOf = new Map<string, number>();
    for (const [k, legs] of [...byPair].sort(
      (a, b) => a[1][0]!.startsAt.getTime() - b[1][0]!.startsAt.getTime(),
    )) {
      const { homeId, awayId } = legs[0]!;
      const depth = Math.max(seen.get(homeId!) ?? 0, seen.get(awayId!) ?? 0) + 1;
      depthOf.set(k, depth);
      seen.set(homeId!, depth);
      seen.set(awayId!, depth);
    }
    const maxDepth = Math.max(...depthOf.values());
    const name = baseName(pickText(head.name, input.locale, head.label ?? head.kind) ?? head.kind);
    for (let d = 1; d <= maxDepth; d++) {
      const pairs = [...byPair].filter(([k]) => depthOf.get(k) === d);
      if (!pairs.length) continue;
      const ties = pairs.map(([k, legs]) =>
        buildTie(head.id, legs, {
          sport: input.sport,
          participants: input.participants,
          tz: input.tz,
          rules,
          stageDone,
          ...(input.now ? { now: input.now } : {}),
          cancelledLegs: group
            .flatMap((st) => cancelledBy.get(`${st.id}|${k}`) ?? [])
            .filter((at) => isDismissedLeg(at, legs)).length,
        }),
      );
      let kind = head.kind;
      let roundName = name;
      if (maxDepth > 1) {
        // playoff dividido: o tipo sai pelo número de confrontos (1 = final, 2 = semi, 4 = quartas…); o nome
        // é "Final"/"Semifinal" nas duas últimas e "Playoffs · Rodada N" antes (a NBA não tem "oitavas")
        const derived = KIND_BY_TIES[pairs.length];
        if (derived) kind = derived;
        roundName =
          derived === 'final' || derived === 'semi_final'
            ? pickText(DERIVED[derived]!, input.locale, derived)!
            : `${name} · ${pickText(ROUND_WORD, input.locale, 'Round')} ${d}`;
      }
      rounds.push({ stage_id: head.id, kind, name: roundName, ties });
    }
  }
  return alignRounds(advanceFromNextRounds(rounds));
}

/**
 * Confronto ainda em aberto cujo time já joga a fase seguinte: quem avançou está decidido (série melhor de
 * 3 ou 5 sem regulamento, ou jogos "se necessário" que o fornecedor deixou agendados).
 */
export function advanceFromNextRounds(rounds: Round[]): Round[] {
  const chain = rounds.filter((r) => r.kind !== 'third_place');
  chain.forEach((round, i) => {
    const later = new Set(chain.slice(i + 1).flatMap((r) => r.ties.flatMap((t) => [t.home?.id, t.away?.id])));
    for (const tie of round.ties) {
      if (tie.status === 'decided' || !tie.home || !tie.away) continue;
      const inHome = later.has(tie.home.id);
      const inAway = later.has(tie.away.id);
      if (inHome === inAway) continue;
      tie.winner_id = inHome ? tie.home.id : tie.away.id;
      tie.status = 'decided';
    }
  });
  return rounds;
}
