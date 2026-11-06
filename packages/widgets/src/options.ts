// ─── Opções de conteúdo de cada widget (Builder → banco → embed / registry) ───────────────────────
// Cada opção vira uma prop do componente com o mesmo nome. O Builder desenha os controles a partir
// desta lista, o banco guarda `config.options` e o embed e o registry passam as props ao componente.
// Valor ausente = o padrão do componente (o widget fica como era antes da opção existir).

import { TEAM_SPORTS, type SportScoreUnit, type WidgetKind, type WidgetLocale } from './core/model.js';

type Label = Record<WidgetLocale, string>;

interface OptionBase {
  key: string;
  label: Label;
  /** Explicação curta embaixo do controle (opcional). */
  hint?: Label;
  /** Busca uma rota a mais da API quando ligada (gols, estatísticas…). */
  extraCall?: boolean;
  /** Esportes em que a opção faz sentido (ausente = todos): o Builder esconde nos outros. */
  sports?: readonly string[];
  /** Rótulo pela unidade do placar do esporte ("Pontos pró" no basquete, "Sets vencidos" no vôlei). */
  unitLabel?: Partial<Record<SportScoreUnit, Label>>;
}

export type WidgetOptionSpec =
  | (OptionBase & { type: 'boolean'; default: boolean })
  | (OptionBase & { type: 'number'; default: number; min: number; max: number })
  | (OptionBase & { type: 'enum'; default: string; values: readonly { value: string; label: Label }[] })
  | (OptionBase & { type: 'multi'; values: readonly { value: string; label: Label }[] })
  | (OptionBase & { type: 'season' })
  | (OptionBase & { type: 'team' | 'competition' });

export type WidgetOptions = Record<string, string | number | boolean>;

const l = (pt: string, es: string, en: string): Label => ({ 'pt-BR': pt, es, en });

const bool = (key: string, label: Label, def: boolean, extra?: Partial<OptionBase>): WidgetOptionSpec => ({
  key,
  label,
  type: 'boolean',
  default: def,
  ...extra,
});

/** Só no futebol (gols, cartões, posse, formação, regulamento de tabelas). */
const FOOTBALL = { sports: ['football'] } as const;
/** Esportes coletivos com parciais (sets, quartos, tempos, períodos, entradas). */
const WITH_PERIODS = { sports: TEAM_SPORTS.filter((s) => s !== 'football') } as const;

// rótulos que se repetem entre widgets
const L = {
  calendar: l('Botão "adicionar ao calendário"', 'Botón "añadir al calendario"', '"Add to calendar" button'),
  competition: l('Campeonato', 'Competición', 'Competition'),
  competitionLogo: l('Logo do campeonato', 'Logo de la competición', 'Competition logo'),
  stage: l('Rodada ou fase', 'Jornada o fase', 'Round or stage'),
  venue: l('Estádio', 'Estadio', 'Venue'),
};

/** Tipos de vídeo (mesma lista da API, `RELATED_CONTENT_TYPES`). */
export const VIDEO_TYPES = [
  { value: 'analysis', label: l('Análises', 'Análisis', 'Analysis') },
  { value: 'behind_the_scenes', label: l('Bastidores', 'Detrás de escena', 'Behind the scenes') },
  { value: 'press_conference', label: l('Coletivas', 'Conferencias de prensa', 'Press conferences') },
  { value: 'interview', label: l('Entrevistas', 'Entrevistas', 'Interviews') },
  { value: 'goal', label: l('Gols', 'Goles', 'Goals') },
  { value: 'full_match', label: l('Jogo completo', 'Partido completo', 'Full match') },
  { value: 'highlights', label: l('Melhores momentos', 'Mejores momentos', 'Highlights') },
  { value: 'other', label: l('Outros', 'Otros', 'Other') },
  { value: 'penalties', label: l('Pênaltis', 'Penales', 'Penalties') },
  { value: 'fan_reaction', label: l('Reação da torcida', 'Reacción de la hinchada', 'Fan reactions') },
] as const;

