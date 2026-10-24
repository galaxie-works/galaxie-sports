import type { LeagueRules } from '../config/types.js';
import type { Stake, StakeFamily, StakeSide } from './codes.js';
import { STAKE_LOCALES, type LabelTemplate } from './labels.js';
import type { LeagueTeamInput } from './league.js';
import { titleOrdinal } from './titles.js';

/**
 * Tags do torcedor ("fan tags"): rótulos curtos (até ~30 caracteres), escritos do ponto de vista de
 * quem torce para o time, derivados dos stakes por uma tabela fixa — nada de texto livre. Servem para
 * o card de chamada personalizado pelo clube do torcedor (ex.: "Na briga pelo título" para a torcida do
 * líder e "Luta contra o rebaixamento" para a do adversário). Tabela completa em docs/rules/tags-torcedor.md.
 *
 * Regras: stakes `both` valem para os dois participantes; tags idênticas são fundidas (fica a de menor
 * `priority`); ordem por relevância — título > rebaixamento > eliminação/classificação no mata-mata >
 * vaga continental/acesso > demais; no máximo 3 por participante.
 */

/** Locales das tags: os 8 mercados da API mais `en` (reserva da cadeia de fallback). */
export const FAN_TAG_LOCALES = [...STAKE_LOCALES, 'en'] as const;
export type FanTagLocale = (typeof FAN_TAG_LOCALES)[number];

/** Faixas de relevância (a `priority` da tag = base da faixa + ordem dentro dela; menor = mais importante). */
export const FAN_TAG_TIERS = {
  title: 10,
  relegation: 20,
  knockout: 30,
  qualification: 40,
  other: 50,
} as const;
export type FanTagTier = keyof typeof FAN_TAG_TIERS;

/** Máximo de tags por participante. */
export const MAX_FAN_TAGS = 3;

export interface FanTag {
  /** Código do stake de origem (o de maior relevância, quando vários geram a mesma tag). */
  code: string;
  /** Menor = mais importante. */
  priority: number;
  text: Partial<Record<FanTagLocale, string>>;
}

/** Textos-base: pt-BR, espanhol rioplatense (`es`, base dos mercados es-*) e inglês. */
type BaseTexts = { 'pt-BR': LabelTemplate; es: LabelTemplate; en: LabelTemplate };

interface FamilyTag {
  tier: FanTagTier;
  /** Ordem dentro da faixa (0–9). */
  rank: number;
  text: BaseTexts;
}

/** Verbo das famílias de zona: vaga garantida, pode garantir nesta rodada, ainda em disputa. */
type ZoneVerb = 'secured' | 'clinch' | 'chasing';
const ZONE_VERB_RANK: Record<ZoneVerb, number> = { clinch: 0, chasing: 3, secured: 6 };

/**
 * Tabela família → tag. `zone` delega à tabela de zonas; `null` = código só informativo, sem tag
 * (`extra_time_then_penalties` descreve o regulamento, não a situação do time).
 */
