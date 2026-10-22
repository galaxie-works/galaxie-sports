/**
 * Situação da campanha de um time numa temporada de competição (docs/05 §3.3, overview do time).
 *
 * Funções puras, sem I/O: recebem as fases da temporada, os jogos do time e os confrontos de
 * mata-mata e devolvem o status (campeão, vice, em andamento, eliminado, pontos corridos...).
 * O agrupamento por confronto e os gols por participante vêm do montador de eventos
 * (`groupTies`/`goalsOf`); o critério de desempate de um confronto (agregado, gol fora, vantagem do
 * empate) vem do motor de regras (`tieOutcome`).
 */
import type { CampaignStatus, Event } from '@galaxie/contracts';
import { tieOutcome, type CompetitionRules, type KnockoutStageRules, type TieOutcome } from '@galaxie/rules';
import {
  goalsOf,
  groupTies,
  KNOCKOUT_KINDS,
  LEAGUE_KINDS,
  rulesStageKey,
  type StageMatch,
} from '../events/builder.js';

/** Fases decididas em confronto direto (mata-mata e fase preliminar). */
export const TIE_KINDS = new Set([...KNOCKOUT_KINDS, 'qualifying']);

/**
 * Profundidade da fase na temporada: fase preliminar < pontos corridos (liga, grupos, fase de liga)
 * < playoff < fases numeradas < 64 avos < … < semifinal < disputa de 3º < final.
 * Fases sem semântica de campanha (amistoso, "other", fim de semana de GP) ficam de fora.
 */
const STAGE_DEPTH: Record<string, number> = {
  qualifying: 0,
  regular: 1,
  group: 1,
  league_phase: 1,
  playoff: 2,
  knockout_round: 3,
  round_of_128: 4,
  round_of_64: 5,
  round_of_32: 6,
  round_of_16: 7,
  quarter_final: 8,
  semi_final: 9,
  third_place: 10,
  final: 11,
};

/** Fase seguinte por tipo, quando a temporada ainda não tem a fase cadastrada. */
const NEXT_KIND: Record<string, string> = {
  round_of_128: 'round_of_64',
  round_of_64: 'round_of_32',
  round_of_32: 'round_of_16',
  round_of_16: 'quarter_final',
  quarter_final: 'semi_final',
  semi_final: 'final',
};

const CLOSED_STATUSES = new Set<Event['status']>(['finished', 'cancelled', 'abandoned']);
/** Jogo ainda por acontecer ou em andamento (adiado e suspenso contam como pendentes). */
export const isOpen = (status: Event['status']): boolean => !CLOSED_STATUSES.has(status);

export type I18nName = Partial<Record<string, string>> | null;

export interface CampaignStage {
  id: string;
  kind: string;
  /** core.stage.order (desempata fases do mesmo tipo, ex.: 1ª, 2ª e 3ª fase). */
  order: number;
  name: I18nName;
  providerLabel: string | null;
}

/** Jogo de mata-mata com os vencedores informados pelo fornecedor (`event_participant.result.winner`). */
export interface CampaignMatch extends StageMatch {
  winnerIds: string[];
}

export interface CampaignStanding {
  rank: number;
  points: number;
  played: number;
  group: string | null;
}

export interface CampaignInput {
  teamId: string;
  /** Todas as fases da temporada (inclusive as que o time não disputou). */
  stages: CampaignStage[];
  /** Jogos do time na temporada (qualquer fase). */
  teamEvents: { id: string; stageId: string | null; status: Event['status'] }[];
  /** Jogos das fases de confronto que o time disputou (de todos os times; o confronto é filtrado aqui). */
  tieMatches: CampaignMatch[];
  /** Linha do time na tabela da temporada (null em copas sem tabela). */
  standing: CampaignStanding | null;
  /** A temporada ainda tem jogos por acontecer (de qualquer time). */
  seasonOpen: boolean;
  rules: CompetitionRules | null;
  /** core.competition.type: league | cup | tournament. */
  competitionType: string;
}

export type TieState = 'won' | 'lost' | 'pending' | 'unknown';

/** Confronto direto do time numa fase, do ponto de vista do time. */
export interface TieSummary {
  stageKind: string;
  stageName: I18nName;
  opponentId: string;
  state: TieState;
  /** Partidas do confronto (excluídas as canceladas), em ordem cronológica. */
  legs: number;
  /** Partidas já encerradas. */
  playedLegs: number;
  /** Gols somados nas partidas encerradas (com prorrogação, sem pênaltis). */
  goalsFor: number;
  goalsAgainst: number;
  penalties: { for: number; against: number } | null;
  /** Decidido no gol fora de casa. */
  awayGoals: boolean;
  /** A última partida teve prorrogação. */
  extraTime: boolean;
  /** Última partida encerrada do confronto (a que decidiu, quando decidido). */
  lastEventId: string | null;
}

