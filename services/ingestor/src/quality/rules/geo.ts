/**
 * Países: um código com mais de um país na api-sports (GB cobre Inglaterra, Escócia, País de Gales e Irlanda do
 * Norte, que têm código próprio GB-ENG etc.; UA, a Crimeia) tem sempre o nome do país inteiro, em todos os idiomas.
 * O nome de `core.country` é o que a API serve em todo `country_ref`.
 */
import { sql } from 'drizzle-orm';
import type { QualityFailureItem, QualityRule } from '../types.js';

/** Nome canônico por idioma dos códigos ambíguos (o mesmo da migration 0034_pais_gb_reino_unido). */
export const AMBIGUOUS_COUNTRIES: Record<string, Record<string, string>> = {
  GB: { en: 'United Kingdom', 'pt-BR': 'Reino Unido', es: 'Reino Unido' },
  UA: { en: 'Ukraine', 'pt-BR': 'Ucrânia', es: 'Ucrania' },
};

/** Idiomas em que o nome difere do canônico. */
export function wrongNames(code: string, names: Record<string, string> | null): string[] {
  const want = AMBIGUOUS_COUNTRIES[code];
  if (!want) return [];
  return Object.entries(want)
    .filter(([locale, name]) => names?.[locale] !== name)
    .map(([locale]) => locale);
}

export const GEO_RULES: QualityRule[] = [
  {
    id: 'geo.ambiguous-country-code',
    sport: 'geo',
    area: 'geo',
    severity: 'critical',
    description: {
      'pt-BR':
        'Código de país ambíguo (GB, UA) tem o nome do país inteiro: GB é o Reino Unido, nunca Gales, Escócia ou Inglaterra',
      en: 'An ambiguous country code (GB, UA) carries the whole country name: GB is the United Kingdom, never Wales, Scotland or England',
      es: 'Un código de país ambiguo (GB, UA) lleva el nombre del país entero: GB es el Reino Unido, nunca Gales, Escocia o Inglaterra',
    },
    origin: 'erro achado pelo dono do produto na demo (24/10/2026): Hamilton com "GB Wales"',
    check: async (ctx) => {
      const codes = Object.keys(AMBIGUOUS_COUNTRIES);
      const rows = await ctx.db.execute<{ code: string; name: Record<string, string> | null }>(sql`
        select code, name from core.country where code in (${sql.join(
          codes.map((c) => sql`${c}`),
          sql`, `,
        )})`);
      const failures: QualityFailureItem[] = [];
      for (const r of rows) {
        const wrong = wrongNames(r.code, r.name);
        if (wrong.length)
          failures.push({
            key: r.code,
            label: r.code,
            current: wrong.map((l) => `${l}: ${r.name?.[l] ?? '—'}`).join(' · '),
            expected: wrong.map((l) => `${l}: ${AMBIGUOUS_COUNTRIES[r.code]![l]}`).join(' · '),
            link: { type: 'country', id: r.code },
          });
      }
      return { checked: rows.length, failures };
    },
  },
];
