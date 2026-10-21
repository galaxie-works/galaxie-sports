import { eq, inArray, sql } from 'drizzle-orm';
import { country, type Database } from '@galaxie/db';
import type { GeoConfig } from '@galaxie/geo';

export type GeoSeedStats = {
  /** Países da navegação que ainda não existiam em core.country (criados sem bandeira). */
  inserted: string[];
  /** Países existentes atualizados (confederação, código COI e nomes pt-BR/es). */
  updated: number;
  /** Membros das confederações que o catálogo ainda não tem (não são criados). */
  absent: number;
};

/**
 * Preenche core.country a partir de config/geo/confederations.yaml (idempotente):
 * - `confederation` e `ioc_code` (quando o YAML tem) de todo membro já existente;
 * - nomes: mescla as traduções do YAML (pt-BR, es...) preservando o `en` do fornecedor;
 * - países da navegação ausentes são criados (a bandeira chega depois, no bootstrap do catálogo).
 * Membros fora do catálogo não são criados, para não poluir /v1/countries.
 */
export async function seedGeo(db: Database, geo: GeoConfig): Promise<GeoSeedStats> {
  return db.transaction(async (tx) => {
    const members = geo.allCountries();
    const nav = new Set(geo.navigationCountries);
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

    const inserted: string[] = [];
    let updated = 0;
    for (const m of members) {
      if (!existing.has(m.code)) {
        if (!nav.has(m.code)) continue;
        await tx.insert(country).values({
          code: m.code,
          name: m.name,
          iocCode: m.ioc,
          confederation: m.confederation,
        });
        inserted.push(m.code);
        continue;
      }
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
    return { inserted, updated, absent: members.length - existing.size - inserted.length };
  });
}