export interface Campaign {
  status: CampaignStatus;
  /** Fase em que o time está (em andamento) ou em que a campanha se decidiu. */
  stageKind: string | null;
  /** Nome da fase (core.stage.name), usado nas fases sem rótulo fixo (1ª fase, 2ª fase...). */
  stageName: I18nName;
  rank: number | null;
  points: number | null;
  played: number | null;
  group: string | null;
  /** Confronto que decidiu a campanha, o último vencido (em andamento) ou o que está em disputa. */
  tie: TieSummary | null;
  /** O confronto em `tie` é anterior à fase atual (o time o venceu e aguarda a próxima fase). */
  advancedFrom: boolean;
}

const depthOf = (kind: string): number | undefined => STAGE_DEPTH[kind];

/** Ordena fases pela profundidade e, no mesmo tipo, pela ordem do fornecedor. */
export function compareStages(a: CampaignStage, b: CampaignStage): number {
  return (depthOf(a.kind) ?? -1) - (depthOf(b.kind) ?? -1) || a.order - b.order;
}

const DEFAULT_TIE_RULES: KnockoutStageRules = {
  legs: 1,
  awayGoals: false,
  awayGoalsInExtraTime: false,
  extraTime: true,
  penalties: true,
  drawAdvantage: null,
  neutralVenue: false,
  decidesTitle: false,
};

/** Regras do confronto: as do regulamento (quando há) com o número de jogos que de fato existem. */
function tieRules(rules: CompetitionRules | null, stage: CampaignStage, legs: 1 | 2): KnockoutStageRules {
  const ko = rules?.knockout;
  const key = rulesStageKey(stage.kind, stage.providerLabel);
  const base = ko ? (ko.stages[key] ?? ko.default) : DEFAULT_TIE_RULES;
  return { ...base, legs };
}

/** Houve prorrogação: o fornecedor preenche o placar da prorrogação (mesmo 0–0). */
const playedExtraTime = (p: { home: number | null; away: number | null } | null | undefined): boolean =>
  !!p && (p.home != null || p.away != null);

/**
 * Resultado de um confronto direto para o time: agregado (gols por participante, independente do
 * mando — cuidado: na volta os mandos se invertem), depois o regulamento (gol fora, vantagem do
 * empate), depois os pênaltis e, por fim, o vencedor informado pelo fornecedor.
 */
export function decideTie(
  teamId: string,
  stage: CampaignStage,
  matches: CampaignMatch[],
  rules: CompetitionRules | null,
): TieSummary | null {
  const legsList = matches.filter((m) => m.status !== 'cancelled');
  const first = legsList[0];
  if (!first) return null;
  const opponentId = first.homeId === teamId ? first.awayId : first.homeId;
  if (!opponentId) return null;
  const finished = legsList.filter((m) => m.status === 'finished');
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const m of finished) {
    const g = goalsOf(m);
    goalsFor += g?.get(teamId) ?? 0;
    goalsAgainst += g?.get(opponentId) ?? 0;
  }
  const last = finished.at(-1) ?? null;
  const base: TieSummary = {
    stageKind: stage.kind,
    stageName: stage.name,
    opponentId,
    state: 'pending',
    legs: legsList.length,
    playedLegs: finished.length,
    goalsFor,
    goalsAgainst,
    penalties: null,
    awayGoals: false,
    extraTime: playedExtraTime(last?.score?.extratime),
    lastEventId: last?.id ?? null,
  };
  if (legsList.some((m) => isOpen(m.status)) || !last) return base;

  const won = (winnerId: string | null): TieSummary => ({
    ...base,
    state: winnerId === teamId ? 'won' : winnerId === opponentId ? 'lost' : 'unknown',
  });
  if (goalsFor !== goalsAgainst) return won(goalsFor > goalsAgainst ? teamId : opponentId);

  // Agregado empatado: o regulamento decide (gol fora, vantagem do empate) quando o mando é o padrão
  // (jogo único, ou ida e volta com os mandos invertidos).
  let outcome: TieOutcome | null = null;
  const lastGoals = goalsOf(last);
  if (lastGoals && last.homeId && last.awayId) {
    try {
      if (legsList.length === 1) {
        outcome = tieOutcome(
          { rules: tieRules(rules, stage, 1) },
          lastGoals.get(last.homeId)!,
          lastGoals.get(last.awayId)!,
        );
      } else if (legsList.length === 2 && first.homeId === last.awayId && first.awayId === last.homeId) {
        const g1 = goalsOf(first);
        const r = tieRules(rules, stage, 2);
        // gol fora na prorrogação só vale se o regulamento disser
        const awayGoals = r.awayGoals && (!base.extraTime || r.awayGoalsInExtraTime);
        if (g1) {
          outcome = tieOutcome(
            {
              rules: { ...r, awayGoals },
              leg: 2,
              firstLeg: { homeGoals: g1.get(first.homeId!)!, awayGoals: g1.get(first.awayId!)! },
            },
            lastGoals.get(last.homeId)!,
            lastGoals.get(last.awayId)!,
          );
          if (outcome === 'home' || outcome === 'away') base.awayGoals = legsList.length === 2;
        }
      }
    } catch {
      outcome = null; // placar incompatível com o regulamento: segue para pênaltis/fornecedor
    }
  }
  if (outcome === 'home') return won(last.homeId);
  if (outcome === 'away') return won(last.awayId);

  const pen = last.score?.penalty;
  if (pen?.home != null && pen.away != null && pen.home !== pen.away && last.homeId && last.awayId) {
    const mineHome = last.homeId === teamId;
    const decided = won(pen.home > pen.away ? last.homeId : last.awayId);
    return {
      ...decided,
      penalties: { for: mineHome ? pen.home : pen.away, against: mineHome ? pen.away : pen.home },
    };
  }
  const flagged = last.winnerIds.find((id) => id === teamId || id === opponentId) ?? null;
  return won(flagged);
}

