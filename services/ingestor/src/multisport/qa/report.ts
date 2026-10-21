import { and, eq, inArray, sql } from 'drizzle-orm';
import { games, medalReference, medalTable, type Database } from '@galaxie/db';
import { EDITION_TOTALS, WIKIPEDIA_REFERENCES } from './references.js';

// ─── checagens por prova (funções puras) ─────────────────────────────────────────────────────────

export type EventIssue = 'no_gold' | 'no_silver' | 'no_bronze' | 'multiple_gold' | 'bronze_count';

export interface EventCount {
  gold: number;
  silver: number;
  bronze: number;
  twoBronzes: boolean;
}

/**
 * Inconsistências típicas: prova sem ouro/prata/bronze (cobertura parcial), mais de um ouro (empate legítimo
 * ou erro), luta sem os dois bronzes ou prova comum com bronze duplicado (empates são raros e merecem conferência).
 */
export function checkEventMedals(e: EventCount): EventIssue[] {
  const issues: EventIssue[] = [];
  if (e.gold === 0) issues.push('no_gold');
  if (e.silver === 0) issues.push('no_silver');
  if (e.bronze === 0) issues.push('no_bronze');
  if (e.gold > 1) issues.push('multiple_gold');
  if (e.bronze > 0 && (e.twoBronzes ? e.bronze !== 2 : e.bronze > 1)) issues.push('bronze_count');
  return issues;
}

// ─── referências ─────────────────────────────────────────────────────────────────────────────────

/** Grava os totais conferidos na Wikipedia em medal_reference (source = wikipedia). */
export async function seedWikipediaReferences(db: Database): Promise<number> {
  const slugs = [...new Set(WIKIPEDIA_REFERENCES.map((r) => r.games))];
  const rows = await db
    .select({ id: games.id, slug: games.slug })
    .from(games)
    .where(inArray(games.slug, slugs));
  const ids = new Map(rows.map((r) => [r.slug, r.id]));
  const values = WIKIPEDIA_REFERENCES.filter((r) => ids.has(r.games)).map((r) => ({
    gamesId: ids.get(r.games)!,
    nocCode: r.noc,
    source: 'wikipedia',
    gold: r.gold,
    silver: r.silver,
    bronze: r.bronze,
    url: r.url,
  }));
  if (values.length)
    await db
      .insert(medalReference)
      .values(values)
      .onConflictDoUpdate({
        target: [medalReference.gamesId, medalReference.nocCode, medalReference.source],
        set: {
          gold: sql`excluded.gold`,
          silver: sql`excluded.silver`,
          bronze: sql`excluded.bronze`,
          url: sql`excluded.url`,
          retrievedAt: sql`now()`,
        },
      });
  return values.length;
}

// ─── relatórios ──────────────────────────────────────────────────────────────────────────────────

type Gsb = { gold: number; silver: number; bronze: number; total: number };

export interface CoverageRow {
  games: string;
  noc: string;
  derived: Gsb;
  wikipedia: Gsb | null;
  wikidataDelegation: Gsb | null;
  /** Total derivado ÷ total de referência (Wikipedia, senão agregado do Wikidata). */
  coverage: number | null;
  matches: boolean | null;
}

const gsb = (g: number, s: number, b: number): Gsb => ({ gold: g, silver: s, bronze: b, total: g + s + b });