const FAMILY_TAGS: Record<StakeFamily, FamilyTag | { zone: ZoneVerb } | null> = {
  // ── título ──
  mathematically_champion: {
    tier: 'title',
    rank: 0,
    text: { 'pt-BR': 'Já é campeão', es: 'Ya es campeón', en: 'Already champions' },
  },
  decides_title: {
    tier: 'title',
    rank: 1,
    text: { 'pt-BR': 'Vale o título', es: 'Se juega el título', en: 'Title on the line' },
  },
  // final: variantes de título dos códigos de mata-mata ("avança" vira "é campeão")
  wins_title_with_draw: {
    tier: 'title',
    rank: 2,
    text: { 'pt-BR': 'Empate dá o título', es: 'Con el empate es campeón', en: 'A draw wins the title' },
  },
  wins_title_with_draw_up_to_n: {
    tier: 'title',
    rank: 2,
    text: {
      'pt-BR': { zero: '0 a 0 dá o título', other: 'Empate até {n} a {n} dá o título' },
      es: { zero: 'El 0 a 0 le da el título', other: 'Empate hasta {n} a {n}: campeón' },
      en: { zero: 'A 0-0 draw wins the title', other: 'A draw up to {n}-{n} wins it' },
    },
  },
  wins_title_with_draw_from_n: {
    tier: 'title',
    rank: 2,
    text: {
      'pt-BR': { one: 'Empate com gols dá o título', other: 'Empate de {n} a {n} ou mais serve' },
      es: { one: 'El empate con goles le sirve', other: 'Le sirve empate {n} a {n} o más' },
      en: { one: 'A scoring draw wins the title', other: 'A {n}-{n} draw or more wins it' },
    },
  },
  wins_title_with_loss_by_n: {
    tier: 'title',
    rank: 2,
    text: {
      'pt-BR': 'Pode perder por até {goals}',
      es: 'Puede perder por hasta {goals}',
      en: 'Can lose by up to {goals}',
    },
  },
  needs_win_for_title: {
    tier: 'title',
    rank: 3,
    text: { 'pt-BR': 'Precisa vencer', es: 'Necesita ganar', en: 'Must win' },
  },
  needs_win_by_n_for_title: {
    tier: 'title',
    rank: 3,
    text: {
      'pt-BR': 'Precisa vencer por {goals}',
      es: 'Necesita ganar por {goals}',
      en: 'Must win by {goals}',
    },
  },
  title_depends_on_away_goals: {
    tier: 'title',
    rank: 6,
    text: { 'pt-BR': 'Gol fora pesa', es: 'Pesa el gol de visitante', en: 'Away goals count' },
  },
  clinches_title_with_draw: {
    tier: 'title',
    rank: 2,
    text: { 'pt-BR': 'Empate dá o título', es: 'Con un empate es campeón', en: 'A draw seals the title' },
  },
  clinches_title_with_win: {
    tier: 'title',
    rank: 3,
    text: { 'pt-BR': 'Vitória dá o título', es: 'Si gana, es campeón', en: 'A win seals the title' },
  },
  can_clinch_title: {
    tier: 'title',
    rank: 4,
    text: { 'pt-BR': 'Pode ser campeão hoje', es: 'Puede ser campeón hoy', en: 'Could be champions today' },
  },
  // "Busca o tetra": títulos anteriores da competição (Wikidata), em jogo que pode dar o título
  seeks_title_n: {
    tier: 'title',
    rank: 4,
    text: {
      'pt-BR': { zero: 'Busca o 1º título', one: 'Busca o 1º título', other: 'Busca o {nth}' },
      es: { zero: 'Va por su primer título', one: 'Va por su primer título', other: 'Va por el {nth}' },
      en: { zero: 'Chasing a first title', one: 'Chasing a first title', other: 'Chasing title No. {n}' },
    },
  },
  in_title_race: {
    tier: 'title',
    rank: 5,
    text: { 'pt-BR': 'Na briga pelo título', es: 'En la pelea por el título', en: 'In the title race' },
  },

  // ── rebaixamento ──
  mathematically_relegated: {
    tier: 'relegation',
    rank: 0,
    text: { 'pt-BR': 'Já rebaixado', es: 'Ya descendió', en: 'Already relegated' },
  },
  relegated_unless_wins: {
    tier: 'relegation',
    rank: 1,
    text: { 'pt-BR': 'Vencer ou cair', es: 'Ganar o descender', en: 'Win or go down' },
  },
  relegated_if_loses: {
    tier: 'relegation',
    rank: 2,
    text: { 'pt-BR': 'Não pode perder', es: 'No puede perder', en: "Can't afford to lose" },
  },
  can_be_relegated: {
    tier: 'relegation',
    rank: 3,
    text: { 'pt-BR': 'Pode ser rebaixado hoje', es: 'Puede descender hoy', en: 'Could go down today' },
  },
  secures_safety_with_draw: {
    tier: 'relegation',
    rank: 4,
    text: {
      'pt-BR': 'Empate garante a permanência',
      es: 'Con un empate se salva',
      en: 'A draw keeps them up',
    },
  },
  secures_safety_with_win: {
    tier: 'relegation',
    rank: 5,
    text: { 'pt-BR': 'Vitória garante a permanência', es: 'Si gana, se salva', en: 'A win keeps them up' },
  },
  can_secure_safety: {
    tier: 'relegation',
    rank: 6,
    text: { 'pt-BR': 'Pode se salvar hoje', es: 'Puede salvarse hoy', en: 'Could stay up today' },
  },
  at_risk_of_relegation: {
    tier: 'relegation',
    rank: 7,
    text: { 'pt-BR': 'Luta contra o rebaixamento', es: 'Pelea por no descender', en: 'Fighting relegation' },
  },

  // ── eliminação e classificação (mata-mata, grupos e fase de liga) ──
  mathematically_eliminated: {
    tier: 'knockout',
    rank: 0,
    text: { 'pt-BR': 'Já eliminado', es: 'Ya está eliminado', en: 'Already out' },
  },
  needs_win: {
    tier: 'knockout',
    rank: 1,
    text: { 'pt-BR': 'Precisa vencer', es: 'Necesita ganar', en: 'Must win' },
  },
  eliminated_unless_wins: {
    tier: 'knockout',
    rank: 1,
    text: { 'pt-BR': 'Precisa vencer', es: 'Necesita ganar', en: 'Must win' },
  },
  needs_win_by_n: {
    tier: 'knockout',
    rank: 1,
    text: {
      'pt-BR': 'Precisa vencer por {goals}',
      es: 'Necesita ganar por {goals}',
      en: 'Must win by {goals}',
    },
  },
  eliminated_if_loses: {
    tier: 'knockout',
    rank: 2,
    text: { 'pt-BR': 'Não pode perder', es: 'No puede perder', en: "Can't afford to lose" },
  },
  can_be_eliminated: {
    tier: 'knockout',
    rank: 3,
    text: {
      'pt-BR': 'Pode ser eliminado hoje',
      es: 'Puede quedar afuera hoy',
      en: 'Could be knocked out today',
    },
  },
  advances_with_draw: {
    tier: 'knockout',
    rank: 4,
    text: { 'pt-BR': 'Avança com empate', es: 'Avanza con el empate', en: 'A draw is enough' },
  },
  advances_with_draw_up_to_n: {
    tier: 'knockout',
    rank: 4,
    text: {
      'pt-BR': { zero: 'Avança com 0 a 0', other: 'Avança com empate até {n} a {n}' },
      es: { zero: 'Avanza con el 0 a 0', other: 'Avanza con empate hasta {n} a {n}' },
      en: { zero: 'A 0-0 draw is enough', other: 'A draw up to {n}-{n} is enough' },
    },
  },
  advances_with_draw_from_n: {
    tier: 'knockout',
    rank: 4,
    text: {
      'pt-BR': { one: 'Empate com gols classifica', other: 'Empate de {n} a {n} ou mais serve' },
      es: { one: 'Le sirve el empate con goles', other: 'Le sirve empate {n} a {n} o más' },
      en: { one: 'A scoring draw is enough', other: 'A {n}-{n} draw or more is enough' },
    },
  },
  advances_with_loss_by_n: {
    tier: 'knockout',
    rank: 5,
    text: {
      'pt-BR': 'Pode perder por até {goals}',
      es: 'Puede perder por hasta {goals}',
      en: 'Can lose by up to {goals}',
    },
  },
  win_by_n_goes_to_penalties: {
    tier: 'knockout',
    rank: 6,
    text: {
      'pt-BR': 'Vencer por {n} leva aos pênaltis',
      es: 'Ganar por {n} lleva a penales',
      en: 'Win by {n} means penalties',
    },
  },
  win_by_n_goes_to_extra_time: {
    tier: 'knockout',
    rank: 6,
    text: {
      'pt-BR': 'Vencer por {n} leva à prorrogação',
      es: 'Ganar por {n} lleva al alargue',
      en: 'Win by {n} means extra time',
    },
  },
  draw_goes_to_penalties: {
    tier: 'knockout',
    rank: 7,
    text: {
      'pt-BR': 'Empate leva aos pênaltis',
      es: 'El empate lleva a penales',
      en: 'A draw means penalties',
    },
  },
  draw_goes_to_extra_time: {
    tier: 'knockout',
    rank: 7,
    text: {
      'pt-BR': 'Empate leva à prorrogação',
      es: 'El empate lleva al alargue',
      en: 'A draw means extra time',
    },
  },
  specific_draw_goes_to_penalties: {
    tier: 'knockout',
    rank: 8,
    text: {
      'pt-BR': '{n} a {n} leva aos pênaltis',
      es: 'El {n} a {n} lleva a penales',
      en: '{n}-{n} means penalties',
    },
  },
  specific_draw_goes_to_extra_time: {
    tier: 'knockout',
    rank: 8,
    text: {
      'pt-BR': '{n} a {n} leva à prorrogação',
      es: 'El {n} a {n} lleva al alargue',
      en: '{n}-{n} means extra time',
    },
  },
  outcome_depends_on_away_goals: {
    tier: 'knockout',
    rank: 9,
    text: { 'pt-BR': 'Gol fora pesa', es: 'Pesa el gol de visitante', en: 'Away goals count' },
  },
  at_risk_of_elimination: {
    tier: 'knockout',
    rank: 9,
    text: { 'pt-BR': 'Luta pela classificação', es: 'Pelea por clasificar', en: 'Fighting to go through' },
  },

  // ── zonas (vagas continentais, acesso, mata-mata da fase de liga) ──
  qualifies_for_zone: { zone: 'secured' },
  clinches_zone_with_draw: { zone: 'clinch' },
  clinches_zone_with_win: { zone: 'clinch' },
  can_clinch_zone: { zone: 'clinch' },
  can_qualify_for_zone: { zone: 'chasing' },

  // ── demais ──
  first_leg: {
    tier: 'other',
    rank: 0,
    text: { 'pt-BR': 'Jogo de ida', es: 'Partido de ida', en: 'First leg' },
  },
  away_goals_rule: {
    tier: 'other',
    rank: 1,
    text: { 'pt-BR': 'Gol fora pesa', es: 'Pesa el gol de visitante', en: 'Away goals count' },
  },
  // Tranquilidade, não disputa: fica abaixo de qualquer vaga em jogo.
  safe_from_relegation: {
    tier: 'other',
    rank: 2,
    text: { 'pt-BR': 'Livre do rebaixamento', es: 'A salvo del descenso', en: 'Safe from relegation' },
  },
  extra_time_then_penalties: null,
};

