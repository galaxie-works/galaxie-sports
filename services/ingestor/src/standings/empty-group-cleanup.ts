import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';

/**
 * Resíduo do recálculo antigo: tabela calculada gravada no grupo sem nome numa temporada que tem grupos com
 * nome (do fornecedor ou de recálculo). O recálculo atual nunca grava o grupo vazio quando há grupos com
 * nome, e apaga esse resíduo quando regrava a temporada; temporadas paradas (sem jogo novo, ou tabela que o
 * regulamento não sabe montar) ficavam com as duas tabelas. Linhas do fornecedor não são tocadas.
 */
export interface EmptyGroupResidue {
  seasonId: string;
  competition: string;
  year: number;
  rows: number;
}

const RESIDUE = sql`s.source = 'computed' and s."group" = ''
  and exists (select 1 from core.standing o where o.season_id = s.season_id and o."group" <> '')`;

/** Lista (e, com `apply`, apaga) as linhas calculadas no grupo sem nome ao lado de grupos com nome. Idempotente. */
export async function cleanupEmptyGroupResidue(
  db: Database,
  options: { apply?: boolean } = {},
): Promise<EmptyGroupResidue[]> {
  const found = await db.execute<{ season_id: string; slug: string; year: number; n: number }>(sql`
    select s.season_id, c.slug, se.year, count(*)::int as n
      from core.standing s
      join core.season se on se.id = s.season_id
      join core.competition c on c.id = se.competition_id
     where ${RESIDUE}
     group by s.season_id, c.slug, se.year
     order by c.slug, se.year`);
  if (options.apply && found.length) await db.execute(sql`delete from core.standing s where ${RESIDUE}`);
  return found.map((r) => ({
    seasonId: r.season_id,
    competition: r.slug,
    year: Number(r.year),
    rows: Number(r.n),
  }));
}
