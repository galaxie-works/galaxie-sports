import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';

/**
 * Aplica o `prestige` do catálogo (config/competitions/<esporte>.yaml) em `core.competition` pelo slug,
 * sem chamar o fornecedor. O bootstrap do catálogo já grava o campo; isto deixa o recálculo da importância
 * em dia quando só o YAML mudou. Competições fora do catálogo ficam como estão. Devolve as linhas alteradas.
 */
export async function syncCompetitionPrestige(
  db: Database,
  sport: string,
  entries: readonly { slug: string; prestige?: number | undefined }[],
): Promise<number> {
  if (!entries.length) return 0;
  const values = entries.map(
    (e) => sql`(${e.slug}, ${Math.max(0, Math.min(10, Math.round(e.prestige ?? 0)))}::smallint)`,
  );
  const rows = await db.execute<{ id: string }>(sql`
    update core.competition c
       set prestige = v.prestige, updated_at = now()
      from (values ${sql.join(values, sql`, `)}) as v(slug, prestige)
     where c.sport = ${sport} and c.slug = v.slug and c.prestige <> v.prestige
    returning c.id`);
  return rows.length;
}