type ZoneTexts = Record<ZoneVerb, string>;
interface ZoneTag {
  tier: Extract<FanTagTier, 'knockout' | 'qualification'>;
  /** Peso da zona (0 = principal, 2 = secundária) somado ao verbo. */
  rank: number;
  text: { 'pt-BR': ZoneTexts; es: ZoneTexts; en: ZoneTexts };
}

/** Tags por grupo de zona (os ids vêm de `config/rules/*.yaml`). */
const ZONE_TAGS = {
  libertadores: {
    tier: 'qualification',
    rank: 0,
    text: {
      'pt-BR': {
        secured: 'Garantido na Libertadores',
        clinch: 'Pode garantir a Libertadores',
        chasing: 'De olho na Libertadores',
      },
      es: {
        secured: 'Clasificado a la Libertadores',
        clinch: 'Puede asegurar la Libertadores',
        chasing: 'En carrera por la Libertadores',
      },
      en: {
        secured: 'Libertadores spot secured',
        clinch: 'Can seal a Libertadores spot',
        chasing: 'Chasing the Libertadores',
      },
    },
  },
  libertadores_qualifying: {
    tier: 'qualification',
    rank: 0,
    text: {
      'pt-BR': {
        secured: 'Garantido na pré-Libertadores',
        clinch: 'Pode garantir a pré-Libertadores',
        chasing: 'De olho na Libertadores',
      },
      es: {
        secured: 'En la previa de la Libertadores',
        clinch: 'Puede asegurar la fase previa',
        chasing: 'En carrera por la Libertadores',
      },
      en: {
        secured: 'In Libertadores qualifying',
        clinch: 'Can seal Libertadores qualifying',
        chasing: 'Chasing the Libertadores',
      },
    },
  },
  sudamericana: {
    tier: 'qualification',
    rank: 1,
    text: {
      'pt-BR': {
        secured: 'Garantido na Sul-Americana',
        clinch: 'Pode garantir a Sul-Americana',
        chasing: 'De olho na Sul-Americana',
      },
      es: {
        secured: 'Clasificado a la Sudamericana',
        clinch: 'Puede asegurar la Sudamericana',
        chasing: 'En carrera por la Sudamericana',
      },
      en: {
        secured: 'Sudamericana spot secured',
        clinch: 'Can seal a Sudamericana spot',
        chasing: 'Chasing the Sudamericana',
      },
    },
  },
  champions_league: {
    tier: 'qualification',
    rank: 0,
    text: {
      'pt-BR': {
        secured: 'Garantido na Champions',
        clinch: 'Pode garantir a Champions',
        chasing: 'De olho na Champions',
      },
      es: {
        secured: 'Clasificado a la Champions',
        clinch: 'Puede asegurar la Champions',
        chasing: 'En carrera por la Champions',
      },
      en: {
        secured: 'Champions League spot secured',
        clinch: 'Can seal a Champions spot',
        chasing: 'Chasing the Champions League',
      },
    },
  },
  champions_league_qualifying: {
    tier: 'qualification',
    rank: 0,
    text: {
      'pt-BR': {
        secured: 'Garantido na pré-Champions',
        clinch: 'Pode garantir a pré-Champions',
        chasing: 'De olho na Champions',
      },
      es: {
        secured: 'En la previa de la Champions',
        clinch: 'Puede asegurar la fase previa',
        chasing: 'En carrera por la Champions',
      },
      en: {
        secured: 'In Champions League qualifying',
        clinch: 'Can seal UCL qualifying',
        chasing: 'Chasing the Champions League',
      },
    },
  },
  europa_league: {
    tier: 'qualification',
    rank: 1,
    text: {
      'pt-BR': {
        secured: 'Garantido na Europa League',
        clinch: 'Pode garantir a Europa League',
        chasing: 'De olho na Europa League',
      },
      es: {
        secured: 'Clasificado a la Europa League',
        clinch: 'Puede asegurar la Europa League',
        chasing: 'En carrera por la Europa League',
      },
      en: {
        secured: 'Europa League spot secured',
        clinch: 'Can seal a Europa League spot',
        chasing: 'Chasing the Europa League',
      },
    },
  },
  conference_league: {
    tier: 'qualification',
    rank: 2,
    text: {
      'pt-BR': {
        secured: 'Garantido na Conference',
        clinch: 'Pode garantir a Conference',
        chasing: 'De olho na Conference',
      },
      es: {
        secured: 'Clasificado a la Conference',
        clinch: 'Puede asegurar la Conference',
        chasing: 'En carrera por la Conference',
      },
      en: {
        secured: 'Conference spot secured',
        clinch: 'Can seal a Conference spot',
        chasing: 'Chasing the Conference League',
      },
    },
  },
  promotion: {
    tier: 'qualification',
    rank: 0,
    text: {
      'pt-BR': {
        secured: 'Acesso garantido',
        clinch: 'Pode garantir o acesso',
        chasing: 'De olho no acesso',
      },
      es: {
        secured: 'Ascenso asegurado',
        clinch: 'Puede asegurar el ascenso',
        chasing: 'En carrera por el ascenso',
      },
      en: { secured: 'Promotion secured', clinch: 'Can seal promotion', chasing: 'Chasing promotion' },
    },
  },
  round_of_16: {
    tier: 'knockout',
    rank: 0,
    text: {
      'pt-BR': {
        secured: 'Garantido nas oitavas',
        clinch: 'Pode garantir as oitavas',
        chasing: 'De olho nas oitavas',
      },
      es: {
        secured: 'Clasificado a octavos',
        clinch: 'Puede asegurar los octavos',
        chasing: 'En carrera por los octavos',
      },
      en: {
        secured: 'Through to the last 16',
        clinch: 'Can seal a last-16 spot',
        chasing: 'Chasing the last 16',
      },
    },
  },
  knockout_playoff: {
    tier: 'knockout',
    rank: 1,
    text: {
      'pt-BR': {
        secured: 'Garantido nos playoffs',
        clinch: 'Pode garantir os playoffs',
        chasing: 'De olho nos playoffs',
      },
      es: {
        secured: 'Clasificado al repechaje',
        clinch: 'Puede asegurar el repechaje',
        chasing: 'En carrera por el repechaje',
      },
      en: {
        secured: 'Into the playoffs',
        clinch: 'Can seal a playoff spot',
        chasing: 'Chasing a playoff spot',
      },
    },
  },
  playoff: {
    tier: 'knockout',
    rank: 1,
    text: {
      'pt-BR': {
        secured: 'Garantido nos playoffs',
        clinch: 'Pode garantir os playoffs',
        chasing: 'De olho nos playoffs',
      },
      es: {
        secured: 'Clasificado a los playoffs',
        clinch: 'Puede asegurar los playoffs',
        chasing: 'En carrera por los playoffs',
      },
      en: {
        secured: 'Into the playoffs',
        clinch: 'Can seal a playoff spot',
        chasing: 'Chasing a playoff spot',
      },
    },
  },
  /** Zona sem grupo conhecido: tag genérica de vaga. */
  generic: {
    tier: 'qualification',
    rank: 2,
    text: {
      'pt-BR': { secured: 'Vaga garantida', clinch: 'Pode garantir a vaga', chasing: 'Briga por vaga' },
      es: { secured: 'Lugar asegurado', clinch: 'Puede asegurar su lugar', chasing: 'Pelea por un lugar' },
      en: { secured: 'Spot secured', clinch: 'Can seal a spot', chasing: 'Chasing a spot' },
    },
  },
} as const satisfies Record<string, ZoneTag>;
export type FanTagZoneGroup = keyof typeof ZONE_TAGS;