export const WIDGET_OPTIONS: Record<WidgetKind, readonly WidgetOptionSpec[]> = {
  match_card: [
    bool('showCompetition', L.competition, true),
    bool('showCompetitionLogo', L.competitionLogo, true),
    bool('showCountry', l('País do campeonato', 'País de la competición', 'Competition country'), false),
    bool('showRound', L.stage, true),
    bool('showVenue', L.venue, true),
    bool('showCity', l('Cidade', 'Ciudad', 'City'), true),
    bool('showReferee', l('Árbitro', 'Árbitro', 'Referee'), false),
    bool(
      'showHalftime',
      l('Placar do 1º tempo', 'Marcador del primer tiempo', 'Half-time score'),
      false,
      FOOTBALL,
    ),
    bool(
      'showAggregate',
      l('Placar agregado (jogo de volta)', 'Global (partido de vuelta)', 'Aggregate score'),
      false,
      FOOTBALL,
    ),
    bool(
      'showPeriods',
      l(
        'Parciais (sets, quartos, entradas)',
        'Parciales (sets, cuartos, entradas)',
        'Line score (sets, quarters, innings)',
      ),
      true,
      WITH_PERIODS,
    ),
    bool(
      'venueTime',
      l('Horário no fuso do estádio', 'Horario del estadio', 'Kick-off in venue time'),
      false,
      {
        hint: l(
          'Mostra também a hora local do jogo quando o fuso do estádio é outro.',
          'Muestra también la hora local cuando el estadio está en otro huso.',
          'Also shows local kick-off time when the venue is in another time zone.',
        ),
      },
    ),
    bool(
      'showGoals',
      l('Gols com autor e minuto', 'Goles con autor y minuto', 'Goals with scorer and minute'),
      false,
      {
        extraCall: true,
        ...FOOTBALL,
      },
    ),
    bool('showRedCards', l('Cartões vermelhos', 'Tarjetas rojas', 'Red cards'), false, {
      extraCall: true,
      ...FOOTBALL,
    }),
    bool('showStats', l('Estatísticas principais', 'Estadísticas principales', 'Key stats'), false, {
      extraCall: true,
      ...FOOTBALL,
      hint: l(
        'Posse, finalizações e no alvo.',
        'Posesión, remates y al arco.',
        'Possession, shots and on target.',
      ),
    }),
    bool('showFormation', l('Formação tática', 'Formación táctica', 'Formation'), false, {
      extraCall: true,
      ...FOOTBALL,
    }),
    bool('showCalendar', L.calendar, false),
  ],
  live_list: [],
  standings: [
    {
      key: 'season',
      type: 'season',
      label: l('Temporada', 'Temporada', 'Season'),
      hint: l('Vazio = temporada atual.', 'Vacío = temporada actual.', 'Empty = current season.'),
    },
    {
      key: 'limit',
      type: 'number',
      default: 0,
      min: 0,
      max: 40,
      label: l('Linhas por tabela', 'Filas por tabla', 'Rows per table'),
      hint: l('0 = todas.', '0 = todas.', '0 = all.'),
    },
    {
      key: 'table',
      type: 'enum',
      default: 'all',
      label: l('Tabela', 'Tabla', 'Table'),
      values: [
        { value: 'annual', label: l('Só a anual (acumulada)', 'Solo la anual (acumulada)', 'Annual only') },
        { value: 'phase', label: l('Só a da fase', 'Solo la de la fase', 'Stage table only') },
        {
          value: 'relegation_average',
          label: l('Só os promedios', 'Solo los promedios', 'Relegation average only'),
        },
        { value: 'all', label: l('Todas', 'Todas', 'All') },
      ],
      ...FOOTBALL,
    },
    bool('showGoalsFor', l('Gols pró', 'Goles a favor', 'Goals for'), false, {
      unitLabel: {
        points: l('Pontos pró', 'Puntos a favor', 'Points for'),
        runs: l('Corridas pró', 'Carreras a favor', 'Runs scored'),
        sets: l('Sets vencidos', 'Sets ganados', 'Sets won'),
      },
    }),
    bool('showGoalsAgainst', l('Gols contra', 'Goles en contra', 'Goals against'), false, {
      unitLabel: {
        points: l('Pontos contra', 'Puntos en contra', 'Points against'),
        runs: l('Corridas contra', 'Carreras en contra', 'Runs allowed'),
        sets: l('Sets perdidos', 'Sets perdidos', 'Sets lost'),
      },
    }),
    bool('showGoalDiff', l('Saldo de gols', 'Diferencia de goles', 'Goal difference'), true, {
      unitLabel: {
        points: l('Saldo de pontos', 'Diferencia de puntos', 'Point difference'),
        runs: l('Saldo de corridas', 'Diferencia de carreras', 'Run difference'),
        sets: l('Saldo de sets', 'Diferencia de sets', 'Set difference'),
      },
    }),
    bool('showForm', l('Forma (últimos 5)', 'Racha (últimos 5)', 'Form (last 5)'), false),
    // onde a tabela é por vitórias (basquete, beisebol, futebol americano) e na AFL, o % sempre aparece
    bool('showPercentage', l('Aproveitamento (%)', 'Rendimiento (%)', 'Points percentage'), false, {
      sports: ['football', 'volleyball', 'hockey', 'handball', 'rugby'],
    }),
    {
      key: 'highlightTeamId',
      type: 'team',
      label: l('Destacar um time', 'Destacar un equipo', 'Highlight a team'),
    },
    bool(
      'showDecisive',
      l(
        'Líder e próximos jogos decisivos',
        'Líder y próximos partidos decisivos',
        'Leader and upcoming decisive games',
      ),
      false,
      { extraCall: true },
    ),
  ],
  where_to_watch: [
    bool('showAddonPrices', l('Preço dos complementos', 'Precio de los complementos', 'Add-on prices'), true),
    bool('showWatchLinks', l('Link "assistir"', 'Enlace "ver"', '"Watch" link'), true),
    bool('showCalendar', L.calendar, false),
  ],
  ai_context: [
    {
      key: 'show',
      type: 'enum',
      default: 'auto',
      label: l('Texto', 'Texto', 'Text'),
      values: [
        {
          value: 'auto',
          label: l(
            'Automático (cenário antes, resumo depois)',
            'Automático (previa antes, resumen después)',
            'Automatic',
          ),
        },
        { value: 'scenario', label: l('Só o cenário', 'Solo la previa', 'Outlook only') },
        { value: 'recap', label: l('Só o resumo', 'Solo el resumen', 'Recap only') },
      ],
    },
    bool('showHeader', l('Escudos no topo', 'Escudos arriba', 'Crests at the top'), true),
    bool(
      'showGeneratedAt',
      l('Hora em que o texto foi escrito', 'Hora en que se escribió', 'When it was written'),
      false,
    ),
  ],
  match_stakes: [
    {
      key: 'stakes',
      type: 'enum',
      default: 'salient',
      label: l('O que está em jogo', 'Qué está en juego', "What's at stake"),
      values: [
        { value: 'salient', label: l('Os 3 principais de cada time', 'Los 3 principales', 'Top 3 per team') },
        { value: 'all', label: l('Todos', 'Todos', 'All') },
      ],
    },
    bool('showFanTags', l('Tags da torcida', 'Etiquetas de la hinchada', 'Fan tags'), true),
    bool('showCheer', l('Grito da arquibancada', 'Grito de la tribuna', 'Chant from the stands'), true),
    bool(
      'showDerbyIntensity',
      l('Intensidade do clássico', 'Intensidad del clásico', 'Derby intensity'),
      false,
    ),
    bool(
      'showResultStakes',
      l('O que o resultado mudou (depois do jogo)', 'Qué cambió el resultado', 'What the result changed'),
      true,
    ),
    bool(
      'showCompetitionContext',
      l('Situação do campeonato', 'Situación de la competición', 'Competition situation'),
      false,
      {
        extraCall: true,
        hint: l(
          'Líder e próximos jogos decisivos.',
          'Líder y próximos partidos decisivos.',
          'Leader and decisive games.',
        ),
      },
    ),
  ],
  related_videos: [
    {
      key: 'limit',
      type: 'number',
      default: 6,
      min: 1,
      max: 20,
      label: l('Quantidade de vídeos', 'Cantidad de videos', 'Number of videos'),
    },
    {
      key: 'format',
      type: 'enum',
      default: 'both',
      label: l('Formato', 'Formato', 'Format'),
      values: [
        { value: 'short', label: l('Só curtos (verticais)', 'Solo cortos (verticales)', 'Shorts only') },
        { value: 'long', label: l('Só longos', 'Solo largos', 'Long only') },
        { value: 'both', label: l('Todos', 'Todos', 'All') },
      ],
    },
    {
      key: 'types',
      type: 'multi',
      label: l('Tipos de vídeo', 'Tipos de video', 'Video types'),
      values: VIDEO_TYPES,
    },
    bool('showDuration', l('Duração', 'Duración', 'Duration'), true),
    bool('showChannel', l('Canal', 'Canal', 'Channel'), true),
    bool('showDate', l('Data de publicação', 'Fecha de publicación', 'Publish date'), false),
  ],
  head_to_head: [
    {
      key: 'limit',
      type: 'number',
      default: 5,
      min: 1,
      max: 20,
      label: l('Confrontos listados', 'Partidos listados', 'Meetings listed'),
    },
    bool('showBar', l('Barra de vitórias', 'Barra de victorias', 'Wins bar'), true),
    bool(
      'showMeetingCompetition',
      l('Campeonato de cada jogo', 'Competición de cada partido', 'Competition per meeting'),
      false,
    ),
    bool('showDerbyName', l('Nome do clássico', 'Nombre del clásico', 'Derby name'), true),
  ],
  team_schedule: [
    {
      key: 'next',
      type: 'number',
      default: 3,
      min: 0,
      max: 10,
      label: l('Próximos jogos', 'Próximos partidos', 'Upcoming matches'),
    },
    {
      key: 'recent',
      type: 'number',
      default: 3,
      min: 0,
      max: 10,
      label: l('Últimos resultados', 'Últimos resultados', 'Latest results'),
    },
    {
      key: 'competitionId',
      type: 'competition',
      label: l('Só um campeonato', 'Solo una competición', 'One competition only'),
    },
    bool('showCompetitionLogo', L.competitionLogo, false),
    bool('showRound', L.stage, false),
    bool('showVenue', L.venue, false),
    bool('showCity', l('Cidade', 'Ciudad', 'City'), false),
    bool(
      'showStanding',
      l('Posição na tabela e forma recente', 'Posición y racha', 'Table position and form'),
      false,
      { extraCall: true },
    ),
    bool('showCalendar', L.calendar, false),
  ],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

/** Um valor de opção vindo de fora (banco, JSON do embed, formulário) → o valor limpo ou undefined. */
function parseValue(spec: WidgetOptionSpec, raw: unknown): string | number | boolean | undefined {
  switch (spec.type) {
    case 'boolean':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
      return Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, Math.round(n))) : undefined;
    }
    case 'enum':
      return typeof raw === 'string' && spec.values.some((v) => v.value === raw) ? raw : undefined;
    case 'multi': {
      if (typeof raw !== 'string') return undefined;
      const picked = [...new Set(raw.split(',').map((s) => s.trim()))].filter((s) =>
        spec.values.some((v) => v.value === s),
      );
      return picked.length ? picked.sort().join(',') : undefined;
    }
    case 'season': {
      const n =
        typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{4}$/.test(raw) ? Number(raw) : NaN;
      return Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : undefined;
    }
    case 'team':
      return typeof raw === 'string' && UUID.test(raw) ? raw.toLowerCase() : undefined;
    case 'competition':
      return typeof raw === 'string' && (UUID.test(raw) || SLUG.test(raw)) ? raw : undefined;
  }
}

