/**
 * Códigos estruturados de "o que está em jogo" (stakes). Nenhum texto livre é gerado aqui:
 * cada código pertence a uma família com parâmetros (`n`, `zone`), e o texto localizado vem
 * de um mapa fixo de rótulos (labels.ts). Catálogo completo em docs/rules/README.md.
 */

/** Famílias de códigos de mata-mata. */
export const KNOCKOUT_FAMILIES = [
  'first_leg',
  'advances_with_draw',
  'advances_with_loss_by_n',
  'needs_win',
  'needs_win_by_n',
  'win_by_n_goes_to_penalties',
  'win_by_n_goes_to_extra_time',
  'draw_goes_to_penalties',
  'draw_goes_to_extra_time',
  'advances_with_draw_up_to_n',
  'advances_with_draw_from_n',
  'specific_draw_goes_to_penalties',
  'specific_draw_goes_to_extra_time',
  'outcome_depends_on_away_goals',
  'away_goals_rule',
  'extra_time_then_penalties',
  'decides_title',
  // Variantes de título: o confronto decide o campeão (`decides_title`), então ninguém "avança".
  'wins_title_with_draw',
  'wins_title_with_loss_by_n',
  'needs_win_for_title',
  'needs_win_by_n_for_title',
  'wins_title_with_draw_up_to_n',
  'wins_title_with_draw_from_n',
  'title_depends_on_away_goals',
] as const;

/**
 * Família de mata-mata → variante de título, usada quando o confronto decide o campeão
 * (`rules.decidesTitle` no jogo decisivo). Os códigos de "avançar" e "vaga" não fazem sentido numa
 * final; os de prorrogação e pênaltis valem como estão.
 */
export const TITLE_VARIANT_OF = {
  advances_with_draw: 'wins_title_with_draw',
  advances_with_loss_by_n: 'wins_title_with_loss_by_n',
  needs_win: 'needs_win_for_title',
  needs_win_by_n: 'needs_win_by_n_for_title',
  advances_with_draw_up_to_n: 'wins_title_with_draw_up_to_n',
  advances_with_draw_from_n: 'wins_title_with_draw_from_n',
  outcome_depends_on_away_goals: 'title_depends_on_away_goals',
} as const satisfies Partial<Record<(typeof KNOCKOUT_FAMILIES)[number], (typeof KNOCKOUT_FAMILIES)[number]>>;

/** Famílias de códigos de pontos corridos / fase de grupos / fase de liga. */
export const LEAGUE_FAMILIES = [
  'mathematically_champion',
  'clinches_title_with_draw',
  'clinches_title_with_win',
  'can_clinch_title',
  'in_title_race',
  'qualifies_for_zone',
  'clinches_zone_with_draw',
  'clinches_zone_with_win',
  'can_clinch_zone',
  'can_qualify_for_zone',
  'mathematically_relegated',
  'relegated_unless_wins',
  'relegated_if_loses',
  'can_be_relegated',
  'at_risk_of_relegation',
  'secures_safety_with_draw',
  'secures_safety_with_win',
  'can_secure_safety',
  'safe_from_relegation',
  'mathematically_eliminated',
  'eliminated_unless_wins',
  'eliminated_if_loses',
  'can_be_eliminated',
  'at_risk_of_elimination',
] as const;

/**
 * Famílias de histórico: fatos de proveniência externa (títulos por edição do Wikidata) que valem em
 * jogos que podem dar o título, em mata-mata ou pontos corridos.
 */
export const HISTORY_FAMILIES = ['seeks_title_n'] as const;

export const STAKE_FAMILIES = [...KNOCKOUT_FAMILIES, ...LEAGUE_FAMILIES, ...HISTORY_FAMILIES] as const;
export type StakeFamily = (typeof STAKE_FAMILIES)[number];

/** Lado a que o código se refere, relativo ao mando da partida analisada. */
export type StakeSide = 'home' | 'away' | 'both';

export interface StakeParams {
  /** Gols de diferença, placar do empate, número do título buscado etc., conforme a família. */
  n?: number;
  /** Id da zona do regulamento (ex.: libertadores_group_stage). */
  zone?: string;
}

export interface Stake {
  team: StakeSide;
  /** Código concreto, estável para a API: ex. `needs_win_by_2`, `qualifies_for_sudamericana`. */
  code: string;
  family: StakeFamily;
  params?: StakeParams;
}

/** Monta o código concreto a partir da família e dos parâmetros. */
export function stakeCode(family: StakeFamily, params: StakeParams = {}): string {
  const n = params.n;
  const zone = params.zone;
  const need = (what: 'n' | 'zone') => {
    throw new Error(`Família ${family} exige o parâmetro ${what}.`);
  };
  switch (family) {
    case 'advances_with_loss_by_n':
      return `advances_with_loss_by_${n ?? need('n')}`;
    case 'needs_win_by_n':
      return `needs_win_by_${n ?? need('n')}`;
    case 'win_by_n_goes_to_penalties':
      return `win_by_${n ?? need('n')}_goes_to_penalties`;
    case 'win_by_n_goes_to_extra_time':
      return `win_by_${n ?? need('n')}_goes_to_extra_time`;
    case 'advances_with_draw_up_to_n':
      return `advances_with_draw_up_to_${n ?? need('n')}`;
    case 'advances_with_draw_from_n':
      return `advances_with_draw_from_${n ?? need('n')}`;
    case 'specific_draw_goes_to_penalties':
      return `draw_${n ?? need('n')}_${n}_goes_to_penalties`;
    case 'specific_draw_goes_to_extra_time':
      return `draw_${n ?? need('n')}_${n}_goes_to_extra_time`;
    case 'outcome_depends_on_away_goals':
      return `win_by_${n ?? need('n')}_depends_on_away_goals`;
    case 'wins_title_with_loss_by_n':
      return `wins_title_with_loss_by_${n ?? need('n')}`;
    case 'needs_win_by_n_for_title':
      return `needs_win_by_${n ?? need('n')}_for_title`;
    case 'wins_title_with_draw_up_to_n':
      return `wins_title_with_draw_up_to_${n ?? need('n')}`;
    case 'wins_title_with_draw_from_n':
      return `wins_title_with_draw_from_${n ?? need('n')}`;
    case 'title_depends_on_away_goals':
      return `win_by_${n ?? need('n')}_title_depends_on_away_goals`;
    case 'seeks_title_n':
      return `seeks_title_${n ?? need('n')}`;
    case 'qualifies_for_zone':
      return `qualifies_for_${zone ?? need('zone')}`;
    case 'clinches_zone_with_draw':
      return `clinches_${zone ?? need('zone')}_with_draw`;
    case 'clinches_zone_with_win':
      return `clinches_${zone ?? need('zone')}_with_win`;
    case 'can_clinch_zone':
      return `can_clinch_${zone ?? need('zone')}`;
    case 'can_qualify_for_zone':
      return `can_qualify_for_${zone ?? need('zone')}`;
    default:
      return family;
  }
}

export function makeStake(team: StakeSide, family: StakeFamily, params?: StakeParams): Stake {
  const stake: Stake = { team, code: stakeCode(family, params), family };
  if (params && (params.n !== undefined || params.zone !== undefined)) stake.params = { ...params };
  return stake;
}