/** Id da zona do regulamento → grupo de tags. */
const ZONE_GROUP: Record<string, FanTagZoneGroup> = {
  libertadores: 'libertadores',
  libertadores_group_stage: 'libertadores',
  libertadores_qualifying: 'libertadores_qualifying',
  sudamericana: 'sudamericana',
  sudamericana_knockout_playoff: 'sudamericana',
  champions_league: 'champions_league',
  champions_league_qualifying: 'champions_league_qualifying',
  europa_league: 'europa_league',
  europa_league_knockout_playoff: 'europa_league',
  conference_league: 'conference_league',
  promotion: 'promotion',
  round_of_16: 'round_of_16',
  knockout_playoff: 'knockout_playoff',
  playoff: 'playoff',
};

export function fanTagZoneGroup(zone: string): FanTagZoneGroup {
  return ZONE_GROUP[zone] ?? 'generic';
}

/**
 * Variações regionais do espanhol (como nos rótulos dos stakes): prorrogação = alargue (AR, UY, CL),
 * tiempos extra (MX), tiempo extra (CO, EC), suplementario (PE); "lucha" no México; liguilla (MX).
 */
function extraTime(word: string): Partial<Record<StakeFamily, LabelTemplate>> {
  return {
    win_by_n_goes_to_extra_time: `Ganar por {n}: ${word}`,
    draw_goes_to_extra_time: `El empate lleva a ${word}`,
    specific_draw_goes_to_extra_time: `El {n} a {n}: ${word}`,
  };
}
const ES_OVERRIDES: Partial<Record<FanTagLocale, Partial<Record<StakeFamily, LabelTemplate>>>> = {
  'es-MX': { ...extraTime('tiempos extra'), in_title_race: 'En la lucha por el título' },
  'es-CO': extraTime('tiempo extra'),
  'es-EC': extraTime('tiempo extra'),
  'es-PE': extraTime('suplementario'),
};
const ES_ZONE_OVERRIDES: Partial<Record<FanTagLocale, Partial<Record<FanTagZoneGroup, ZoneTexts>>>> = {
  'es-MX': {
    playoff: {
      secured: 'Clasificado a la liguilla',
      clinch: 'Puede asegurar la liguilla',
      chasing: 'En carrera por la liguilla',
    },
  },
};