/** Derivado × referências para os CONs pedidos (padrão: América Latina + EUA). */
export async function coverageByNoc(
  db: Database,
  nocCodes: string[],
  slugs?: string[],
): Promise<CoverageRow[]> {
  const gamesRows = await db
    .select({ id: games.id, slug: games.slug, year: games.year })
    .from(games)
    .where(slugs?.length ? inArray(games.slug, slugs) : sql`true`);
  const byId = new Map(gamesRows.map((g) => [g.id, g]));
  const ids = gamesRows.map((g) => g.id);
  if (!ids.length) return [];

  const derived = await db
    .select()
    .from(medalTable)
    .where(and(inArray(medalTable.gamesId, ids), inArray(medalTable.nocCode, nocCodes)));
  const refs = await db
    .select()
    .from(medalReference)
    .where(and(inArray(medalReference.gamesId, ids), inArray(medalReference.nocCode, nocCodes)));

  const key = (g: string, n: string) => `${g}|${n}`;
  const rows = new Map<string, CoverageRow>();
  const ensure = (gamesId: string, n: string) => {
    const k = key(gamesId, n);
    let row = rows.get(k);
    if (!row) {
      row = {
        games: byId.get(gamesId)!.slug,
        noc: n,
        derived: gsb(0, 0, 0),
        wikipedia: null,
        wikidataDelegation: null,
        coverage: null,
        matches: null,
      };
      rows.set(k, row);
    }
    return row;
  };
  for (const d of derived) ensure(d.gamesId, d.nocCode).derived = gsb(d.gold, d.silver, d.bronze);
  for (const r of refs) {
    const row = ensure(r.gamesId, r.nocCode);
    if (r.source === 'wikipedia') row.wikipedia = gsb(r.gold, r.silver, r.bronze);
    else row.wikidataDelegation = gsb(r.gold, r.silver, r.bronze);
  }
  for (const row of rows.values()) {
    const ref = row.wikipedia ?? row.wikidataDelegation;
    if (ref) {
      row.coverage = ref.total ? row.derived.total / ref.total : null;
      row.matches =
        ref.gold === row.derived.gold &&
        ref.silver === row.derived.silver &&
        ref.bronze === row.derived.bronze;
    }
  }
  const order = new Map(gamesRows.map((g) => [g.slug, g.year]));
  return [...rows.values()].sort(
    (a, b) =>
      order.get(a.games)! - order.get(b.games)! ||
      a.games.localeCompare(b.games) ||
      a.noc.localeCompare(b.noc),
  );
}

export interface EditionCoverage {
  games: string;
  events: number;
  medals: Gsb;
  revoked: number;
  nocs: number;
  expected: Gsb | null;
  coverage: number | null;
  issues: Partial<Record<EventIssue, number>>;
}

/** Visão por edição: provas e medalhas carregadas, cobertura sobre o total distribuído e contagem de alertas. */
export async function coverageByEdition(db: Database, slugs?: string[]): Promise<EditionCoverage[]> {
  const rows = await db.execute<{
    slug: string;
    year: number;
    event_id: string | null;
    gold: number;
    silver: number;
    bronze: number;
    revoked: number;
    two_bronzes: boolean | null;
  }>(sql`
    select g.slug, g.year, e.id as event_id,
      count(m.*) filter (where m.medal = 'G' and m.revoked_at is null)::int as gold,
      count(m.*) filter (where m.medal = 'S' and m.revoked_at is null)::int as silver,
      count(m.*) filter (where m.medal = 'B' and m.revoked_at is null)::int as bronze,
      count(m.*) filter (where m.revoked_at is not null)::int as revoked,
      d.two_bronzes
    from multisport.games g
    join multisport.event e on e.games_id = g.id
    left join multisport.medal m on m.event_id = e.id
    left join multisport.discipline d on d.code = e.discipline_code
    ${slugs?.length ? sql`where g.slug in ${slugs}` : sql``}
    group by g.slug, g.year, e.id, d.two_bronzes`);
  const nocs = await db.execute<{ slug: string; n: number }>(sql`
    select g.slug, count(distinct mt.noc_code)::int as n
    from multisport.medal_table mt join multisport.games g on g.id = mt.games_id group by g.slug`);
  const nocCount = new Map(nocs.map((r) => [r.slug, r.n]));

  const out = new Map<string, EditionCoverage & { year: number }>();
  for (const r of rows) {
    let e = out.get(r.slug);
    if (!e) {
      const exp = EDITION_TOTALS[r.slug];
      e = {
        games: r.slug,
        year: r.year,
        events: 0,
        medals: gsb(0, 0, 0),
        revoked: 0,
        nocs: nocCount.get(r.slug) ?? 0,
        expected: exp ? gsb(exp.gold, exp.silver, exp.bronze) : null,
        coverage: null,
        issues: {},
      };
      out.set(r.slug, e);
    }
    e.events += 1;
    e.medals = gsb(e.medals.gold + r.gold, e.medals.silver + r.silver, e.medals.bronze + r.bronze);
    e.revoked += r.revoked;
    for (const i of checkEventMedals({ ...r, twoBronzes: r.two_bronzes ?? false }))
      e.issues[i] = (e.issues[i] ?? 0) + 1;
  }
  for (const e of out.values()) if (e.expected) e.coverage = e.medals.total / e.expected.total;
  return [...out.values()]
    .sort((a, b) => a.year - b.year || a.games.localeCompare(b.games))
    .map(({ year: _year, ...rest }) => rest);
}

