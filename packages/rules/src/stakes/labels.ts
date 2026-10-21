import type { Stake, StakeFamily, StakeSide } from './codes.js';

/**
 * Rótulos fixos (não gerados) dos códigos de stakes, para os 8 mercados da API.
 * Placeholders: `{n}` (número), `{goals}` ("1 gol" / "2 gols"), `{zone}` (nome da zona com artigo).
 * Variantes por número: `zero` (n = 0), `one` (n = 1), `other`.
 */
export const STAKE_LOCALES = [
  'pt-BR',
  'es-AR',
  'es-MX',
  'es-CO',
  'es-CL',
  'es-PE',
  'es-UY',
  'es-EC',
] as const;
export type StakeLocale = (typeof STAKE_LOCALES)[number];

export type LabelTemplate = string | { zero?: string; one?: string; other: string };

const PT_BR: Record<StakeFamily, LabelTemplate> = {
  first_leg: 'Jogo de ida do confronto',
  advances_with_draw: 'Avança com empate',
  advances_with_loss_by_n: 'Avança mesmo perdendo por até {goals} de diferença',
  needs_win: 'Precisa vencer para avançar direto',
  needs_win_by_n: 'Precisa vencer por {goals} para avançar direto',
  win_by_n_goes_to_penalties: 'Vitória por {goals} leva a decisão aos pênaltis',
  win_by_n_goes_to_extra_time: 'Vitória por {goals} leva o jogo à prorrogação',
  draw_goes_to_penalties: 'Empate leva a decisão aos pênaltis',
  draw_goes_to_extra_time: 'Empate leva o jogo à prorrogação',
  advances_with_draw_up_to_n: {
    zero: 'Avança com empate sem gols',
    other: 'Avança com empate de até {n} a {n}',
  },
  advances_with_draw_from_n: 'Avança com empate de {n} a {n} ou com mais gols',
  specific_draw_goes_to_penalties: {
    zero: 'Empate sem gols leva a decisão aos pênaltis',
    other: 'Empate por {n} a {n} leva a decisão aos pênaltis',
  },
  specific_draw_goes_to_extra_time: {
    zero: 'Empate sem gols leva o jogo à prorrogação',
    other: 'Empate por {n} a {n} leva o jogo à prorrogação',
  },
  outcome_depends_on_away_goals: 'Com vitória por {goals}, a vaga depende dos gols fora',
  away_goals_rule: 'Gol fora de casa é critério de desempate',
  extra_time_then_penalties: 'Em caso de igualdade, prorrogação e depois pênaltis',
  decides_title: 'Vale o título',
  mathematically_champion: 'Já é campeão matematicamente',
  clinches_title_with_draw: 'Empate garante o título',
  clinches_title_with_win: 'Vitória garante o título',
  can_clinch_title: 'Pode ser campeão nesta rodada, dependendo de outros resultados',
  in_title_race: 'Ainda briga pelo título',
  qualifies_for_zone: 'Garante ao menos {zone}',
  clinches_zone_with_draw: 'Empate garante {zone}',
  clinches_zone_with_win: 'Vitória garante {zone}',
  can_clinch_zone: 'Pode garantir {zone} nesta rodada, dependendo de outros resultados',
  can_qualify_for_zone: 'Ainda pode garantir {zone}',
  mathematically_relegated: 'Já está rebaixado matematicamente',
  relegated_unless_wins: 'É rebaixado se não vencer',
  relegated_if_loses: 'É rebaixado em caso de derrota',
  can_be_relegated: 'Pode ser rebaixado nesta rodada, dependendo de outros resultados',
  at_risk_of_relegation: 'Ainda corre risco de rebaixamento',
  secures_safety_with_draw: 'Empate garante a permanência',
  secures_safety_with_win: 'Vitória garante a permanência',
  can_secure_safety: 'Pode garantir a permanência nesta rodada, dependendo de outros resultados',
  safe_from_relegation: 'Já está livre do rebaixamento',
  mathematically_eliminated: 'Já está eliminado matematicamente',
  eliminated_unless_wins: 'É eliminado se não vencer',
  eliminated_if_loses: 'É eliminado em caso de derrota',
  can_be_eliminated: 'Pode ser eliminado nesta rodada, dependendo de outros resultados',
  at_risk_of_elimination: 'Ainda corre risco de eliminação',
};