/** Chave da tabela-base para o locale: pt-BR, `es` (todos os es-*) ou en. */
function baseKey(locale: FanTagLocale): keyof BaseTexts {
  if (locale === 'pt-BR') return 'pt-BR';
  return locale.startsWith('es-') ? 'es' : 'en';
}

function pickTemplate(t: LabelTemplate, n: number | undefined): string {
  if (typeof t === 'string') return t;
  if (n === 0 && t.zero) return t.zero;
  if (n === 1 && t.one) return t.one;
  return t.other;
}

function goals(locale: FanTagLocale, n: number): string {
  const key = baseKey(locale);
  if (key === 'en') return `${n} ${n === 1 ? 'goal' : 'goals'}`;
  return `${n} ${n === 1 ? 'gol' : key === 'pt-BR' ? 'gols' : 'goles'}`;
}

function interpolate(template: string, locale: FanTagLocale, n: number | undefined): string {
  return template.replace(/\{(n|nth|goals)\}/g, (_, key: string) => {
    if (n === undefined) return '';
    if (key === 'nth') return titleOrdinal(n, baseKey(locale) === 'pt-BR' ? 'pt' : 'es', true);
    return key === 'goals' ? goals(locale, n) : String(n);
  });
}

/** Tag de um stake isolado (sem fusão nem corte), ou null se o código não gera tag. */
export function fanTagOf(
  stake: Pick<Stake, 'family' | 'code' | 'params'>,
  locales: readonly FanTagLocale[] = FAN_TAG_LOCALES,
): FanTag | null {
  const rule = FAMILY_TAGS[stake.family];
  if (!rule) return null;
  const n = stake.params?.n;
  const text: Partial<Record<FanTagLocale, string>> = {};
  if ('zone' in rule) {
    const group = fanTagZoneGroup(stake.params?.zone ?? '');
    const zt: ZoneTag = ZONE_TAGS[group];
    for (const l of locales) {
      text[l] = (ES_ZONE_OVERRIDES[l]?.[group] ?? zt.text[baseKey(l)])[rule.zone];
    }
    return { code: stake.code, priority: FAN_TAG_TIERS[zt.tier] + ZONE_VERB_RANK[rule.zone] + zt.rank, text };
  }
  for (const l of locales) {
    const template = ES_OVERRIDES[l]?.[stake.family] ?? rule.text[baseKey(l)];
    text[l] = interpolate(pickTemplate(template, n), l, n);
  }
  return { code: stake.code, priority: FAN_TAG_TIERS[rule.tier] + rule.rank, text };
}

