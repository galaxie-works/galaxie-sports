/**
 * F1DB (https://github.com/f1db/f1db, CC BY 4.0): tabelas do release SQLite que alimentam o core.
 *
 * O ingestor lê o arquivo `f1db.db` do release fixado, grava estas tabelas no raw (sem as colunas nulas) e
 * a normalização (`normalizeF1db`) trabalha só com elas — sem banco e sem rede.
 */
export const F1DB_PROVIDER = 'f1db';
export const F1DB_SPORT = 'formula-1';
export const F1DB_LICENSE = 'CC BY 4.0';
export const F1DB_SOURCE_URL = 'https://github.com/f1db/f1db';

/** Tabelas do release usadas (as demais ficam fora do raw). */
export const F1DB_TABLES = [
  'country',
  'driver',
  'constructor',
  'circuit',
  'grand_prix',
  'race',
  'race_data',
  'season_driver',
  'season_constructor',
  'season_driver_standing',
  'season_constructor_standing',
] as const;
export type F1dbTableName = (typeof F1DB_TABLES)[number];

export type F1dbRow = Record<string, unknown>;
export type F1dbTables = Partial<Record<F1dbTableName, F1dbRow[]>>;

/** Linhas de uma tabela. Só a propriedade própria: `constructor` também é nome de propriedade de todo objeto. */
export function rowsOf(tables: F1dbTables, name: F1dbTableName): F1dbRow[] {
  return Object.hasOwn(tables, name) ? (tables[name] ?? []) : [];
}

/** Tipos de `race_data` que viram sessão (o resto — warm-up, pré-classificação, Q1/Q2 antigas — fica no raw). */
export const F1DB_SESSION_TYPES = {
  FREE_PRACTICE_1_RESULT: { key: 'practice-1', label: '1st Practice' },
  FREE_PRACTICE_2_RESULT: { key: 'practice-2', label: '2nd Practice' },
  FREE_PRACTICE_3_RESULT: { key: 'practice-3', label: '3rd Practice' },
  FREE_PRACTICE_4_RESULT: { key: 'practice-4', label: '4th Practice' },
  QUALIFYING_RESULT: { key: 'qualifying', label: 'Qualifying' },
  SPRINT_QUALIFYING_RESULT: { key: 'sprint_qualifying', label: 'Sprint Qualifying' },
  SPRINT_RACE_RESULT: { key: 'sprint', label: 'Sprint' },
  RACE_RESULT: { key: 'race', label: 'Race' },
} as const;
export type F1dbSessionDataType = keyof typeof F1DB_SESSION_TYPES;

/** ID do provedor de cada entidade (dentro de `(f1db, formula-1)`). */
export const f1dbDriverId = (driverId: string) => `driver-${driverId}`;
export const f1dbEventId = (raceId: number | string, sessionKey: string) => `race-${raceId}-${sessionKey}`;

// ─── leitura tolerante das linhas ────────────────────────────────────────────────────────────────

export const str = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() ? v.trim() : null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'bigint') return String(v);
  return null;
};
export const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
export const int = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

/** Agrupa linhas por uma chave (ex.: `race_data` por corrida). */
export function groupBy<T>(rows: T[], key: (r: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (k == null) continue;
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/** Nome comparável: sem acento, minúsculo, só letras e números ("Sergio Pérez" → "sergio perez"). */
export function plainName(v: string | null | undefined): string {
  return (v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tabelas com uma linha por temporada (`year`). */
const SEASON_TABLES: readonly F1dbTableName[] = [
  'race',
  'season_driver',
  'season_constructor',
  'season_driver_standing',
  'season_constructor_standing',
];

/**
 * Recorte do release pelas temporadas `from`–`to`: corridas, resultados (`race_data`) e campeonatos desses anos;
 * os cadastros (pilotos, construtores, circuitos, países, GPs) vão inteiros. A normalização e o upsert por
 * recorte mantêm o lote pequeno (o release inteiro num lote só passa de 1 GB de heap).
 */
export function sliceF1dbSeasons(tables: F1dbTables, from: number, to: number): F1dbTables {
  const inRange = (r: F1dbRow) => {
    const y = int(r.year);
    return y != null && y >= from && y <= to;
  };
  const out: F1dbTables = {};
  for (const name of F1DB_TABLES) {
    if (!Object.hasOwn(tables, name) || name === 'race_data') continue;
    out[name] = SEASON_TABLES.includes(name) ? rowsOf(tables, name).filter(inRange) : rowsOf(tables, name);
  }
  if (Object.hasOwn(tables, 'race_data')) {
    const races = new Set(rowsOf(out, 'race').map((r) => str(r.id)));
    out.race_data = rowsOf(tables, 'race_data').filter((r) => races.has(str(r.race_id)));
  }
  return out;
}

/** Primeira e última temporada com corrida no release. */
export function f1dbSeasonRange(tables: F1dbTables): { from: number; to: number } | null {
  const years = rowsOf(tables, 'race').flatMap((r) => int(r.year) ?? []);
  if (!years.length) return null;
  return { from: Math.min(...years), to: Math.max(...years) };
}