/** Espanhol rioplatense como base; os demais mercados sobrescrevem só o que muda. */
const ES_AR: Record<StakeFamily, LabelTemplate> = {
  first_leg: 'Partido de ida de la serie',
  advances_with_draw: 'Avanza con el empate',
  advances_with_loss_by_n: 'Avanza incluso perdiendo por hasta {goals} de diferencia',
  needs_win: 'Necesita ganar para avanzar directo',
  needs_win_by_n: 'Necesita ganar por {goals} para avanzar directo',
  win_by_n_goes_to_penalties: 'Ganar por {goals} lleva la definición a los penales',
  win_by_n_goes_to_extra_time: 'Ganar por {goals} lleva el partido al alargue',
  draw_goes_to_penalties: 'El empate lleva la definición a los penales',
  draw_goes_to_extra_time: 'El empate lleva el partido al alargue',
  advances_with_draw_up_to_n: {
    zero: 'Avanza con empate sin goles',
    other: 'Avanza con empate de hasta {n} a {n}',
  },
  advances_with_draw_from_n: 'Avanza con empate de {n} a {n} o con más goles',
  specific_draw_goes_to_penalties: {
    zero: 'El 0 a 0 lleva la definición a los penales',
    other: 'El empate {n} a {n} lleva la definición a los penales',
  },
  specific_draw_goes_to_extra_time: {
    zero: 'El 0 a 0 lleva el partido al alargue',
    other: 'El empate {n} a {n} lleva el partido al alargue',
  },
  outcome_depends_on_away_goals: 'Si gana por {goals}, la clasificación depende de los goles de visitante',
  away_goals_rule: 'El gol de visitante es criterio de desempate',
  extra_time_then_penalties: 'Si hay igualdad, alargue y después penales',
  decides_title: 'Se define el campeón',
  mathematically_champion: 'Ya es campeón matemáticamente',
  clinches_title_with_draw: 'Con un empate es campeón',
  clinches_title_with_win: 'Si gana, es campeón',
  can_clinch_title: 'Puede ser campeón en esta fecha, según otros resultados',
  in_title_race: 'Sigue en la pelea por el título',
  qualifies_for_zone: 'Asegura al menos {zone}',
  clinches_zone_with_draw: 'Con un empate asegura {zone}',
  clinches_zone_with_win: 'Si gana, asegura {zone}',
  can_clinch_zone: 'Puede asegurar {zone} en esta fecha, según otros resultados',
  can_qualify_for_zone: 'Todavía puede conseguir {zone}',
  mathematically_relegated: 'Ya descendió matemáticamente',
  relegated_unless_wins: 'Desciende si no gana',
  relegated_if_loses: 'Desciende si pierde',
  can_be_relegated: 'Puede descender en esta fecha, según otros resultados',
  at_risk_of_relegation: 'Todavía corre riesgo de descenso',
  secures_safety_with_draw: 'Con un empate asegura la permanencia',
  secures_safety_with_win: 'Si gana, asegura la permanencia',
  can_secure_safety: 'Puede asegurar la permanencia en esta fecha, según otros resultados',
  safe_from_relegation: 'Ya está a salvo del descenso',
  mathematically_eliminated: 'Ya está eliminado matemáticamente',
  eliminated_unless_wins: 'Queda eliminado si no gana',
  eliminated_if_loses: 'Queda eliminado si pierde',
  can_be_eliminated: 'Puede quedar eliminado en esta fecha, según otros resultados',
  at_risk_of_elimination: 'Todavía corre riesgo de eliminación',
};

/** Prorrogação: alargue (AR, UY, CL), tiempos extra (MX), tiempo extra (CO, EC), tiempo suplementario (PE). */
function extraTime(word: string): Partial<Record<StakeFamily, LabelTemplate>> {
  return {
    win_by_n_goes_to_extra_time: `Ganar por {goals} lleva el partido ${word}`,
    draw_goes_to_extra_time: `El empate lleva el partido ${word}`,
    specific_draw_goes_to_extra_time: {
      zero: `El 0 a 0 lleva el partido ${word}`,
      other: `El empate {n} a {n} lleva el partido ${word}`,
    },
  };
}

/** Rodada: "jornada" no México, "fecha" no restante da América do Sul. */
const JORNADA: Partial<Record<StakeFamily, LabelTemplate>> = {
  can_clinch_title: 'Puede ser campeón en esta jornada, según otros resultados',
  can_clinch_zone: 'Puede asegurar {zone} en esta jornada, según otros resultados',
  can_be_relegated: 'Puede descender en esta jornada, según otros resultados',
  can_secure_safety: 'Puede asegurar la permanencia en esta jornada, según otros resultados',
  can_be_eliminated: 'Puede quedar eliminado en esta jornada, según otros resultados',
};

function variant(overrides: Partial<Record<StakeFamily, LabelTemplate>>): Record<StakeFamily, LabelTemplate> {
  return { ...ES_AR, ...overrides };
}

