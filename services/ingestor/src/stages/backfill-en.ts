import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';
import { parseRound } from '@galaxie/providers';

/**
 * Preenche o nome em inglês (`core.stage.name->>'en'`) das fases já gravadas. Até o locale `en` da API, o
 * normalizador copiava o rótulo do fornecedor para `en` ("Regular Season - 12"); hoje `parseRound` escreve
 * o inglês ("Matchday 12"). A fase nova já sai certa; a antiga só muda por aqui, porque o espelho grava a
 * fase com `onConflictDoNothing` (provisório) ou sem reler o nome quando nada mais mudou.
 *
 * Idempotente e sem chamadas ao fornecedor: recalcula `parseRound(provider_label)` de cada fase cujo
 * `en` está vazio ou igual ao rótulo do fornecedor, e grava só a chave `en` (pt-BR e es ficam como estão)
 * quando o tipo recalculado bate com o gravado — fase de outro normalizador (F1, MMA, NFL) não é tocada.
 */
export interface StageBackfillResult {
  examined: number;
  changed: number;
  /** Amostra do que mudou (ou mudaria, na prévia). */
  sample: { competition: string; year: number; label: string; before: string | null; after: string }[];
}

interface StageRow extends Record<string, unknown> {
  id: string;
  kind: string;
  name: Record<string, string | undefined> | null;
  provider_label: string;
  slug: string;
  year: number;
}

export async function backfillStageEnglishNames(
  db: Database,
  options: { apply?: boolean; sport?: string; sample?: number } = {},
): Promise<StageBackfillResult> {
  const sport = options.sport ?? 'football';
  const rows = await db.execute<StageRow>(sql`
    select st.id, st.kind, st.name, st.provider_label, c.slug, se.year
      from core.stage st
      join core.season se on se.id = st.season_id
      join core.competition c on c.id = se.competition_id
     where c.sport = ${sport}
       and st.provider_label is not null
       and (st.name->>'en' is null or st.name->>'en' = st.provider_label)
     order by c.slug, se.year, st."order", st.provider_label`);

  const result: StageBackfillResult = { examined: rows.length, changed: 0, sample: [] };
  const limit = options.sample ?? 20;
  for (const r of rows) {
    const round = parseRound(r.provider_label);
    const before = r.name?.en ?? null;
    if (round.kind !== r.kind || round.name.en === before) continue;
    result.changed++;
    if (result.sample.length < limit)
      result.sample.push({
        competition: r.slug,
        year: r.year,
        label: r.provider_label,
        before,
        after: round.name.en!,
      });
    if (options.apply)
      await db.execute(sql`
        update core.stage
           set name = coalesce(name, '{}'::jsonb) || jsonb_build_object('en', ${round.name.en}::text)
         where id = ${r.id}`);
  }
  return result;
}
