import type { TeamStatistic, TeamStatisticCode } from '@galaxie/contracts';
import { normalizeTeamStatistics } from '@galaxie/providers';
import { pickText } from '../i18n.js';

type I18n = Record<string, string>;

/** Rótulo de cada estatística de time (docs/05 §3.2): pt-BR, espanhol neutro e inglês (fallback). */
export const TEAM_STATISTIC_LABELS: Record<TeamStatisticCode, I18n> = {
  possession_pct: { 'pt-BR': 'Posse de bola', es: 'Posesión', en: 'Possession' },
  shots_total: { 'pt-BR': 'Chutes', es: 'Remates', en: 'Shots' },
  shots_on_goal: { 'pt-BR': 'Chutes no gol', es: 'Remates al arco', en: 'Shots on target' },
  shots_off_goal: { 'pt-BR': 'Chutes para fora', es: 'Remates afuera', en: 'Shots off target' },
  shots_blocked: { 'pt-BR': 'Chutes bloqueados', es: 'Remates bloqueados', en: 'Blocked shots' },
  shots_inside_box: {
    'pt-BR': 'Chutes dentro da área',
    es: 'Remates dentro del área',
    en: 'Shots inside the box',
  },
  shots_outside_box: {
    'pt-BR': 'Chutes de fora da área',
    es: 'Remates desde fuera del área',
    en: 'Shots outside the box',
  },
  xg: { 'pt-BR': 'Gols esperados (xG)', es: 'Goles esperados (xG)', en: 'Expected goals (xG)' },
  goals_prevented: { 'pt-BR': 'Gols evitados', es: 'Goles evitados', en: 'Goals prevented' },
  passes_total: { 'pt-BR': 'Passes', es: 'Pases', en: 'Passes' },
  passes_accurate: { 'pt-BR': 'Passes certos', es: 'Pases precisos', en: 'Accurate passes' },
  pass_accuracy_pct: { 'pt-BR': 'Precisão de passe', es: 'Precisión de pases', en: 'Pass accuracy' },
  corners: { 'pt-BR': 'Escanteios', es: 'Córners', en: 'Corners' },
  free_kicks: { 'pt-BR': 'Tiros livres', es: 'Tiros libres', en: 'Free kicks' },
  fouls: { 'pt-BR': 'Faltas', es: 'Faltas', en: 'Fouls' },
  offsides: { 'pt-BR': 'Impedimentos', es: 'Fueras de juego', en: 'Offsides' },
  yellow_cards: { 'pt-BR': 'Cartões amarelos', es: 'Tarjetas amarillas', en: 'Yellow cards' },
  red_cards: { 'pt-BR': 'Cartões vermelhos', es: 'Tarjetas rojas', en: 'Red cards' },
  saves: { 'pt-BR': 'Defesas', es: 'Atajadas', en: 'Saves' },
};

/** Estatísticas de um time: `type`/`value` crus + código estável, rótulo no locale, número e origem. */
export function teamStatistics(
  raw: readonly { type?: string | null; value?: unknown }[] | null | undefined,
  locale: string,
): TeamStatistic[] {
  return normalizeTeamStatistics(raw).map((s) => ({
    type: s.type,
    value: s.value,
    code: s.code,
    label: s.code ? pickText(TEAM_STATISTIC_LABELS[s.code], locale, s.type)! : s.type,
    numeric: s.numeric,
    source: s.source,
  }));
}