/**
 * Opções salvas de um widget, conferidas pela lista do tipo: só chaves conhecidas, com valor válido e
 * diferente do padrão. Nada aproveitável → undefined (a config fica sem `options`).
 */
export function parseWidgetOptions(kind: WidgetKind, raw: unknown): WidgetOptions | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const specs = WIDGET_OPTIONS[kind];
  if (!specs) return undefined;
  const r = raw as Record<string, unknown>;
  const out: WidgetOptions = {};
  for (const spec of specs) {
    const value = parseValue(spec, r[spec.key]);
    if (value === undefined) continue;
    if ('default' in spec && value === spec.default) continue;
    out[spec.key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Props do componente a partir das opções (o formato `both` do vídeo é a ausência do filtro). */
export function optionProps(kind: WidgetKind, options: WidgetOptions | undefined): Record<string, unknown> {
  const clean = parseWidgetOptions(kind, options) ?? {};
  if (kind === 'related_videos' && clean.format === 'both') delete clean.format;
  return clean;
}

/**
 * Opções do tipo que valem para o esporte (sem esporte = todas), com o rótulo na unidade do placar dele.
 * O Builder desenha só estas; as outras ficam salvas e o componente as ignora.
 */
export function widgetOptionsFor(kind: WidgetKind, sport: string | null | undefined, unit?: SportScoreUnit) {
  return (WIDGET_OPTIONS[kind] ?? [])
    .filter((spec) => !sport || !spec.sports || spec.sports.includes(sport))
    .map((spec) => (unit && spec.unitLabel?.[unit] ? { ...spec, label: spec.unitLabel[unit]! } : spec));
}
