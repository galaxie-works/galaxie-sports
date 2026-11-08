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
  | (OptionBase & { type: 'team' | 'competition' })
  | (OptionBase & { type: 'lookup'; source: LookupSource });

/**
 * Escolha por busca nas rotas próprias (fora do catálogo de times e campeonatos): a prova, o cavaleiro e o
 * cavalo do hipismo e a edição dos Jogos. O Builder lista pela API; o valor salvo é o id (ou o slug).
 */
export type LookupSource = 'eq_competition' | 'eq_athlete' | 'eq_horse' | 'games';

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
/** Esportes coletivos (as colunas de gols/pontos da tabela não existem na F1). */
const TEAM = { sports: TEAM_SPORTS } as const;

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

/** Grupos de lance do lance a lance (`match_timeline`), em ordem alfabética do rótulo em português. */
export const TIMELINE_TYPES = [
  { value: 'cards', label: l('Cartões', 'Tarjetas', 'Cards') },
  { value: 'shootout', label: l('Disputa de pênaltis', 'Tanda de penales', 'Penalty shootout') },
  { value: 'goals', label: l('Gols', 'Goles', 'Goals') },
  { value: 'other', label: l('Outros', 'Otros', 'Other') },
  { value: 'missed', label: l('Pênaltis perdidos', 'Penales errados', 'Missed penalties') },
  { value: 'substitutions', label: l('Substituições', 'Cambios', 'Substitutions') },
  { value: 'var', label: l('VAR', 'VAR', 'VAR') },
] as const;

/** Países (código do COI) que os widgets dos Jogos oferecem: a América Latina primeiro, depois os mercados. */
export const GAMES_NOCS = [
  { value: 'BRA', label: l('Brasil', 'Brasil', 'Brazil') },
  { value: 'ARG', label: l('Argentina', 'Argentina', 'Argentina') },
  { value: 'MEX', label: l('México', 'México', 'Mexico') },
  { value: 'COL', label: l('Colômbia', 'Colombia', 'Colombia') },
  { value: 'CHI', label: l('Chile', 'Chile', 'Chile') },
  { value: 'PER', label: l('Peru', 'Perú', 'Peru') },
  { value: 'URU', label: l('Uruguai', 'Uruguay', 'Uruguay') },
  { value: 'PAR', label: l('Paraguai', 'Paraguay', 'Paraguay') },
  { value: 'ECU', label: l('Equador', 'Ecuador', 'Ecuador') },
  { value: 'VEN', label: l('Venezuela', 'Venezuela', 'Venezuela') },
  { value: 'CUB', label: l('Cuba', 'Cuba', 'Cuba') },
  { value: 'DOM', label: l('República Dominicana', 'República Dominicana', 'Dominican Republic') },
  { value: 'PUR', label: l('Porto Rico', 'Puerto Rico', 'Puerto Rico') },
  { value: 'USA', label: l('Estados Unidos', 'Estados Unidos', 'United States') },
  { value: 'CAN', label: l('Canadá', 'Canadá', 'Canada') },
  { value: 'ESP', label: l('Espanha', 'España', 'Spain') },
  { value: 'POR', label: l('Portugal', 'Portugal', 'Portugal') },
] as const;

/**
 * Países do filtro dos clássicos (código da base semântica: ISO2, Inglaterra = GB-ENG). Todos primeiro,
 * depois em ordem alfabética pt-BR.
 */
