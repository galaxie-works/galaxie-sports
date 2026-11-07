import type { Stake, StakeFamily, StakeSide } from './codes.js';
import { englishOrdinal, titleOrdinal } from './titles.js';

/**
 * Rótulos fixos (não gerados) dos códigos de stakes, para os 8 mercados da API e para `en` (catálogo fixo,
 * tradução humana, sem LLM).
 * Placeholders: `{n}` (número; nas famílias de resultado, posição ou pontos), `{goals}` ("1 gol" / "2 gols"), `{zone}` (nome da zona com artigo),
 * `{ord}` (posição: "2nd" em `en`, o número nos demais), `{nth}` (o título de número n: "tetracampeonato", "11º título"; ver `titleOrdinal`).
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
  'en',
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
  wins_title_with_draw: 'Empate dá o título',
  wins_title_with_loss_by_n: 'É campeão mesmo perdendo por até {goals} de diferença',
  needs_win_for_title: 'Vitória no tempo normal dá o título',
  needs_win_by_n_for_title: 'Vitória por {goals} ou mais no tempo normal dá o título',
  wins_title_with_draw_up_to_n: {
    zero: 'Empate sem gols dá o título',
    other: 'Empate de até {n} a {n} dá o título',
  },
  wins_title_with_draw_from_n: 'Empate de {n} a {n} ou com mais gols dá o título',
  title_depends_on_away_goals: 'Com vitória por {goals}, o título depende dos gols fora',
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
  seeks_title_n: { zero: 'Busca o primeiro título', one: 'Busca o primeiro título', other: 'Busca o {nth}' },
  // resultado (jogo encerrado): o que o placar mudou na tabela
  moved_up_to_n: 'Subiu para o {n}º lugar',
  moved_down_to_n: 'Caiu para o {n}º lugar',
  stayed_at_n: 'Segue em {n}º lugar',
  took_the_lead: 'Assumiu a liderança',
  lost_the_lead: 'Perdeu a liderança',
  entered_zone: 'Passou a ocupar vaga para {zone}',
  left_zone: 'Deixou de ocupar vaga para {zone}',
  dropped_into_relegation: 'Entrou na zona de rebaixamento',
  climbed_out_of_relegation: 'Saiu da zona de rebaixamento',
  dropped_into_elimination: 'Entrou na zona de eliminação',
  climbed_out_of_elimination: 'Saiu da zona de eliminação',
  clinched_title: 'Garantiu o título matematicamente',
  clinched_zone: 'Garantiu ao menos {zone} matematicamente',
  clinched_safety: 'Garantiu a permanência matematicamente',
  relegation_confirmed: 'Teve o rebaixamento confirmado',
  elimination_confirmed: 'Teve a eliminação confirmada',
  lost_title_chance: 'Não pode mais ser campeão',
  lost_zone_chance: 'Não alcança mais {zone}',
  points_behind_leader_n: {
    zero: 'Fica empatado em pontos com o líder',
    one: 'Fica a 1 ponto do líder',
    other: 'Fica a {n} pontos do líder',
  },
  points_ahead_at_top_n: {
    zero: 'Lidera empatado em pontos com o vice-líder',
    one: 'Lidera com 1 ponto de vantagem',
    other: 'Lidera com {n} pontos de vantagem',
  },
  points_behind_zone_n: {
    zero: 'Fica empatado em pontos com o último na vaga para {zone}',
    one: 'Fica a 1 ponto da vaga para {zone}',
    other: 'Fica a {n} pontos da vaga para {zone}',
  },
  points_above_relegation_n: {
    zero: 'Fica fora da zona de rebaixamento só pelos critérios de desempate',
    one: 'Fica 1 ponto acima da zona de rebaixamento',
    other: 'Fica {n} pontos acima da zona de rebaixamento',
  },
  points_below_safety_n: {
    zero: 'Fica na zona de rebaixamento, empatado em pontos com o primeiro fora dela',
    one: 'Fica a 1 ponto de sair da zona de rebaixamento',
    other: 'Fica a {n} pontos de sair da zona de rebaixamento',
  },
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
  wins_title_with_draw: 'Con el empate es campeón',
  wins_title_with_loss_by_n: 'Es campeón incluso perdiendo por hasta {goals} de diferencia',
  needs_win_for_title: 'Si gana en el tiempo reglamentario, es campeón',
  needs_win_by_n_for_title: 'Si gana por {goals} o más en el tiempo reglamentario, es campeón',
  wins_title_with_draw_up_to_n: {
    zero: 'Con empate sin goles es campeón',
    other: 'Con empate de hasta {n} a {n} es campeón',
  },
  wins_title_with_draw_from_n: 'Con empate de {n} a {n} o con más goles es campeón',
  title_depends_on_away_goals: 'Si gana por {goals}, el título depende de los goles de visitante',
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
  seeks_title_n: {
    zero: 'Va por su primer título',
    one: 'Va por su primer título',
    other: 'Va por el {nth}',
  },
  // resultado (partido terminado): lo que el marcador cambió en la tabla
  moved_up_to_n: 'Subió al puesto {n}',
  moved_down_to_n: 'Bajó al puesto {n}',
  stayed_at_n: 'Sigue en el puesto {n}',
  took_the_lead: 'Pasó a ser líder',
  lost_the_lead: 'Dejó de ser líder',
  entered_zone: 'Ahora ocupa un lugar para {zone}',
  left_zone: 'Ya no ocupa un lugar para {zone}',
  dropped_into_relegation: 'Entró en la zona de descenso',
  climbed_out_of_relegation: 'Salió de la zona de descenso',
  dropped_into_elimination: 'Entró en la zona de eliminación',
  climbed_out_of_elimination: 'Salió de la zona de eliminación',
  clinched_title: 'Se aseguró el título matemáticamente',
  clinched_zone: 'Se aseguró al menos {zone} matemáticamente',
  clinched_safety: 'Se aseguró la permanencia matemáticamente',
  relegation_confirmed: 'Se confirmó su descenso',
  elimination_confirmed: 'Se confirmó su eliminación',
  lost_title_chance: 'Ya no puede ser campeón',
  lost_zone_chance: 'Ya no puede alcanzar {zone}',
  points_behind_leader_n: {
    zero: 'Queda igualado en puntos con el líder',
    one: 'Queda a 1 punto del líder',
    other: 'Queda a {n} puntos del líder',
  },
  points_ahead_at_top_n: {
    zero: 'Es líder, igualado en puntos con el segundo',
    one: 'Es líder con 1 punto de ventaja',
    other: 'Es líder con {n} puntos de ventaja',
  },
  points_behind_zone_n: {
    zero: 'Queda igualado en puntos con el último lugar para {zone}',
    one: 'Queda a 1 punto de un lugar para {zone}',
    other: 'Queda a {n} puntos de un lugar para {zone}',
  },
  points_above_relegation_n: {
    zero: 'Queda fuera de la zona de descenso solo por los criterios de desempate',
    one: 'Queda 1 punto por encima de la zona de descenso',
    other: 'Queda {n} puntos por encima de la zona de descenso',
  },
  points_below_safety_n: {
    zero: 'Queda en zona de descenso, igualado en puntos con el primero que se salva',
    one: 'Queda a 1 punto de salir de la zona de descenso',
    other: 'Queda a {n} puntos de salir de la zona de descenso',
  },
};

/** Inglês: um só catálogo (sem variantes regionais). */
const EN: Record<StakeFamily, LabelTemplate> = {
  first_leg: 'First leg of the tie',
  advances_with_draw: 'Goes through with a draw',
  advances_with_loss_by_n: 'Goes through even losing by up to {goals}',
  needs_win: 'Must win to go through outright',
  needs_win_by_n: 'Must win by {goals} to go through outright',
  win_by_n_goes_to_penalties: 'A win by {goals} sends the tie to penalties',
  win_by_n_goes_to_extra_time: 'A win by {goals} sends the match to extra time',
  draw_goes_to_penalties: 'A draw sends the tie to penalties',
  draw_goes_to_extra_time: 'A draw sends the match to extra time',
  advances_with_draw_up_to_n: {
    zero: 'Goes through with a goalless draw',
    other: 'Goes through with a draw of up to {n}-{n}',
  },
  advances_with_draw_from_n: 'Goes through with a {n}-{n} draw or any higher-scoring draw',
  specific_draw_goes_to_penalties: {
    zero: 'A goalless draw sends the tie to penalties',
    other: 'A {n}-{n} draw sends the tie to penalties',
  },
  specific_draw_goes_to_extra_time: {
    zero: 'A goalless draw sends the match to extra time',
    other: 'A {n}-{n} draw sends the match to extra time',
  },
  outcome_depends_on_away_goals: 'With a win by {goals}, the tie comes down to away goals',
  away_goals_rule: 'Away goals count as a tiebreaker',
  extra_time_then_penalties: 'If level, extra time and then penalties',
  decides_title: 'The title is on the line',
  wins_title_with_draw: 'A draw wins the title',
  wins_title_with_loss_by_n: 'Wins the title even losing by up to {goals}',
  needs_win_for_title: 'A win in normal time wins the title',
  needs_win_by_n_for_title: 'A win by {goals} or more in normal time wins the title',
  wins_title_with_draw_up_to_n: {
    zero: 'A goalless draw wins the title',
    other: 'A draw of up to {n}-{n} wins the title',
  },
  wins_title_with_draw_from_n: 'A {n}-{n} draw or any higher-scoring draw wins the title',
  title_depends_on_away_goals: 'With a win by {goals}, the title comes down to away goals',
  mathematically_champion: 'Already champions, mathematically',
  clinches_title_with_draw: 'A draw clinches the title',
  clinches_title_with_win: 'A win clinches the title',
  can_clinch_title: 'Can clinch the title this matchday, depending on other results',
  in_title_race: 'Still in the title race',
  qualifies_for_zone: 'Secures at least {zone}',
  clinches_zone_with_draw: 'A draw secures {zone}',
  clinches_zone_with_win: 'A win secures {zone}',
  can_clinch_zone: 'Can secure {zone} this matchday, depending on other results',
  can_qualify_for_zone: 'Can still reach {zone}',
  mathematically_relegated: 'Already relegated, mathematically',
  relegated_unless_wins: 'Relegated without a win',
  relegated_if_loses: 'Relegated with a defeat',
  can_be_relegated: 'Can be relegated this matchday, depending on other results',
  at_risk_of_relegation: 'Still at risk of relegation',
  secures_safety_with_draw: 'A draw secures safety',
  secures_safety_with_win: 'A win secures safety',
  can_secure_safety: 'Can secure safety this matchday, depending on other results',
  safe_from_relegation: 'Already safe from relegation',
  mathematically_eliminated: 'Already eliminated, mathematically',
  eliminated_unless_wins: 'Eliminated without a win',
  eliminated_if_loses: 'Eliminated with a defeat',
  can_be_eliminated: 'Can be eliminated this matchday, depending on other results',
  at_risk_of_elimination: 'Still at risk of elimination',
  seeks_title_n: { zero: 'Chasing a first title', one: 'Chasing a first title', other: 'Chasing {nth}' },
  // result (match over): what the score changed in the table
  moved_up_to_n: 'Moved up to {ord} place',
  moved_down_to_n: 'Dropped to {ord} place',
  stayed_at_n: 'Stays in {ord} place',
  took_the_lead: 'Took the lead of the table',
  lost_the_lead: 'Lost the lead of the table',
  entered_zone: 'Now in a spot for {zone}',
  left_zone: 'No longer in a spot for {zone}',
  dropped_into_relegation: 'Dropped into the relegation zone',
  climbed_out_of_relegation: 'Climbed out of the relegation zone',
  dropped_into_elimination: 'Dropped into the elimination zone',
  climbed_out_of_elimination: 'Climbed out of the elimination zone',
  clinched_title: 'Clinched the title, mathematically',
  clinched_zone: 'Secured at least {zone}, mathematically',
  clinched_safety: 'Secured safety, mathematically',
  relegation_confirmed: 'Relegation confirmed',
  elimination_confirmed: 'Elimination confirmed',
  lost_title_chance: 'Can no longer win the title',
  lost_zone_chance: 'Can no longer reach {zone}',
  points_behind_leader_n: {
    zero: 'Level on points with the leaders',
    one: '1 point behind the leaders',
    other: '{n} points behind the leaders',
  },
  points_ahead_at_top_n: {
    zero: 'Top of the table, level on points with second place',
    one: 'Top of the table by 1 point',
    other: 'Top of the table by {n} points',
  },
  points_behind_zone_n: {
    zero: 'Level on points with the last spot for {zone}',
    one: '1 point off a spot for {zone}',
    other: '{n} points off a spot for {zone}',
  },
  points_above_relegation_n: {
    zero: 'Out of the relegation zone only on tiebreakers',
    one: '1 point above the relegation zone',
    other: '{n} points above the relegation zone',
  },
  points_below_safety_n: {
    zero: 'In the relegation zone, level on points with the first safe team',
    one: '1 point from climbing out of the relegation zone',
    other: '{n} points from climbing out of the relegation zone',
  },
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
    needs_win_for_title: 'Con una victoria en el tiempo reglamentario es campeón',
    needs_win_by_n_for_title: 'Con una victoria por {goals} o más en el tiempo reglamentario es campeón',
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
  en: EN,
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

const ZONE_EN: Record<string, string> = {
  libertadores: 'the Libertadores',
  libertadores_group_stage: 'the Libertadores group stage',
  libertadores_qualifying: 'the Libertadores qualifying rounds',
  sudamericana: 'the Sudamericana',
  sudamericana_knockout_playoff: 'the Sudamericana play-offs',
  round_of_16: 'the round of 16',
  knockout_playoff: 'the knockout play-offs',
  champions_league: 'the Champions League',
  champions_league_qualifying: 'the Champions League qualifying rounds',
  europa_league: 'the Europa League',
  europa_league_knockout_playoff: 'the Europa League play-offs',
  conference_league: 'the Conference League',
  promotion: 'promotion',
  playoff: 'the play-offs',
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
  en: ZONE_EN,
};

/** Idioma do locale, para plural de gols e ordinal do título. */
const langOf = (locale: StakeLocale): 'pt' | 'es' | 'en' =>
  locale === 'pt-BR' ? 'pt' : locale === 'en' ? 'en' : 'es';

function pickTemplate(t: LabelTemplate, n: number | undefined): string {
  if (typeof t === 'string') return t;
  if (n === 0 && t.zero) return t.zero;
  if (n === 1 && t.one) return t.one;
  return t.other;
}

function goals(locale: StakeLocale, n: number): string {
  const lang = langOf(locale);
  if (lang === 'en') return `${n} ${n === 1 ? 'goal' : 'goals'}`;
  return `${n} ${n === 1 ? 'gol' : lang === 'pt' ? 'gols' : 'goles'}`;
}

export function zoneLabel(zone: string, locale: StakeLocale): string {
  return ZONE_LABELS[locale][zone] ?? zone.replace(/_/g, ' ');
}

/** Texto fixo do código no locale (interpolação de parâmetros, sem geração livre). */
export function stakeText(stake: Pick<Stake, 'family' | 'params'>, locale: StakeLocale): string {
  const template = pickTemplate(STAKE_LABELS[locale][stake.family], stake.params?.n);
  return template.replace(/\{(n|nth|ord|goals|zone)\}/g, (_, key: string) => {
    const n = stake.params?.n;
    if (key === 'zone') return stake.params?.zone ? zoneLabel(stake.params.zone, locale) : '';
    if (n === undefined) return '';
    if (key === 'nth') return titleOrdinal(n, langOf(locale));
    if (key === 'ord') return langOf(locale) === 'en' ? englishOrdinal(n) : String(n);
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