// ─── relevância para o torcedor (pontos corridos) ────────────────────────────────────────────────
//
// Os stakes de mera possibilidade (`in_title_race`, `at_risk_of_relegation`, `can_qualify_for_*`) são
// matemáticos: com 7 rodadas, o 4º a 16 pontos do líder ainda "briga pelo título" e o 9º a 10 pontos do
// Z4 ainda "corre risco". Na tag do torcedor isso soa falso, então ela exige proximidade real na tabela.
// Os stakes e as frases não mudam; as tags decisivas (pode ser campeão hoje, vencer ou cair…) valem sempre.

/** Título: distância máxima (pontos) para o líder = max(este piso, rodadas restantes do time). */
export const FAN_TAG_TITLE_MIN_GAP = 6;
/** Rebaixamento: distância máxima (pontos) acima do primeiro time dentro da zona. */
export const FAN_TAG_RELEGATION_MAX_GAP = 6;
/** Vaga ("De olho na X"): distância máxima para o último time dentro da zona = max(piso, rodadas restantes). */
export const FAN_TAG_ZONE_MIN_GAP = 6;

/** Situação do time na tabela, usada para filtrar as tags de mera possibilidade. */
export interface FanTagStanding {
  points: number;
  /** Posição (1 = líder). */
  rank: number;
  /** Rodadas que faltam para o time (null se o regulamento não diz quantos jogos há). */
  remaining: number | null;
  /** Pontos do líder (null em tabela sem título, ex.: fase de grupos). */
  leaderPoints: number | null;
  /** Primeira posição da zona de rebaixamento e os pontos de quem a ocupa (null sem zona). */
  relegation: { from: number; points: number } | null;
  /** Zona boa → pontos do último time dentro dela (posição `to`). */
  zoneLinePoints: Record<string, number>;
}