export const DERBY_COUNTRIES = [
  { value: 'all', label: l('Todos', 'Todos', 'All') },
  { value: 'DE', label: l('Alemanha', 'Alemania', 'Germany') },
  { value: 'AR', label: l('Argentina', 'Argentina', 'Argentina') },
  { value: 'BO', label: l('Bolívia', 'Bolivia', 'Bolivia') },
  { value: 'BR', label: l('Brasil', 'Brasil', 'Brazil') },
  { value: 'CL', label: l('Chile', 'Chile', 'Chile') },
  { value: 'CO', label: l('Colômbia', 'Colombia', 'Colombia') },
  { value: 'EC', label: l('Equador', 'Ecuador', 'Ecuador') },
  { value: 'ES', label: l('Espanha', 'España', 'Spain') },
  { value: 'FR', label: l('França', 'Francia', 'France') },
  { value: 'GB-ENG', label: l('Inglaterra', 'Inglaterra', 'England') },
  { value: 'IT', label: l('Itália', 'Italia', 'Italy') },
  { value: 'MX', label: l('México', 'México', 'Mexico') },
  { value: 'NL', label: l('Países Baixos', 'Países Bajos', 'Netherlands') },
  { value: 'PY', label: l('Paraguai', 'Paraguay', 'Paraguay') },
  { value: 'PE', label: l('Peru', 'Perú', 'Peru') },
  { value: 'PT', label: l('Portugal', 'Portugal', 'Portugal') },
  { value: 'UY', label: l('Uruguai', 'Uruguay', 'Uruguay') },
  { value: 'VE', label: l('Venezuela', 'Venezuela', 'Venezuela') },
] as const;

