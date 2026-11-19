import { sql } from 'drizzle-orm';
import type { Executor } from '../derby.js';
import type { Candidate, CandidatePool } from './match.js';
import { normalizeName } from './normalize.js';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

/** Resposta mais recente de cada (endpoint, params) da api-sports de futebol no raw. */
async function latestBodies(db: Executor, endpoint: string): Promise<{ params: Json; body: Json }[]> {
  const rows = await db.execute<{ params: Json; body: Json }>(sql`
    select distinct on (params::text, page) params, body
      from raw.api_response
     where provider = 'api-sports' and sport = 'football' and endpoint = ${endpoint} and status_code = 200
     order by params::text, page, fetched_at desc`);
  return [...rows];
}

/** Nome do país na api-sports → código (ex.: "England" → "GB-ENG"), a partir de /leagues e /countries. */
async function countryCodes(db: Executor): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const { body } of await latestBodies(db, '/leagues'))
    for (const item of (body['response'] as unknown[] | undefined) ?? []) {
      const c = obj(obj(item)['country']);
      const name = str(c['name']);
      const code = str(c['code']);
      if (name && code) out.set(normalizeName(name), code.toUpperCase());
    }
  for (const { body } of await latestBodies(db, '/countries'))
    for (const item of (body['response'] as unknown[] | undefined) ?? []) {
      const name = str(obj(item)['name']);
      const code = str(obj(item)['code']);
      if (name && code && !out.has(normalizeName(name))) out.set(normalizeName(name), code.toUpperCase());
    }
  return out;
}

/**
 * Candidatos para o casamento, lidos só do banco local (nenhuma chamada à api-sports):
 * - raw /teams?country=X (lista completa do país → país "coberto");
 * - raw /fixtures (times das partidas, com o país da liga), só com `includeFixtures`;
 * - core.participant (+ provider_map da api-sports, quando existir).
 */
export async function loadCandidatePool(
  db: Executor,
  options: { includeFixtures?: boolean } = {},
): Promise<CandidatePool> {
  const codes = await countryCodes(db);
  const codeOf = (name: string | null) => (name ? (codes.get(normalizeName(name)) ?? null) : null);
  const byApiId = new Map<number, Candidate>();
  const coveredCountries = new Set<string>();

  // As listas de times saem do raw já achatadas no banco: carregar os corpos inteiros de /teams e /fixtures
  // estoura a memória com a base completa (centenas de milhares de respostas).
  const covered = await db.execute<{ country: string }>(sql`
    select distinct params->>'country' as country
      from raw.api_response
     where provider = 'api-sports' and sport = 'football' and endpoint = '/teams' and status_code = 200
       and params ? 'country' and (select count(*) from jsonb_object_keys(params)) = 1`);
  for (const { country } of covered) if (country) coveredCountries.add(normalizeName(country));

  const teams = await db.execute<{
    id: number;
    name: string | null;
    code: string | null;
    country: string | null;
    founded: number | null;
    national: boolean | null;
    city: string | null;
  }>(sql`
    select distinct on (id) id, name, code, country, founded, national, city
      from (
        select case when r->'team'->>'id' ~ '^[0-9]{1,9}$' then (r->'team'->>'id')::int end as id,
               r->'team'->>'name' as name, r->'team'->>'code' as code, r->'team'->>'country' as country,
               case when r->'team'->>'founded' ~ '^[0-9]{1,9}$' then (r->'team'->>'founded')::int end as founded,
               case when jsonb_typeof(r->'team'->'national') = 'boolean' then (r->'team'->>'national')::boolean end
                 as national,
               r->'venue'->>'city' as city, a.fetched_at
          from raw.api_response a
          cross join lateral jsonb_array_elements(
            case when jsonb_typeof(a.body->'response') = 'array' then a.body->'response' else '[]'::jsonb end) r
         where a.provider = 'api-sports' and a.sport = 'football' and a.endpoint = '/teams' and a.status_code = 200
      ) t
     where id is not null and btrim(coalesce(name, '')) <> ''
     order by id, fetched_at desc`);
  for (const t of teams) {
    byApiId.set(t.id, {
      apiId: t.id,
      participantId: null,
      name: t.name!,
      code: str(t.code),
      countryName: str(t.country),
      countryCode: codeOf(str(t.country)),
      founded: t.founded,
      national: t.national,
      venueCity: str(t.city),
      source: 'teams',
    });
  }

  // Times das partidas (/fixtures), com o país da liga (exceto competições "World"); o nome mais recente vale.
  // Só com `includeFixtures`: desde a carga completa (11/11/2026) todo time de partida já está em core.participant
  // com o id da api-sports (bloco abaixo), e varrer todas as respostas de /fixtures passa do statement_timeout.
  if (options.includeFixtures) {
    const fixtureTeams = await db.execute<{ id: number; name: string; country: string | null }>(sql`
      select id, (array_agg(name order by fetched_at desc))[1] as name,
             max(country) filter (where country is not null and lower(country) <> 'world') as country
        from (
          select case when x->>'id' ~ '^[0-9]{1,9}$' then (x->>'id')::int end as id, x->>'name' as name,
                 f->'league'->>'country' as country, a.fetched_at
            from raw.api_response a
            cross join lateral jsonb_array_elements(
              case when jsonb_typeof(a.body->'response') = 'array' then a.body->'response' else '[]'::jsonb end) f
            cross join lateral (values (f->'teams'->'home'), (f->'teams'->'away')) s(x)
           where a.provider = 'api-sports' and a.sport = 'football' and a.endpoint = '/fixtures'
             and a.status_code = 200
        ) t
       where id is not null and btrim(coalesce(name, '')) <> ''
       group by id`);
    for (const t of fixtureTeams) {
      if (byApiId.has(t.id)) continue;
      byApiId.set(t.id, {
        apiId: t.id,
        participantId: null,
        name: t.name,
        code: null,
        countryName: t.country,
        countryCode: codeOf(t.country),
        founded: null,
        national: null,
        venueCity: null,
        source: 'fixtures',
      });
    }
  }

  const participants = await db.execute<{
    id: string;
    name: string;
    code: string | null;
    country_code: string | null;
    kind: string;
    founded: number | null;
    provider_id: string | null;
  }>(sql`
    select p.id, p.name, p.code, p.country_code, p.kind::text as kind, p.founded, pm.provider_id
      from core.participant p
      left join core.provider_map pm
        on pm.entity_type = 'participant' and pm.entity_id = p.id
       and pm.provider = 'api-sports' and pm.sport = 'football'
     where p.sport = 'football' and p.kind in ('club', 'national_team')`);
  const extra: Candidate[] = [];
  for (const p of participants) {
    const apiId = p.provider_id && /^\d+$/.test(p.provider_id) ? Number(p.provider_id) : null;
    const known = apiId !== null ? byApiId.get(apiId) : undefined;
    if (known) {
      known.participantId = p.id;
      continue;
    }
    const candidate: Candidate = {
      apiId,
      participantId: p.id,
      name: p.name,
      code: p.code,
      countryName: null,
      countryCode: p.country_code,
      founded: p.founded,
      national: p.kind === 'national_team',
      venueCity: null,
      source: 'participant',
    };
    if (apiId !== null) byApiId.set(apiId, candidate);
    else extra.push(candidate);
  }

  return { candidates: [...byApiId.values(), ...extra], coveredCountries };
}
