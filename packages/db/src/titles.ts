import { and, asc, eq, inArray, lt, max } from 'drizzle-orm';
import type { Database } from './client.js';
import { competitionTitle, competitionTitleCoverage, providerMap, season } from './schema/core.js';

/**
 * Contagem de títulos de uma competição por time, a partir de `core.competition_title` (importado do
 * Wikidata). Estrita: na dúvida, o time fica fora do mapa e o chamador não mostra nada.
 *
 * - Só conta edições decididas **antes** da partida (`decided_on < before`).
 * - O time precisa ter QID do Wikidata em `core.provider_map`: só assim um título dele seria
 *   reconhecido; sem o QID, "0 títulos" seria um palpite.
 * - A lista de campeões precisa estar completa (sem ano faltando nem edição recusada) até a temporada
 *   anterior à da partida (`core.competition_title_coverage`). Um Wikidata que parou em 2020, ou que não
 *   tem o campeão de 2023, não diz quantos títulos o time tem em 2026.
 */

export interface TitleRecord {
  /** Títulos da competição decididos antes da partida. */
  won: number;
  /** Edições vencidas, em ordem ("1999", "2020", "2021"). */
  seasons: string[];
  /** Edições de origem no Wikidata (proveniência), na mesma ordem. */
  editionQids: string[];
}

export interface TitleQuery {
  competitionId: string;
  /** Ano da temporada da partida no core (para a checagem de cobertura). */
  seasonYear: number | null;
  /** Início da partida: só contam títulos decididos antes desta data. */
  before: Date;
  participantIds: readonly string[];
}

/** Dia (UTC) no formato do `date` do Postgres. */
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A lista de campeões da competição está completa para uma partida em `before`/`seasonYear`? Vale quando a
 * cobertura (`core.competition_title_coverage`, gravada pelo importador) vai sem lacunas até a temporada
 * anterior do core. Devolve o último ano completo, ou null quando não basta.
 */
export async function titleCoverage(
  db: Database,
  q: Omit<TitleQuery, 'participantIds'>,
): Promise<number | null> {
  const [cov] = await db
    .select({ through: competitionTitleCoverage.completeThrough })
    .from(competitionTitleCoverage)
    .where(eq(competitionTitleCoverage.competitionId, q.competitionId));
  const through = cov?.through ?? null;
  if (through === null) return null;
  let previous: number;
  if (q.seasonYear !== null) {
    const [prev] = await db
      .select({ year: max(season.year) })
      .from(season)
      .where(and(eq(season.competitionId, q.competitionId), lt(season.year, q.seasonYear)));
    previous = prev?.year ?? q.seasonYear - 1;
  } else {
    previous = q.before.getUTCFullYear() - 1;
  }
  return through >= previous ? through : null;
}

/**
 * Títulos dos times na competição antes da partida. Time sem QID do Wikidata, ou competição sem cobertura
 * em dia, fica de fora do mapa (não mostrar).
 */
export async function loadTitleRecords(db: Database, q: TitleQuery): Promise<Map<string, TitleRecord>> {
  const out = new Map<string, TitleRecord>();
  const ids = [...new Set(q.participantIds)];
  if (!ids.length) return out;
  if ((await titleCoverage(db, q)) === null) return out;
  const mapped = await db
    .selectDistinct({ id: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.provider, 'wikidata'),
        eq(providerMap.sport, 'football'),
        eq(providerMap.entityType, 'participant'),
        inArray(providerMap.entityId, ids),
      ),
    );
  for (const m of mapped) out.set(m.id, { won: 0, seasons: [], editionQids: [] });
  if (!out.size) return out;
  const rows = await db
    .select({
      participantId: competitionTitle.participantId,
      label: competitionTitle.seasonLabel,
      qid: competitionTitle.editionQid,
    })
    .from(competitionTitle)
    .where(
      and(
        eq(competitionTitle.competitionId, q.competitionId),
        inArray(competitionTitle.participantId, [...out.keys()]),
        lt(competitionTitle.decidedOn, day(q.before)),
      ),
    )
    .orderBy(asc(competitionTitle.decidedOn), asc(competitionTitle.seasonYear));
  for (const r of rows) {
    const rec = out.get(r.participantId!);
    if (!rec || rec.editionQids.includes(r.qid)) continue;
    rec.won += 1;
    rec.seasons.push(r.label);
    rec.editionQids.push(r.qid);
  }
  return out;
}
