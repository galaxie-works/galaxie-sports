import type { EventStatus } from '../../event/status.js';

/**
 * Códigos de status da api-sports football v3 → estado canônico (docs/04 §3).
 * `NS`/`TBD` viram pré-jogo; a máquina de estados decide entre `scheduled` e `starting` pelo horário.
 */
export const API_SPORTS_FOOTBALL_STATUS: Readonly<Record<string, EventStatus>> = {
  TBD: 'scheduled', // horário a definir
  NS: 'scheduled', // não iniciado
  '1H': 'live',
  HT: 'break',
  '2H': 'live',
  ET: 'live', // prorrogação
  BT: 'break', // intervalo antes/durante a prorrogação
  P: 'live', // pênaltis em andamento
  LIVE: 'live', // em andamento, período desconhecido
  SUSP: 'suspended',
  INT: 'suspended', // interrompido (pode ser retomado)
  FT: 'finished',
  AET: 'finished',
  PEN: 'finished',
  AWD: 'finished', // resultado decidido pela organização
  WO: 'finished', // W.O.
  PST: 'postponed',
  CANC: 'cancelled',
  ABD: 'abandoned',
};

/** Códigos que indicam prorrogação/pênaltis (estende `ends_at_expected`). */
export const EXTRA_TIME_CODES: ReadonlySet<string> = new Set(['ET', 'BT', 'P', 'AET', 'PEN']);

export function mapFootballStatus(short: string | null | undefined): EventStatus | null {
  if (!short) return null;
  return API_SPORTS_FOOTBALL_STATUS[short.toUpperCase()] ?? null;
}