/**
 * Situação de `teamId` na tabela (em ordem de classificação: posição = índice + 1) com as zonas do
 * regulamento. Time fora da tabela → null (sem filtro).
 */
export function fanTagStanding(
  table: readonly LeagueTeamInput[],
  league: Pick<LeagueRules, 'matchesPerTeam' | 'title' | 'zones'>,
  teamId: string,
): FanTagStanding | null {
  const i = table.findIndex((t) => t.teamId === teamId);
  if (i < 0) return null;
  const team = table[i]!;
  const pointsAt = (rank: number) => table[rank - 1]?.points;
  const relegationFrom = Math.min(...league.zones.filter((z) => z.kind === 'relegation').map((z) => z.from));
  const relegationPoints = Number.isFinite(relegationFrom) ? pointsAt(relegationFrom) : undefined;
  const zoneLinePoints: Record<string, number> = {};
  for (const z of league.zones) {
    if (z.kind === 'relegation' || z.kind === 'relegation_playoff' || z.kind === 'elimination') continue;
    const p = pointsAt(z.to);
    if (p !== undefined) zoneLinePoints[z.id] = p;
  }
  return {
    points: team.points,
    rank: i + 1,
    remaining: league.matchesPerTeam === null ? null : Math.max(0, league.matchesPerTeam - team.played),
    leaderPoints: league.title ? (table[0]?.points ?? null) : null,
    relegation: relegationPoints !== undefined ? { from: relegationFrom, points: relegationPoints } : null,
    zoneLinePoints,
  };
}

