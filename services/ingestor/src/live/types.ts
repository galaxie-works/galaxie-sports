/**
 * Tipos do ao vivo (docs/07 §2.1): candidatos lidos do core, plano do dia do Live Scheduler e
 * decisões de *tick* do Live Poller. Tudo aqui é dado puro — sem banco, sem relógio do sistema.
 */
import type { EventClock, EventScore, EventStatus, StatusSource } from '@galaxie/providers';

/** Prioridade ao vivo do catálogo (`core.competition.live_priority`). */
export type LivePriority = 'high' | 'medium' | 'low' | 'none';

/** Um evento do dia (ou de amanhã) que pode entrar numa janela ao vivo. */
export interface LiveCandidate {
  /** `core.event.id`. */
  eventId: string;
  /** ID do evento no provedor (ex.: `fixture.id` da api-sports); `null` = sem vínculo com o provedor. */
  providerEventId: string | null;
  sport: string;
  competitionId: string | null;
  /** ID da competição no provedor — vai no `fixtures?live=<ids>`. */
  providerCompetitionId: string | null;
  seasonId: string | null;
  /** Horário oficial do início. */
  startsAt: Date;
  status: EventStatus;
  /**
   * Origem do status: `temporal` = avançado pelo relógio dos eventos sem confirmação da fonte (ex.: encerrado
   * em `ends_at_expected` sem dado fresco). Ausente = desconhecida (tratada como da fonte).
   */
  statusSource?: StatusSource | undefined;
  /** Código do fornecedor (NS, 1H, HT, 2H, ET, BT, P, FT...). */
  statusDetail: string | null;
  clock: EventClock | null;
  score: EventScore | null;
  /** Última observação válida (alinha o relógio de jogo com o relógio de parede). */
  lastValidAt: Date | null;
  tier: number | null;
  livePriority: LivePriority;
  /** `core.stage.kind` (regular, group, final...). */
  stageKind: string | null;
  derby: boolean;
  /** `core.event.importance` (0–100). */
  importance: number;
  /** "Mandante x Visitante" (logs e relatórios). */
  label: string | null;
}

/** Janela ao vivo de um evento, já ajustada ao estado atual (instantes absolutos). */
export interface MatchWindow {
  eventId: string;
  start: Date;
  /** Fim firme (tempo normal + margem; ou prorrogação/pênaltis já confirmados). */
  end: Date;
  /** Fim contingente (mata-mata que pode ir à prorrogação/pênaltis); `null` = sem extensão. */
  contingentEnd: Date | null;
  /** Fases com peso: 0 = pular (intervalo), 1 = normal, 2 = reta final/prorrogação/pênaltis. */
  phases: { start: Date; end: Date; weight: number }[];
}

export interface PlannedMatch {
  candidate: LiveCandidate;
  window: MatchWindow;
  /** Posição na ordem de prioridade (0 = mais importante). */
  rank: number;
}

export type ExclusionReason = 'not_relevant' | 'terminal' | 'outside_day' | 'budget' | 'no_provider_ids';

export interface ExcludedMatch {
  eventId: string;
  label: string | null;
  reason: ExclusionReason;
}

/** Trecho contínuo de janelas sobrepostas (já unidas). */
export interface WindowSegment {
  start: Date;
  end: Date;
  /** IDs (do provedor) das competições com jogo neste trecho — o `live=` dos ticks. */
  leagues: string[];
  eventIds: string[];
}

export interface LiveBudget {
  dailyLimit: number;
  reserve: number;
  /** Saldo protegido para o sync diário (o ao vivo nunca o consome). */
  protectedDaily: number;
  /** Orçamento LIVE total do dia (inclui o que já foi gasto) — enviado ao `governor.plan`. */
  liveTotal: number;
  liveUsed: number;
  /**
   * Chamadas guardadas para confirmar o resultado final de cada jogo (`fixtures?id=` ao sair do live): 1 por
   * jogo, até 1/4 do saldo; jogo em andamento garante a sua fora desse teto.
   */
  finalizeReserve: number;
  /** Cada tick custa 1 chamada, ou 2 com o detalhe do jogo em destaque. */
  tickCost: number;
  /** Ticks que ainda cabem no orçamento. */
  ticksLeft: number;
}

/** Plano do dia do Live Scheduler (determinístico para a mesma entrada). */
export interface LiveDayPlan {
  sport: string;
  /** Dia de cota (UTC, YYYY-MM-DD). */
  day: string;
  generatedAt: Date;
  dayStart: Date;
  dayEnd: Date;
  relevant: number;
  included: PlannedMatch[];
  excluded: ExcludedMatch[];
  /** Janelas unidas, recortadas ao dia de cota. */
  segments: WindowSegment[];
  /** Minutos de janela (unidas) que restam no dia, a partir de `generatedAt`. */
  windowMinutes: number;
  /** Soma dos pesos por minuto que restam (base do intervalo). */
  weightedMinutes: number;
  /** Minutos com peso > 0 que restam (teto de ticks úteis a 15 s). */
  activeMinutes: number;
  budget: LiveBudget;
  /** Detalhe (`fixtures?id=`) do jogo mais importante a cada tick. */
  featured: boolean;
  /** Intervalo de um minuto de peso 1 (ms); `Infinity` sem orçamento. */
  baseIntervalMs: number;
  /** Intervalo médio = minutos de janela ÷ ticks (ms), limitado ao mínimo. */
  nominalIntervalMs: number;
  /** O que mandar ao `governor.plan` para o dia. */
  quotaPlan: { LIVE: number; DAILY: number };
}

/** Estado de execução que o plano puro não conhece (mantido pelo runner). */
export interface RuntimeHints {
  /** Quando cada evento foi visto pela primeira vez no intervalo (HT). */
  halftimeSeenAt?: ReadonlyMap<string, Date>;
}

export type TickDecision =
  | {
      kind: 'tick';
      leagues: string[];
      /** Eventos em janela ativa (acompanhados neste tick). */
      eventIds: string[];
      weight: number;
      intervalMs: number;
    }
  | {
      kind: 'wait';
      until: Date;
      reason: 'interval' | 'gap' | 'halftime' | 'budget';
      /** Há janela ativa agora (só esperando o intervalo/intervalo de jogo). */
      active: boolean;
    }
  | { kind: 'done'; reason: 'no_windows' | 'day_over' };

/**
 * Reordena os candidatos quando há mais jogos relevantes do que orçamento (ex.: LLM leve).
 * Devolve IDs (`eventId`) em ordem de prioridade; IDs desconhecidos são ignorados e os que faltarem
 * entram depois, na ordem determinística. Se lançar, o algoritmo base segue sozinho.
 */
export type LivePrioritizer = (input: {
  sport: string;
  day: string;
  candidates: LiveCandidate[];
  /** Ticks que o orçamento comporta (contexto para a decisão). */
  ticksAvailable: number;
}) => Promise<string[]>;
