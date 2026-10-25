/**
 * Biografia do piloto de F1 no `profile` da carreira: nome completo, apelidos, morte, família no automobilismo e
 * vitórias fora da F1. Tudo do core, gravado pelo `f1:biografia` (F1DB e Wikidata com casamento estrito):
 *
 * - **Morte em corrida** = o resultado do piloto que o F1DB marca como fatal ("Fatal accident", "Fatal collision",
 *   "… in qualifying", "… in practice", "… in support race"). É a fonte do destaque; a morte pode ter vindo dias ou
 *   meses depois (Bianchi, Suzuka 2014).
 * - **Acidente** fora de GP: a circunstância do Wikidata (P1196 morte acidental) ou a causa de colisão (P509). A causa
 *   só aparece quando não é acidente (o rótulo "acidente rodoviário" do Wikidata não descreve um acidente de pista).
 * - **Local** da morte só quando o Wikidata registra um (Senna tem o circuito e o hospital: fica sem).
 */
import { sql } from 'drizzle-orm';
import type { DriverProfile } from '@galaxie/contracts';
import type { Database, ParticipantBioFacts, WikidataLabels } from '@galaxie/db';
import { pickText } from '../i18n.js';

type Bio = Pick<DriverProfile, 'full_name' | 'nicknames' | 'death' | 'family' | 'other_wins' | 'sources'>;

type CountryRef = { code: string; name: string };

/** Circunstâncias e causas que contam como acidente (morte acidental, acidente, colisão de trânsito). */
const ACCIDENT_MANNERS = new Set(['Q21142718', 'Q171558']);
const ACCIDENT_CAUSES = new Set(['Q9687', 'Q171558', 'Q2621476']);

/** Rótulo do Wikidata no idioma pedido (pt, es, en); sem ele, null. */
export function wikidataLabel(labels: WikidataLabels | undefined, locale: string): string | null {
  const lang = locale.split('-')[0] as 'pt' | 'es' | 'en';
  return labels?.[lang] ?? labels?.en ?? null;
}

/** Idade na data (anos completos). */
export function ageAt(birth: string | null, date: string): number | null {
  if (!birth) return null;
  const [by, bm, bd] = birth.split('-').map(Number) as [number, number, number];
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** "Fatal accident in qualifying" → onde foi o acidente. */
export function fatalSession(
  status: string,
): NonNullable<NonNullable<DriverProfile['death']>['race']>['session'] {
  const s = status.toLowerCase();
  if (s.includes('support')) return 'support_race';
  if (s.includes('qualifying')) return 'qualifying';
  if (s.includes('practice')) return 'practice';
  return 'race';
}

export interface BioRow {
  full_name: string | null;
  birth_date: string | null;
  death_date: string | null;
  bio_facts: ParticipantBioFacts | null;
}

export interface FatalRace {
  event_id: string;
  starts_at: string;
  status: string;
  stage: Record<string, string> | null;
  circuit: string | null;
  city: string | null;
}

/** Monta os campos da biografia (puro). `relatives` = participante de cada parente pelo id do F1DB. */
export function biographyOf(
  row: BioRow,
  fatal: FatalRace | null,
  relatives: Map<string, string>,
  countries: Map<string, CountryRef>,
  locale: string,
): Bio {
  const facts = row.bio_facts ?? {};
  const w = facts.wikidata;
  const accident =
    !!fatal ||
    (w?.death_manner ?? []).some((m) => ACCIDENT_MANNERS.has(m.qid)) ||
    (w?.death_cause ?? []).some((c) => ACCIDENT_CAUSES.has(c.qid));
  const cause = accident
    ? null
    : ((w?.death_cause ?? []).map((c) => wikidataLabel(c.labels, locale)).find(Boolean) ?? null);
  const place = w?.death_place ? wikidataLabel(w.death_place.labels, locale) : null;
  const nicknames = [...new Set((w?.nicknames ?? []).map((n) => n.text.trim()).filter(Boolean))].slice(0, 4);
  return {
    full_name: row.full_name,
    nicknames,
    death: row.death_date
      ? {
          date: row.death_date,
          age: ageAt(row.birth_date, row.death_date),
          place: place
            ? {
                name: place,
                country: w?.death_place?.country ? (countries.get(w.death_place.country) ?? null) : null,
              }
            : null,
          accident,
          cause,
          race: fatal
            ? {
                event_id: fatal.event_id,
                name: pickText(fatal.stage, locale, 'Grand Prix')!,
                date: new Date(fatal.starts_at).toISOString(),
                session: fatalSession(fatal.status),
                circuit: fatal.circuit,
                city: fatal.city,
              }
            : null,
        }
      : null,
    family: (facts.family ?? []).map((f) => ({
      relation: f.relation,
      gender: f.gender,
      driver: { id: relatives.get(f.f1db_id) ?? null, f1db_id: f.f1db_id, name: f.name },
    })),
    other_wins: (w?.wins ?? []).map((x) => ({
      race: x.race,
      year: x.year,
      source: `https://www.wikidata.org/wiki/${x.qid}`,
    })),
    sources: {
      f1db: 'https://github.com/f1db/f1db',
      wikidata: w ? `https://www.wikidata.org/wiki/${w.qid}` : null,
    },
  };
}

/** Biografia do piloto lida do core (participante, resultado fatal no F1DB, parentes e países). */
export async function loadBiography(db: Database, participantId: string, locale: string): Promise<Bio> {
  const [row] = await db.execute<BioRow & Record<string, unknown>>(sql`
    select p.full_name, to_char(p.birth_date, 'YYYY-MM-DD') as birth_date,
           to_char(p.death_date, 'YYYY-MM-DD') as death_date, p.bio_facts
      from core.participant p where p.id = ${participantId}::uuid`);
  if (!row) return {};
  const [fatal] = row.death_date
    ? await db.execute<FatalRace & Record<string, unknown>>(sql`
        select e.id::text as event_id, e.starts_at, ep.result->>'status' as status, st.name as stage,
               v.name as circuit, v.city
          from core.event_participant ep
          join core.event e on e.id = ep.event_id and e.sport = 'formula-1'
          join core.sport_event_detail sd on sd.event_id = e.id and sd.kind = 'race' and lower(sd.summary->>'type') = 'race'
          left join core.stage st on st.id = e.stage_id
          left join core.venue v on v.id = e.venue_id
         where ep.participant_id = ${participantId}::uuid and ep.result->>'status' ilike 'fatal%'
         order by e.starts_at desc limit 1`)
    : [];
  const family = row.bio_facts?.family ?? [];
  const relatives = family.length
    ? await db.execute<{ f1db_id: string; id: string }>(sql`
        select replace(provider_id, 'driver-', '') as f1db_id, entity_id::text as id from core.provider_map
         where provider = 'f1db' and entity_type = 'participant'
           and provider_id in (${sql.join(
             family.map((f) => sql`${`driver-${f.f1db_id}`}`),
             sql`, `,
           )})`)
    : [];
  const iso = row.bio_facts?.wikidata?.death_place?.country;
  const [country] = iso
    ? await db.execute<{ code: string; name: Record<string, string> | null }>(
        sql`select code, name from core.country where code = ${iso}`,
      )
    : [];
  const countries = new Map<string, CountryRef>(
    country
      ? [[country.code, { code: country.code, name: pickText(country.name, locale, country.code)! }]]
      : [],
  );
  return biographyOf(row, fatal ?? null, new Map(relatives.map((r) => [r.f1db_id, r.id])), countries, locale);
}
