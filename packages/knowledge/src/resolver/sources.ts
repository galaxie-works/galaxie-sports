import { sql } from 'drizzle-orm';
import type { Executor } from '../derby.js';
import type { Candidate, CandidatePool } from './match.js';
import { normalizeName } from './normalize.js';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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
 * - raw /fixtures (times das partidas, com o país da liga — exceto competições "World");
 * - core.participant (+ provider_map da api-sports, quando existir).
 */
export async function loadCandidatePool(db: Executor): Promise<CandidatePool> {
  const codes = await countryCodes(db);
  const codeOf = (name: string | null) => (name ? (codes.get(normalizeName(name)) ?? null) : null);
  const byApiId = new Map<number, Candidate>();
  const coveredCountries = new Set<string>();

  for (const { params, body } of await latestBodies(db, '/teams')) {
    const keys = Object.keys(params);
    if (keys.length === 1 && keys[0] === 'country' && typeof params['country'] === 'string')
      coveredCountries.add(normalizeName(params['country']));
    for (const item of (body['response'] as unknown[] | undefined) ?? []) {
      const t = obj(obj(item)['team']);
      const v = obj(obj(item)['venue']);
      const id = num(t['id']);
      const name = str(t['name']);
      if (id === null || !name) continue;
      const countryName = str(t['country']);
      byApiId.set(id, {
        apiId: id,
        participantId: null,
        name,
        code: str(t['code']),
        countryName,
        countryCode: codeOf(countryName),
        founded: num(t['founded']),
        national: typeof t['national'] === 'boolean' ? t['national'] : null,
        venueCity: str(v['city']),
        source: 'teams',
      });
    }
  }

  for (const { body } of await latestBodies(db, '/fixtures'))
    for (const item of (body['response'] as unknown[] | undefined) ?? []) {
      const league = obj(obj(item)['league']);
      const leagueCountry = str(league['country']);
      const countryName = leagueCountry && normalizeName(leagueCountry) !== 'world' ? leagueCountry : null;
      for (const side of ['home', 'away']) {
        const t = obj(obj(obj(item)['teams'])[side]);
        const id = num(t['id']);
        const name = str(t['name']);
        if (id === null || !name) continue;
        const known = byApiId.get(id);
        if (known) {
          // a mesma equipe pode aparecer antes numa competição internacional (país "World")
          if (known.source === 'fixtures' && !known.countryName && countryName) {
            known.countryName = countryName;
            known.countryCode = codeOf(countryName);
          }
          continue;
        }
        byApiId.set(id, {
          apiId: id,
          participantId: null,
          name,
          code: null,
          countryName,
          countryCode: codeOf(countryName),
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