/**
 * O stake é relevante para o torcedor? Título (`in_title_race`): até max(6, rodadas restantes) do
 * líder. Rebaixamento e permanência (`at_risk_of_relegation`, `secures_safety_with_*`,
 * `can_secure_safety`, `safe_from_relegation`): dentro da zona ou até 6 pontos acima do primeiro time
 * nela — "Vitória garante a permanência" não faz sentido para o 4º colocado. Vaga: até
 * max(6, rodadas restantes) do último time dentro da zona. Demais códigos (inclusive os decisivos): sim.
 */
export function isRelevantForFans(
  stake: Pick<Stake, 'family' | 'params'>,
  standing: FanTagStanding | null | undefined,
): boolean {
  if (!standing) return true;
  const window = (floor: number) => Math.max(floor, standing.remaining ?? 0);
  switch (stake.family) {
    case 'in_title_race':
      return (
        standing.leaderPoints === null ||
        standing.leaderPoints - standing.points <= window(FAN_TAG_TITLE_MIN_GAP)
      );
    case 'at_risk_of_relegation':
    case 'secures_safety_with_draw':
    case 'secures_safety_with_win':
    case 'can_secure_safety':
    case 'safe_from_relegation':
      return (
        standing.relegation === null ||
        standing.rank >= standing.relegation.from ||
        standing.points - standing.relegation.points <= FAN_TAG_RELEGATION_MAX_GAP
      );
    case 'can_qualify_for_zone': {
      const line = stake.params?.zone ? standing.zoneLinePoints[stake.params.zone] : undefined;
      return line === undefined || line - standing.points <= window(FAN_TAG_ZONE_MIN_GAP);
    }
    default:
      return true;
  }
}

/**
 * Tags do torcedor de um participante (`home` ou `away`) a partir dos stakes da partida: inclui os
 * `both`, descarta as possibilidades distantes quando há `standing` (ver `isRelevantForFans`), funde
 * tags de texto idêntico (fica a mais relevante), ordena por `priority` (empate: ordem dos stakes, que
 * é determinística) e corta em `max`.
 */
export function fanTags(
  stakes: readonly Pick<Stake, 'team' | 'family' | 'code' | 'params'>[],
  side: Exclude<StakeSide, 'both'>,
  locales: readonly FanTagLocale[] = FAN_TAG_LOCALES,
  max: number = MAX_FAN_TAGS,
  standing?: FanTagStanding | null,
): FanTag[] {
  const byText = new Map<string, FanTag>();
  for (const stake of stakes) {
    if (stake.team !== side && stake.team !== 'both') continue;
    if (!isRelevantForFans(stake, standing)) continue;
    const tag = fanTagOf(stake, locales);
    if (!tag) continue;
    const key = locales.map((l) => tag.text[l] ?? '').join('\u0000');
    const seen = byText.get(key);
    if (!seen || tag.priority < seen.priority) byText.set(key, tag);
  }
  return [...byText.values()]
    .map((tag, i) => ({ tag, i }))
    .sort((a, b) => a.tag.priority - b.tag.priority || a.i - b.i)
    .slice(0, Math.max(0, max))
    .map(({ tag }) => tag);
}
