import { eq, inArray, sql } from 'drizzle-orm';
import { country, type Database } from '@galaxie/db';
import type { GeoConfig } from '@galaxie/geo';

export type GeoSeedStats = {
  /** Países existentes atualizados (confederação, código COI e nomes pt-BR/es). */
  updated: number;
  /** Membros das confederações que o catálogo ainda não tem (não são criados). */
  absent: number;
};

/**
 * Preenche core.country a partir de config/geo/confederations.yaml (idempotente):
 * - `confederation` e `ioc_code` (quando o YAML tem) de todo membro já existente;
 * - nomes: mescla as traduções do YAML (pt-BR, es...) preservando o `en` do fornecedor.
 *
 * Nenhum país é criado: membros fora do catálogo não entram, para não poluir /v1/countries. Os países da navegação
 * vêm do próprio catálogo (os que têm liga nacional de primeira divisão), e a liga só existe com o país gravado.
 */
export async function seedGeo(db: Database, geo: GeoConfig): Promise<GeoSeedStats> {
  return db.transaction(async (tx) => {
    const members = geo.allCountries();
    const existing = new Set(
      (
        await tx
          .select({ code: country.code })
          .from(country)
          .where(
            inArray(
              country.code,
              members.map((m) => m.code),
            ),
          )
      ).map((r) => r.code),
    );

    let updated = 0;
    for (const m of members) {
      if (!existing.has(m.code)) continue;
      const { en: _en, ...translations } = m.name;
      await tx
        .update(country)
        .set({
          confederation: m.confederation,
          iocCode: m.ioc ?? sql`${country.iocCode}`,
          name: sql`${country.name} || ${JSON.stringify(translations)}::jsonb`,
        })
        .where(eq(country.code, m.code));
      updated += 1;
    }
    return { updated, absent: members.length - existing.size };
  });
}