/** Calcula a situação da campanha do time na temporada. */
export function computeCampaign(input: CampaignInput): Campaign | null {
  const { teamId, standing } = input;
  const stages = [...input.stages].filter((s) => depthOf(s.kind) !== undefined).sort(compareStages);
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const played = new Map<string, CampaignStage>();
  for (const e of input.teamEvents) {
    const s = e.stageId ? stageById.get(e.stageId) : undefined;
    if (s) played.set(s.id, s);
  }
  const playedStages = [...played.values()].sort(compareStages);
  const deepest = playedStages.at(-1) ?? null;
  const fromStanding = {
    rank: standing?.rank ?? null,
    points: standing?.points ?? null,
    played: standing?.played ?? null,
    group: standing?.group ?? null,
  };
  const hasDeeperStage = (s: CampaignStage | null) =>
    stages.some((x) => (depthOf(x.kind) ?? -1) > (s ? (depthOf(s.kind) ?? -1) : 1));

  // ── pontos corridos (ou só tabela, sem jogos ligados a fases) ──
  if (!deepest || LEAGUE_KINDS.has(deepest.kind)) {
    if (!deepest && !standing) return null;
    const kind = deepest?.kind ?? 'regular';
    const teamOpen = input.teamEvents.some((e) => isOpen(e.status));
    const pureLeague =
      kind === 'regular' &&
      !stages.some((s) => TIE_KINDS.has(s.kind) && s.kind !== 'qualifying') &&
      (input.rules ? input.rules.format === 'league' : input.competitionType === 'league');
    const common = { stageKind: kind, stageName: deepest?.name ?? null, ...fromStanding, tie: null };
    if (pureLeague) {
      if (teamOpen || input.seasonOpen) return { status: 'league', ...common, advancedFrom: false };
      const title = input.rules?.league?.title ?? true;
      return {
        status: title && standing?.rank === 1 ? 'champion' : 'finished_league',
        ...common,
        advancedFrom: false,
      };
    }
    if (teamOpen) return { status: 'in_progress', ...common, advancedFrom: false };
    // a temporada já avançou para o mata-mata sem o time: eliminado na fase de pontos corridos
    if (hasDeeperStage(deepest)) return { status: 'eliminated', ...common, advancedFrom: false };
    if (input.seasonOpen) return { status: 'in_progress', ...common, advancedFrom: false };
    return { status: 'finished_league', ...common, advancedFrom: false };
  }

  // ── confronto direto: decide pela fase mais profunda disputada ──
  const ties = groupTies(input.tieMatches.filter((m) => m.status !== 'cancelled'));
  let tieMatches: CampaignMatch[] = [];
  for (const [key, list] of ties) {
    if (key.startsWith(`${deepest.id}|`) && list.some((m) => m.homeId === teamId || m.awayId === teamId))
      tieMatches = list as CampaignMatch[];
  }
  const tie = decideTie(teamId, deepest, tieMatches, input.rules);
  const at = (status: CampaignStatus, extra: Partial<Campaign> = {}): Campaign => ({
    status,
    stageKind: deepest.kind,
    stageName: deepest.name,
    rank: null,
    points: null,
    played: null,
    group: null,
    tie,
    advancedFrom: false,
    ...extra,
  });
  if (!tie || tie.state === 'pending' || tie.state === 'unknown') return at('in_progress');
  if (deepest.kind === 'final') return at(tie.state === 'won' ? 'champion' : 'runner_up');
  if (deepest.kind === 'third_place')
    return tie.state === 'won' ? at('third_place', { rank: 3 }) : at('eliminated', { rank: 4 });
  if (tie.state === 'lost') return at('eliminated');

  // venceu e aguarda a próxima fase (ex.: classificado para a final ainda sem jogo marcado)
  const next =
    stages.find((s) => compareStages(s, deepest) > 0 && s.kind !== 'third_place') ??
    (NEXT_KIND[deepest.kind]
      ? { id: '', kind: NEXT_KIND[deepest.kind]!, order: 0, name: null, providerLabel: null }
      : null);
  return at('in_progress', {
    stageKind: next?.kind ?? null,
    stageName: next?.name ?? null,
    advancedFrom: true,
  });
}

/** A campanha ainda está em disputa (vem primeiro na lista). */
export function isOngoing(c: Pick<Campaign, 'status'>): boolean {
  return c.status === 'in_progress' || c.status === 'league';
}