export const STAKE_LABELS: Record<StakeLocale, Record<StakeFamily, LabelTemplate>> = {
  'pt-BR': PT_BR,
  'es-AR': ES_AR,
  'es-MX': variant({
    ...extraTime('a tiempos extra'),
    ...JORNADA,
    extra_time_then_penalties: 'Si hay igualdad, tiempos extra y luego penales',
    in_title_race: 'Sigue en la lucha por el título',
    clinches_title_with_win: 'Con una victoria es campeón',
    clinches_zone_with_win: 'Con una victoria asegura {zone}',
    secures_safety_with_win: 'Con una victoria asegura la permanencia',
  }),
  'es-CO': variant({
    ...extraTime('al tiempo extra'),
    extra_time_then_penalties: 'Si hay igualdad, tiempo extra y luego penales',
    in_title_race: 'Sigue en la pelea por el título',
  }),
  'es-CL': variant({
    ...extraTime('al alargue'),
    extra_time_then_penalties: 'Si hay igualdad, alargue y luego penales',
  }),
  'es-PE': variant({
    ...extraTime('al tiempo suplementario'),
    extra_time_then_penalties: 'Si hay igualdad, tiempo suplementario y luego penales',
  }),
  'es-UY': variant({ ...extraTime('al alargue') }),
  'es-EC': variant({
    ...extraTime('al tiempo extra'),
    extra_time_then_penalties: 'Si hay igualdad, tiempo extra y luego penales',
  }),
};

/** Nomes das zonas com artigo, para compor `{zone}`. Zona desconhecida usa o id. */
const ZONE_PT: Record<string, string> = {
  libertadores: 'a Libertadores',
  libertadores_group_stage: 'a fase de grupos da Libertadores',
  libertadores_qualifying: 'a pré-Libertadores',
  sudamericana: 'a Sul-Americana',
  sudamericana_knockout_playoff: 'os playoffs da Sul-Americana',
  round_of_16: 'as oitavas de final',
  knockout_playoff: 'os playoffs do mata-mata',
  champions_league: 'a Champions League',
  champions_league_qualifying: 'as preliminares da Champions League',
  europa_league: 'a Europa League',
  europa_league_knockout_playoff: 'os playoffs da Europa League',
  conference_league: 'a Conference League',
  promotion: 'o acesso',
  playoff: 'os playoffs',
};

const ZONE_ES: Record<string, string> = {
  libertadores: 'la Libertadores',
  libertadores_group_stage: 'la fase de grupos de la Libertadores',
  libertadores_qualifying: 'la fase previa de la Libertadores',
  sudamericana: 'la Sudamericana',
  sudamericana_knockout_playoff: 'el repechaje de la Sudamericana',
  round_of_16: 'los octavos de final',
  knockout_playoff: 'el repechaje de eliminación directa',
  champions_league: 'la Champions League',
  champions_league_qualifying: 'la fase previa de la Champions League',
  europa_league: 'la Europa League',
  europa_league_knockout_playoff: 'el repechaje de la Europa League',
  conference_league: 'la Conference League',
  promotion: 'el ascenso',
  playoff: 'los playoffs',
};

export const ZONE_LABELS: Record<StakeLocale, Record<string, string>> = {
  'pt-BR': ZONE_PT,
  'es-AR': ZONE_ES,
  'es-MX': { ...ZONE_ES, playoff: 'la liguilla' },
  'es-CO': ZONE_ES,
  'es-CL': ZONE_ES,
  'es-PE': ZONE_ES,
  'es-UY': ZONE_ES,
  'es-EC': ZONE_ES,
};

function pickTemplate(t: LabelTemplate, n: number | undefined): string {
  if (typeof t === 'string') return t;
  if (n === 0 && t.zero) return t.zero;
  if (n === 1 && t.one) return t.one;
  return t.other;
}

function goals(locale: StakeLocale, n: number): string {
  const pt = locale === 'pt-BR';
  return `${n} ${n === 1 ? 'gol' : pt ? 'gols' : 'goles'}`;
}

export function zoneLabel(zone: string, locale: StakeLocale): string {
  return ZONE_LABELS[locale][zone] ?? zone.replace(/_/g, ' ');
}

/** Texto fixo do código no locale (interpolação de parâmetros, sem geração livre). */
export function stakeText(stake: Pick<Stake, 'family' | 'params'>, locale: StakeLocale): string {
  const template = pickTemplate(STAKE_LABELS[locale][stake.family], stake.params?.n);
  return template.replace(/\{(n|goals|zone)\}/g, (_, key: string) => {
    const n = stake.params?.n;
    if (key === 'zone') return stake.params?.zone ? zoneLabel(stake.params.zone, locale) : '';
    if (n === undefined) return '';
    return key === 'goals' ? goals(locale, n) : String(n);
  });
}

export interface LocalizedStake {
  team: StakeSide;
  code: string;
  text: Partial<Record<StakeLocale, string>>;
}

/** Formato do campo `stakes` da API (docs/05 §3.2). */
export function localizeStake(stake: Stake, locales: readonly StakeLocale[] = STAKE_LOCALES): LocalizedStake {
  const text: Partial<Record<StakeLocale, string>> = {};
  for (const locale of locales) text[locale] = stakeText(stake, locale);
  return { team: stake.team, code: stake.code, text };
}

export function isStakeLocale(value: string): value is StakeLocale {
  return (STAKE_LOCALES as readonly string[]).includes(value);
}
