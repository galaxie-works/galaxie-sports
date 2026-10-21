/**
 * Códigos de status das 11 APIs da api-sports além do futebol → estado canônico (docs/04 §3.5).
 *
 * Cada API tem a sua lista. Fontes: specs oficiais arquivadas (basquete, beisebol, hóquei, F1, NFL) e
 * respostas reais capturadas (todas) — ver docs/research/api-sports-outros-esportes.md. Os códigos de
 * pré-jogo viram `scheduled`; a máquina de estados decide entre `scheduled` e `starting` pelo horário.
 * Código desconhecido devolve `null` (a observação é descartada como `unknown_status`).
 */
import type { EventStatus } from '../../event/status.js';

export const API_SPORTS_OTHER_SPORTS = [
  'afl',
  'baseball',
  'basketball',
  'formula-1',
  'handball',
  'hockey',
  'mma',
  'nba',
  'american-football',
  'rugby',
  'volleyball',
] as const;
export type ApiSportsOtherSport = (typeof API_SPORTS_OTHER_SPORTS)[number];

export function isApiSportsOtherSport(value: string): value is ApiSportsOtherSport {
  return (API_SPORTS_OTHER_SPORTS as readonly string[]).includes(value);
}

type StatusMap = Readonly<Record<string, EventStatus>>;

/** Desfechos comuns a todas as APIs v1 "clássicas". */
const COMMON: StatusMap = {
  NS: 'scheduled', // não iniciado
  TBD: 'scheduled', // horário a definir
  FT: 'finished',
  AW: 'finished', // resultado decidido pela organização
  AWD: 'finished',
  WO: 'finished',
  POST: 'postponed',
  PST: 'postponed',
  CANC: 'cancelled',
  INTR: 'suspended', // interrompido (pode ser retomado)
  SUSP: 'suspended',
  ABD: 'abandoned',
};

/** Mapa por esporte (código curto `status.short`). F1 e NBA usam texto/número e têm tratamento próprio. */
export const API_SPORTS_SPORT_STATUS: Readonly<Record<ApiSportsOtherSport, StatusMap>> = {
  basketball: {
    ...COMMON,
    Q1: 'live',
    Q2: 'live',
    Q3: 'live',
    Q4: 'live',
    OT: 'live', // prorrogação
    BT: 'break', // intervalo entre quartos
    HT: 'break',
    AOT: 'finished', // encerrado após prorrogação
  },
  nba: { ...COMMON },
  baseball: {
    ...COMMON,
    // IN1…IN9 e entradas extras (IN10+) são tratados por padrão em `mapSportStatus`
  },
  hockey: {
    ...COMMON,
    P1: 'live',
    P2: 'live',
    P3: 'live',
    OT: 'live',
    PT: 'live', // disputa de pênaltis (shootout)
    BT: 'break',
    AOT: 'finished',
    AP: 'finished', // encerrado após pênaltis
  },
  handball: {
    ...COMMON,
    '1H': 'live',
    '2H': 'live',
    HT: 'break',
    ET: 'live',
    BT: 'break',
    PT: 'live',
    AET: 'finished',
    AP: 'finished',
  },
  rugby: {
    ...COMMON,
    '1H': 'live',
    '2H': 'live',
    HT: 'break',
    ET: 'live',
    BT: 'break',
    PT: 'live',
    AET: 'finished',
    AP: 'finished',
  },
  volleyball: {
    ...COMMON,
    S1: 'live',
    S2: 'live',
    S3: 'live',
    S4: 'live',
    S5: 'live',
  },
  afl: {
    ...COMMON,
    Q1: 'live',
    Q2: 'live',
    Q3: 'live',
    Q4: 'live',
    QT: 'break', // intervalo de quarto
    HT: 'break',
    BT: 'break',
    ET: 'live',
    AET: 'finished',
  },
  'american-football': {
    ...COMMON,
    Q1: 'live',
    Q2: 'live',
    Q3: 'live',
    Q4: 'live',
    OT: 'live',
    HT: 'break',
    AOT: 'finished',
  },
  mma: {
    ...COMMON,
    IN: 'scheduled', // apresentação dos lutadores
    PF: 'scheduled', // pré-luta
    WO: 'scheduled', // walkout (entrada no octógono) — no MMA não é W.O.
    LIVE: 'live',
    EOR: 'break', // fim de round
  },
  'formula-1': {},
};

/**
 * Texto longo (`status.long`) → estado, para quando o código curto vem vazio ou é desconhecido
 * (ex.: NFL devolve `short: null` com `long: "Final/OT"`), e para F1 (`Scheduled`, `Live`,
 * `Completed`, `Cancelled`, `Postponed`) e NBA v2 (`Scheduled`, `In Play`, `Finished`).
 */
const LONG_STATUS: Readonly<Record<string, EventStatus>> = {
  scheduled: 'scheduled',
  'not started': 'scheduled',
  'time to be defined': 'scheduled',
  live: 'live',
  'in play': 'live',
  'in progress': 'live',
  halftime: 'break',
  'half time': 'break',
  'break time': 'break',
  completed: 'finished',
  finished: 'finished',
  final: 'finished',
  'final/ot': 'finished',
  'game finished': 'finished',
  'after over time': 'finished',
  'after extra time': 'finished',
  'after penalties': 'finished',
  awarded: 'finished',
  postponed: 'postponed',
  'game postponed': 'postponed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  'game cancelled': 'cancelled',
  interrupted: 'suspended',
  suspended: 'suspended',
  'game suspended': 'suspended',
  abandoned: 'abandoned',
  'game abandoned': 'abandoned',
};

/** Códigos que indicam prorrogação/pênaltis/entradas extras (estende `ends_at_expected`). */
export const SPORT_EXTRA_TIME_CODES: ReadonlySet<string> = new Set(['OT', 'AOT', 'ET', 'AET', 'PT', 'AP']);

export interface SportStatusInput {
  short?: string | number | null | undefined;
  long?: string | null | undefined;
}

/** Estado canônico do código do fornecedor no esporte; `null` quando desconhecido. */
export function mapSportStatus(sport: ApiSportsOtherSport, status: SportStatusInput): EventStatus | null {
  const short = status.short == null ? '' : String(status.short).trim().toUpperCase();
  if (short) {
    const hit = API_SPORTS_SPORT_STATUS[sport][short];
    if (hit) return hit;
    if (sport === 'baseball' && /^IN\d+$/.test(short)) return 'live';
  }
  const long = status.long?.trim().toLowerCase();
  if (long && LONG_STATUS[long]) return LONG_STATUS[long];
  // NBA v2: 1 = agendado, 2 = em andamento, 3 = encerrado (quando o texto não ajuda)
  if (sport === 'nba') return ({ '1': 'scheduled', '2': 'live', '3': 'finished' } as const)[short] ?? null;
  return null;
}

/** Código curto a gravar em `status_detail`: o `short` do fornecedor ou, sem ele, o texto longo. */
export function sportStatusDetail(status: SportStatusInput): string | null {
  if (status.short != null && String(status.short).trim()) return String(status.short).trim();
  return status.long?.trim() || null;
}