const games = (): WidgetOptionSpec => ({
  key: 'games',
  type: 'lookup',
  source: 'games',
  label: l('Edição dos Jogos', 'Edición de los Juegos', 'Games edition'),
  hint: l(
    'Vazio = a edição em andamento ou a última.',
    'Vacío = la edición en curso o la última.',
    'Empty = the Games in progress or the latest.',
  ),
});
const noc = (key = 'noc', label = l('País', 'País', 'Country')): WidgetOptionSpec => ({
  key,
  type: 'enum',
  default: 'BRA',
  values: GAMES_NOCS,
  label,
});
const count = (key: string, label: Label, def: number, max: number, hint?: Label): WidgetOptionSpec => ({
  key,
  type: 'number',
  default: def,
  min: 0,
  max,
  label,
  ...(hint ? { hint } : {}),
});
const ALL = l('0 = todos.', '0 = todos.', '0 = all.');

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
  // faixa de placares para TV (#833): o esporte e o campeonato são o recorte do widget (`defaults`)
  score_ticker: [
    {
      key: 'mode',
      type: 'enum',
      default: 'today',
      label: l('Jogos na faixa', 'Partidos en el cintillo', 'Games in the ticker'),
      values: [
        { value: 'live', label: l('Só ao vivo', 'Solo en vivo', 'Live only') },
        {
          value: 'today',
          label: l('Ao vivo e encerrados do dia', 'En vivo y finalizados del día', 'Live and finished today'),
        },
        {
          value: 'all',
          label: l(
            'Todos do dia (com os próximos)',
            'Todos del día (con los próximos)',
            'All of today (with upcoming)',
          ),
        },
      ],
    },
    {
      key: 'speed',
      type: 'enum',
      default: 'normal',
      label: l('Velocidade', 'Velocidad', 'Speed'),
      values: [
        { value: 'slow', label: l('Lenta', 'Lenta', 'Slow') },
        { value: 'normal', label: l('Normal', 'Normal', 'Normal') },
        { value: 'fast', label: l('Rápida', 'Rápida', 'Fast') },
      ],
    },
    bool('transparent', l('Fundo transparente', 'Fondo transparente', 'Transparent background'), false, {
      hint: l(
        'Para sobrepor a faixa ao vídeo da emissora.',
        'Para superponer el cintillo al video del canal.',
        'To overlay the ticker on the broadcast video.',
      ),
    }),
    bool('showLabel', l('Rótulo "Ao vivo"', 'Rótulo "En vivo"', '"Live" label'), true),
    bool('showCompetition', L.competition, true),
    bool('showCrests', l('Escudos', 'Escudos', 'Crests'), true),
    {
      key: 'teamName',
      type: 'enum',
      default: 'short',
      label: l('Nome dos times', 'Nombre de los equipos', 'Team names'),
      values: [
        { value: 'short', label: l('Curto (sigla)', 'Corto (sigla)', 'Short (code)') },
        { value: 'full', label: l('Completo', 'Completo', 'Full') },
      ],
    },
    {
      key: 'limit',
      type: 'number',
      default: 40,
      min: 1,
      max: 100,
      label: l('Máximo de jogos', 'Máximo de partidos', 'Maximum games'),
    },
  ],
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
      ...TEAM,
      unitLabel: {
        points: l('Pontos pró', 'Puntos a favor', 'Points for'),
        runs: l('Corridas pró', 'Carreras a favor', 'Runs scored'),
        sets: l('Sets vencidos', 'Sets ganados', 'Sets won'),
      },
    }),
    bool('showGoalsAgainst', l('Gols contra', 'Goles en contra', 'Goals against'), false, {
      ...TEAM,
      unitLabel: {
        points: l('Pontos contra', 'Puntos en contra', 'Points against'),
        runs: l('Corridas contra', 'Carreras en contra', 'Runs allowed'),
        sets: l('Sets perdidos', 'Sets perdidos', 'Sets lost'),
      },
    }),
    bool('showGoalDiff', l('Saldo de gols', 'Diferencia de goles', 'Goal difference'), true, {
      ...TEAM,
      unitLabel: {
        points: l('Saldo de pontos', 'Diferencia de puntos', 'Point difference'),
        runs: l('Saldo de corridas', 'Diferencia de carreras', 'Run difference'),
        sets: l('Saldo de sets', 'Diferencia de sets', 'Set difference'),
      },
    }),
    bool('showForm', l('Forma (últimos 5)', 'Racha (últimos 5)', 'Form (last 5)'), false, TEAM),
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
      { extraCall: true, ...TEAM },
    ),
    {
      key: 'raceTable',
      type: 'enum',
      default: 'all',
      label: l('Campeonato', 'Campeonato', 'Championship'),
      values: [
        { value: 'drivers', label: l('Só pilotos', 'Solo pilotos', 'Drivers only') },
        { value: 'constructors', label: l('Só construtores', 'Solo constructores', 'Constructors only') },
        {
          value: 'all',
          label: l('Pilotos e construtores', 'Pilotos y constructores', 'Drivers and constructors'),
        },
      ],
      sports: ['formula-1'],
    },
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
  team_card: [
    bool('showForm', l('Forma recente', 'Forma reciente', 'Recent form'), true),
    {
      key: 'formCount',
      type: 'number',
      default: 5,
      min: 1,
      max: 5,
      label: l('Jogos na forma', 'Partidos en la forma', 'Matches in the form'),
    },
    bool('showNext', l('Próximo jogo', 'Próximo partido', 'Next match'), true),
    bool('showCompetitions', l('Campeonatos', 'Competiciones', 'Competitions'), true),
    count(
      'competitionsLimit',
      l('Campeonatos listados', 'Competiciones listadas', 'Competitions listed'),
      4,
      10,
      ALL,
    ),
  ],
  race_result: [
    {
      key: 'limit',
      type: 'number',
      default: 0,
      min: 0,
      max: 30,
      label: l('Pilotos listados', 'Pilotos listados', 'Drivers listed'),
      hint: l('0 = todos.', '0 = todos.', '0 = all.'),
    },
    bool('showTeam', l('Equipe', 'Equipo', 'Team'), true),
    bool('showGrid', l('Posição de largada', 'Posición de salida', 'Grid position'), true),
    bool('showPits', l('Paradas nos boxes', 'Paradas en boxes', 'Pit stops'), false),
    bool('showFastestLap', l('Volta mais rápida', 'Vuelta rápida', 'Fastest lap'), true),
  ],
  race_weekend: [
    bool('showWinners', l('Vencedor de cada sessão', 'Ganador de cada sesión', 'Session winners'), true),
    bool('showVenue', l('Circuito', 'Circuito', 'Circuit'), true),
    bool('showCalendar', L.calendar, false),
  ],
  season_calendar: [
    {
      key: 'range',
      type: 'enum',
      default: 'auto',
      label: l('Período', 'Período', 'Range'),
      values: [
        {
          value: 'auto',
          label: l(
            'Automático (temporada na F1, próximos no MMA)',
            'Automático (temporada en F1, próximos en MMA)',
            'Automatic',
          ),
        },
        { value: 'season', label: l('A temporada inteira', 'La temporada entera', 'Whole season') },
        { value: 'upcoming', label: l('Só os próximos', 'Solo los próximos', 'Upcoming only') },
      ],
    },
    {
      key: 'limit',
      type: 'number',
      default: 0,
      min: 0,
      max: 40,
      label: l('Etapas listadas', 'Etapas listadas', 'Rounds listed'),
      hint: l('0 = todas.', '0 = todas.', '0 = all.'),
    },
    bool('showWinners', l('Vencedores', 'Ganadores', 'Winners'), true),
    bool('showVenue', l('Local', 'Lugar', 'Venue'), true),
  ],
  athlete_profile: [
    bool(
      'showCareer',
      l('Números da carreira ou cartel', 'Números de la carrera o récord', 'Career or record'),
      true,
    ),
    bool(
      'showCurrent',
      l(
        'Temporada atual (F1) ou próxima luta (MMA)',
        'Temporada actual (F1) o próxima pelea (MMA)',
        'Current season or next fight',
      ),
      true,
    ),
    {
      key: 'recent',
      type: 'number',
      default: 5,
      min: 0,
      max: 10,
      label: l('Últimas lutas (MMA)', 'Últimas peleas (MMA)', 'Recent fights (MMA)'),
      sports: ['mma'],
    },
  ],
  match_timeline: [
    {
      key: 'order',
      type: 'enum',
      default: 'newest',
      label: l('Ordem', 'Orden', 'Order'),
      values: [
        { value: 'newest', label: l('Mais recente primeiro', 'Más reciente primero', 'Newest first') },
        { value: 'oldest', label: l('Cronológica', 'Cronológico', 'Chronological') },
      ],
    },
    {
      key: 'types',
      type: 'multi',
      label: l('Tipos de lance', 'Tipos de jugada', 'Incident types'),
      hint: l('Nenhum marcado = todos.', 'Ninguno marcado = todos.', 'None ticked = all.'),
      values: TIMELINE_TYPES,
    },
    count('limit', l('Lances mostrados', 'Jugadas mostradas', 'Incidents shown'), 0, 100, ALL),
    bool(
      'showMarkers',
      l('Início, intervalo e fim', 'Inicio, entretiempo y final', 'Kick-off, half-time and full time'),
      true,
    ),
    bool('showAssists', l('Assistências', 'Asistencias', 'Assists'), true),
    bool(
      'showMatch',
      l('Times e placar no topo', 'Equipos y marcador arriba', 'Teams and score on top'),
      true,
      {
        extraCall: true,
      },
    ),
  ],
  fight_card: [
    bool('showPrelims', l('Preliminares', 'Preliminares', 'Prelims'), true),
    bool('showWeightClass', l('Categoria de peso', 'Categoría de peso', 'Weight class'), true),
    bool('showResults', l('Resultado das lutas', 'Resultado de las peleas', 'Bout results'), true),
  ],
  equestrian_results: [
    {
      key: 'competitionId',
      type: 'lookup',
      source: 'eq_competition',
      label: l('Prova', 'Prueba', 'Competition'),
      hint: l(
        'Vazio = a última prova com classificação completa.',
        'Vacío = la última prueba con clasificación completa.',
        'Empty = the latest competition with full standings.',
      ),
    },
    count('limit', l('Conjuntos listados', 'Binomios listados', 'Combinations listed'), 10, 60, ALL),
    bool('showHorse', l('Cavalo', 'Caballo', 'Horse'), true),
    bool('showScore', l('Faltas e tempo', 'Faltas y tiempo', 'Faults and time'), true),
    bool('showPrize', l('Prêmio', 'Premio', 'Prize money'), false),
  ],
  equestrian_ranking: [
    count('limit', l('Conjuntos por ranking', 'Binomios por ranking', 'Riders per ranking'), 10, 50, ALL),
    bool('showHorse', l('Cavalo', 'Caballo', 'Horse'), true),
    bool('showPoints', l('Pontos', 'Puntos', 'Points'), true),
  ],
  equestrian_calendar: [
    {
      key: 'range',
      type: 'enum',
      default: 'upcoming',
      label: l('Provas', 'Pruebas', 'Competitions'),
      values: [
        { value: 'upcoming', label: l('Próximas', 'Próximas', 'Upcoming') },
        { value: 'recent', label: l('Últimas', 'Últimas', 'Latest') },
      ],
    },
    count('limit', l('Provas listadas', 'Pruebas listadas', 'Competitions listed'), 8, 30),
    bool('grandPrixOnly', l('Só Grandes Prêmios', 'Solo Grandes Premios', 'Grands Prix only'), false),
    bool('showVenue', l('Local', 'Lugar', 'Venue'), true),
  ],
  rider_profile: [
    {
      key: 'athleteId',
      type: 'lookup',
      source: 'eq_athlete',
      label: l('Cavaleiro', 'Jinete', 'Rider'),
      hint: l(
        'Vazio = o destaque do momento.',
        'Vacío = el destacado del momento.',
        'Empty = the current highlight.',
      ),
    },
    count('horses', l('Cavalos listados', 'Caballos listados', 'Horses listed'), 3, 10),
    count('recent', l('Últimos resultados', 'Últimos resultados', 'Latest results'), 5, 10),
    bool('showRankings', l('Ranking', 'Ranking', 'Ranking'), true),
  ],
  horse_profile: [
    {
      key: 'horseId',
      type: 'lookup',
      source: 'eq_horse',
      label: l('Cavalo', 'Caballo', 'Horse'),
      hint: l(
        'Vazio = o cavalo com mais provas na base.',
        'Vacío = el caballo con más pruebas en la base.',
        'Empty = the horse with the most starts.',
      ),
    },
    count('recent', l('Últimos resultados', 'Últimos resultados', 'Latest results'), 5, 10),
    bool('showPedigree', l('Pedigree', 'Pedigrí', 'Pedigree'), true),
    bool('showRiders', l('Cavaleiros', 'Jinetes', 'Riders'), true),
  ],
  medal_table: [
    games(),
    {
      key: 'sort',
      type: 'enum',
      default: 'gold',
      label: l('Ordem', 'Orden', 'Order'),
      values: [
        { value: 'gold', label: l('Por ouros', 'Por oros', 'By golds') },
        { value: 'total', label: l('Pelo total', 'Por total', 'By total') },
      ],
    },
    {
      key: 'region',
      type: 'enum',
      default: 'all',
      label: l('Países', 'Países', 'Countries'),
      values: [
        { value: 'all', label: l('Todos', 'Todos', 'All') },
        { value: 'latam', label: l('América Latina', 'América Latina', 'Latin America') },
      ],
    },
    count('limit', l('Países listados', 'Países listados', 'Countries listed'), 10, 100, ALL),
    noc('highlight', l('País em destaque', 'País destacado', 'Highlighted country')),
  ],
  country_today: [
    games(),
    noc(),
    bool('showMedals', l('Medalhas do dia', 'Medallas del día', 'Medals of the day'), true),
    bool(
      'medalOnly',
      l('Só provas que valem medalha', 'Solo pruebas por medalla', 'Medal events only'),
      false,
    ),
  ],
  games_schedule: [
    games(),
    count('limit', l('Provas listadas', 'Pruebas listadas', 'Events listed'), 20, 100),
    bool(
      'medalOnly',
      l('Só provas que valem medalha', 'Solo pruebas por medalla', 'Medal events only'),
      false,
    ),
    bool('showVenue', l('Local', 'Lugar', 'Venue'), true),
  ],
  country_athletes: [
    games(),
    noc(),
    count('limit', l('Atletas listados', 'Atletas listados', 'Athletes listed'), 20, 200, ALL),
    bool('medalistsOnly', l('Só medalhistas', 'Solo medallistas', 'Medallists only'), false),
  ],
  medal_history: [
    noc(),
    {
      key: 'type',
      type: 'enum',
      default: 'OG,PAN',
      label: l('Jogos', 'Juegos', 'Games'),
      values: [
        {
          value: 'OG,PAN',
          label: l('Olimpíadas e Pan', 'Juegos Olímpicos y Panamericanos', 'Olympics and Pan Am'),
        },
        { value: 'OG', label: l('Olimpíadas', 'Juegos Olímpicos', 'Olympics') },
        { value: 'PAN', label: l('Pan-Americanos', 'Panamericanos', 'Pan American Games') },
      ],
    },
    {
      key: 'season',
      type: 'enum',
      default: 'summer',
      label: l('Temporada', 'Temporada', 'Season'),
      values: [
        { value: 'summer', label: l('Verão', 'Verano', 'Summer') },
        { value: 'winter', label: l('Inverno', 'Invierno', 'Winter') },
      ],
    },
    count('limit', l('Edições listadas', 'Ediciones listadas', 'Editions listed'), 10, 40, ALL),
  ],
  champions_gallery: [
    count('limit', l('Edições listadas', 'Ediciones listadas', 'Editions listed'), 10, 200, ALL),
    bool('showRanking', l('Ranking de títulos', 'Ranking de títulos', 'Titles ranking'), true, {
      hint: l(
        'Só aparece quando a lista de campeões está completa, sem ano faltando.',
        'Solo aparece cuando la lista de campeones está completa, sin años faltantes.',
        'Only shown when the list of champions is complete, with no missing year.',
      ),
    }),
    count('rankingLimit', l('Times no ranking', 'Equipos en el ranking', 'Teams in the ranking'), 5, 50, ALL),
    bool(
      'showRunnerUp',
      l('Vice de cada edição', 'Subcampeón de cada edición', 'Runner-up of each edition'),
      false,
      {
        extraCall: true,
      },
    ),
  ],
  countdown: [
    bool('showWatch', l('Onde assistir', 'Dónde ver', 'Where to watch'), true, { extraCall: true }),
    bool('showSeconds', l('Segundos', 'Segundos', 'Seconds'), true),
    {
      key: 'onStart',
      type: 'enum',
      default: 'score',
      label: l('Quando o jogo começar', 'Cuando empiece el partido', 'When the match starts'),
      values: [
        {
          value: 'score',
          label: l('Virar o placar ao vivo', 'Mostrar el marcador en vivo', 'Show the live score'),
        },
        { value: 'hide', label: l('Esconder o widget', 'Ocultar el widget', 'Hide the widget') },
      ],
    },
  ],
  team_squad: [
    {
      key: 'season',
      type: 'season',
      label: l('Temporada', 'Temporada', 'Season'),
      hint: l(
        'Vazio = elenco atual. Com o ano, entram também os que jogaram naquela temporada.',
        'Vacío = plantel actual. Con el año, entran también los que jugaron esa temporada.',
        'Empty = current squad. With a year, players who played that season are included too.',
      ),
    },
    bool('showPhotos', l('Foto dos jogadores', 'Foto de los jugadores', 'Player photos'), true),
    bool('groupByPosition', l('Agrupar por posição', 'Agrupar por posición', 'Group by position'), true),
    bool('showNumber', l('Número da camisa', 'Número de camiseta', 'Shirt number'), true),
    bool('showAge', l('Idade', 'Edad', 'Age'), true),
    bool('showNationality', l('Nacionalidade', 'Nacionalidad', 'Nationality'), true),
    bool('showCoaches', l('Técnicos', 'Entrenadores', 'Coaches'), true),
  ],
  player_profile: [
    {
      key: 'season',
      type: 'season',
      label: l('Temporada', 'Temporada', 'Season'),
      hint: l(
        'Vazio = a temporada mais recente com jogos.',
        'Vacío = la temporada más reciente con partidos.',
        'Empty = the latest season with matches.',
      ),
    },
    bool('showStats', l('Números da temporada', 'Números de la temporada', 'Season numbers'), true),
    bool('showClubs', l('Clubes', 'Clubes', 'Clubs'), true),
    bool('showSeasons', l('Temporadas', 'Temporadas', 'Seasons'), true),
    bool('showTrophies', l('Títulos', 'Títulos', 'Trophies'), true),
    bool('showTransfers', l('Transferências', 'Transferencias', 'Transfers'), true),
    count('limit', l('Itens por bloco', 'Elementos por bloque', 'Items per block'), 5, 30, ALL),
  ],
  lineups: [
    {
      key: 'view',
      type: 'enum',
      default: 'pitch',
      label: l('Formato', 'Formato', 'Layout'),
      hint: l(
        'Sem a posição de cada jogador no campo, a escalação aparece em lista.',
        'Sin la posición de cada jugador en la cancha, la alineación se muestra en lista.',
        'Without each player’s position on the pitch, the lineup is shown as a list.',
      ),
      values: [
        { value: 'pitch', label: l('Campo', 'Cancha', 'Pitch') },
        { value: 'list', label: l('Lista', 'Lista', 'List') },
      ],
    },
    {
      key: 'team',
      type: 'enum',
      default: 'both',
      label: l('Times', 'Equipos', 'Teams'),
      values: [
        { value: 'both', label: l('Os dois times', 'Los dos equipos', 'Both teams') },
        { value: 'home', label: l('Só o mandante', 'Solo el local', 'Home team only') },
        { value: 'away', label: l('Só o visitante', 'Solo el visitante', 'Away team only') },
      ],
    },
    bool('showSubstitutes', l('Reservas', 'Suplentes', 'Substitutes'), true),
    bool('showCoach', l('Técnico', 'Entrenador', 'Head coach'), true),
  ],
  match_prediction: [
    bool(
      'showProbabilities',
      l('Chances de cada resultado', 'Probabilidad de cada resultado', 'Chance of each result'),
      true,
    ),
    bool('showWinner', l('Quem deve vencer', 'Quién debería ganar', 'Who should win'), true),
    bool('showGoals', l('Linha de gols', 'Línea de goles', 'Goals line'), true),
    bool('showComparison', l('Comparação dos times', 'Comparación de los equipos', 'Team comparison'), true),
    bool(
      'showNote',
      l('Aviso de palpite estatístico', 'Aviso de pronóstico estadístico', 'Statistical prediction note'),
      true,
    ),
  ],
  match_odds: [
    bool('showMatchWinner', l('Resultado final', 'Resultado final', 'Full time result'), true),
    bool('showDoubleChance', l('Dupla chance', 'Doble oportunidad', 'Double chance'), true),
    bool('showGoals', l('Total de gols', 'Total de goles', 'Total goals'), true),
    bool('showBothTeamsScore', l('Ambos marcam', 'Ambos marcan', 'Both teams to score'), true),
    bool(
      'showBest',
      l('Maior odd entre as casas', 'Cuota máxima entre las casas', 'Best odd across bookmakers'),
      true,
    ),
    bool(
      'showNotice',
      l('Aviso de jogo responsável', 'Aviso de juego responsable', 'Responsible gambling notice'),
      true,
    ),
  ],
  competition_leaders: [
    {
      key: 'category',
      type: 'enum',
      default: 'goals',
      label: l('Categoria', 'Categoría', 'Category'),
      values: [
        { value: 'assists', label: l('Assistências', 'Asistencias', 'Assists') },
        { value: 'cards', label: l('Cartões', 'Tarjetas', 'Cards') },
        { value: 'goals', label: l('Gols (artilharia)', 'Goles (goleadores)', 'Goals (top scorers)') },
      ],
    },
    {
      key: 'limit',
      type: 'number',
      default: 10,
      min: 1,
      max: 50,
      label: l('Jogadores listados', 'Jugadores listados', 'Players listed'),
    },
    {
      key: 'season',
      type: 'season',
      label: l('Temporada', 'Temporada', 'Season'),
      hint: l('Vazio = temporada atual.', 'Vacío = temporada actual.', 'Empty = current season.'),
    },
    bool('showPhoto', l('Foto do jogador', 'Foto del jugador', 'Player photo'), true),
    bool('showTeam', l('Escudo e nome do time', 'Escudo y nombre del equipo', 'Team crest and name'), true),
    bool('showAppearances', l('Jogos disputados', 'Partidos jugados', 'Games played'), true),
    {
      key: 'highlightTeamId',
      type: 'team',
      label: l('Time em destaque', 'Equipo destacado', 'Highlighted team'),
      hint: l(
        'Destaca os jogadores do clube do portal.',
        'Destaca a los jugadores del club del portal.',
        "Highlights the portal club's players.",
      ),
    },
  ],
  // blocos em ordem alfabética (pt-BR); o widget os desenha na ordem de leitura
  team_stats: [
    {
      key: 'competitionId',
      type: 'competition',
      label: l('Campeonato', 'Competición', 'Competition'),
      hint: l(
        'Vazio = o campeonato em que o time mais jogou na temporada.',
        'Vacío = la competición en la que el equipo más jugó en la temporada.',
        'Empty = the competition the team played the most in that season.',
      ),
    },
    {
      key: 'season',
      type: 'season',
      label: l('Temporada', 'Temporada', 'Season'),
      hint: l(
        'Vazio = a temporada mais recente com estatísticas.',
        'Vacío = la temporada más reciente con estadísticas.',
        'Empty = the latest season with statistics.',
      ),
    },
    bool(
      'showCards',
      l('Cartões por faixa de minuto', 'Tarjetas por tramo de minutos', 'Cards by minute'),
      false,
    ),
    bool('showHomeAway', l('Casa e fora', 'Local y visitante', 'Home and away'), true),
    bool('showForm', l('Forma', 'Racha', 'Form'), true),
    {
      key: 'formCount',
      type: 'number',
      default: 5,
      min: 1,
      max: 10,
      label: l('Resultados na forma', 'Resultados en la racha', 'Results in the form'),
    },
    bool(
      'showFormations',
      l('Formações mais usadas', 'Formaciones más usadas', 'Most used formations'),
      true,
    ),
    bool(
      'showGoalsByMinute',
      l('Gols por faixa de minuto', 'Goles por tramo de minutos', 'Goals by minute'),
      true,
    ),
    bool('showSummary', l('Resumo da temporada', 'Resumen de la temporada', 'Season summary'), true),
    bool(
      'showHighlights',
      l('Sequências e maiores placares', 'Rachas y mayores resultados', 'Streaks and biggest results'),
      true,
    ),
  ],
  transfer_market: [
    {
      key: 'direction',
      type: 'enum',
      default: 'all',
      label: l('Mostrar', 'Mostrar', 'Show'),
      values: [
        { value: 'all', label: l('Chegadas e saídas', 'Llegadas y salidas', 'Arrivals and departures') },
        { value: 'in', label: l('Só chegadas', 'Solo llegadas', 'Arrivals only') },
        { value: 'out', label: l('Só saídas', 'Solo salidas', 'Departures only') },
      ],
    },
    {
      key: 'days',
      type: 'number',
      default: 180,
      min: 7,
      max: 730,
      label: l('Período (dias)', 'Período (días)', 'Period (days)'),
      hint: l(
        'As transferências dos últimos N dias.',
        'Los fichajes de los últimos N días.',
        'Transfers from the last N days.',
      ),
    },
    {
      key: 'limit',
      type: 'number',
      default: 10,
      min: 1,
      max: 50,
      label: l('Quantidade', 'Cantidad', 'How many'),
    },
    bool(
      'groupByDirection',
      l('Chegadas e saídas separadas', 'Llegadas y salidas separadas', 'Separate arrivals and departures'),
      true,
    ),
    bool(
      'showType',
      l('Tipo (empréstimo, compra, sem custo)', 'Tipo (préstamo, compra, libre)', 'Type (loan, fee, free)'),
      true,
    ),
    bool('showPhoto', l('Foto do jogador', 'Foto del jugador', 'Player photo'), true),
    bool('showDate', l('Data', 'Fecha', 'Date'), true),
  ],
  upcoming_derbies: [
    {
      key: 'country',
      type: 'enum',
      default: 'all',
      label: l('País', 'País', 'Country'),
      hint: l(
        'Clássicos com um time do país.',
        'Clásicos con un equipo del país.',
        'Derbies with a team from the country.',
      ),
      values: DERBY_COUNTRIES,
    },
    {
      key: 'limit',
      type: 'number',
      default: 5,
      min: 1,
      max: 20,
      label: l('Clássicos listados', 'Clásicos listados', 'Derbies listed'),
    },
    {
      key: 'days',
      type: 'number',
      default: 7,
      min: 1,
      max: 30,
      label: l('Dias à frente', 'Días hacia adelante', 'Days ahead'),
    },
    bool('showCompetition', L.competition, true),
    bool('showHistory', l('Retrospecto do confronto', 'Historial del duelo', 'Head-to-head record'), true, {
      extraCall: true,
    }),
    bool('showWhereToWatch', l('Onde assistir', 'Dónde ver', 'Where to watch'), true, { extraCall: true }),
  ],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const GAMES_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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
    case 'lookup':
      if (typeof raw !== 'string') return undefined;
      if (spec.source === 'games') return GAMES_SLUG.test(raw) ? raw : undefined;
      return UUID.test(raw) ? raw.toLowerCase() : undefined;
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