// ─── qualidade por edição ────────────────────────────────────────────────────────────────────────

export type MedalDataQuality = 'complete' | 'partial' | 'insufficient' | 'unknown';

export interface QualityInput {
  type: string;
  derivedTotal: number;
  /** Total distribuído na edição (todas as delegações), quando conhecido. */
  editionTotal: number | null;
  /** Pares derivado × referência por CON (agregados das delegações ou Wikipedia). */
  byNoc: { derived: number; reference: number }[];
}

/** Abaixo disso, um Pan-Americano está claramente incompleto (todas as edições distribuíram 400+ medalhas). */
export const PAN_MIN_MEDALS = 300;

/**
 * Cobertura estimada e selo de qualidade do quadro de uma edição:
 * 1) total da edição conhecido → carregado ÷ distribuído; 2) referências por CON (≥ 5 CONs) → soma derivada ÷
 * soma de referência nos mesmos CONs; 3) Pan sem referência e com menos de PAN_MIN_MEDALS → insuficiente.
 * Selo: complete (≥ 99%), partial (≥ 75%), insufficient (< 75%), unknown (sem como medir).
 */
export function assessMedalQuality(q: QualityInput): { coverage: number | null; quality: MedalDataQuality } {
  let coverage: number | null = null;
  if (q.editionTotal) coverage = q.derivedTotal / q.editionTotal;
  else if (q.byNoc.length >= 5) {
    const ref = q.byNoc.reduce((s, r) => s + r.reference, 0);
    if (ref > 0) coverage = q.byNoc.reduce((s, r) => s + Math.min(r.derived, r.reference), 0) / ref;
  }
  if (coverage === null)
    return {
      coverage,
      quality: q.type === 'PAN' && q.derivedTotal < PAN_MIN_MEDALS ? 'insufficient' : 'unknown',
    };
  const quality = coverage >= 0.99 ? 'complete' : coverage >= 0.75 ? 'partial' : 'insufficient';
  return { coverage: Math.min(coverage, 1), quality };
}

/** Recalcula games.medal_coverage / medal_data_quality a partir das medalhas e referências gravadas. */
export async function updateMedalDataQuality(
  db: Database,
  gamesId: string,
): Promise<{ coverage: number | null; quality: MedalDataQuality }> {
  const [g] = await db.select().from(games).where(eq(games.id, gamesId));
  if (!g) throw new Error(`Edição ${gamesId} não encontrada`);
  const derived = await db.select().from(medalTable).where(eq(medalTable.gamesId, gamesId));
  const refs = await db.select().from(medalReference).where(eq(medalReference.gamesId, gamesId));
  const derivedByNoc = new Map(derived.map((d) => [d.nocCode, d.total]));
  const pick = (source: string) =>
    refs
      .filter((r) => r.source === source)
      .map((r) => ({ derived: derivedByNoc.get(r.nocCode) ?? 0, reference: r.gold + r.silver + r.bronze }));
  const wikipedia = pick('wikipedia');
  const delegation = pick('wikidata-delegation');
  const exp = EDITION_TOTALS[g.slug];
  const result = assessMedalQuality({
    type: g.type,
    derivedTotal: derived.reduce((s, d) => s + d.total, 0),
    editionTotal: exp ? exp.gold + exp.silver + exp.bronze : null,
    byNoc: delegation.length >= wikipedia.length ? delegation : wikipedia,
  });
  await db
    .update(games)
    .set({
      medalCoverage: result.coverage === null ? null : result.coverage.toFixed(4),
      medalDataQuality: result.quality,
    })
    .where(eq(games.id, gamesId));
  return result;
}
