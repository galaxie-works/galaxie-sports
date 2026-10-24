import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';
import type { SparqlBinding, SparqlClient } from '../multisport/wikidata/sparql-client.js';
import type { WikimediaClient } from './commons/client.js';
import { countriesMatch, namesMatch, type PhotoMatch } from './wikimedia-photos.js';

/**
 * Casamento estrito pelo time da temporada (Wikidata P54) para quem não tem data de nascimento no core: só liga
 * quando nome, idade (±1 ano) e time batem num candidato único. A nacionalidade só bloqueia quando os dois lados a
 * têm e divergem. Do Wikidata vêm nascimento (P569), nacionalidade (P27) e foto (P18, pelo fluxo da Commons).
 */

/** Tipos de clube aceitos (P31): clube e time de futebol; e as versões femininas. */
const MEN_TYPES = ['Q476028', 'Q15944511'];
const WOMEN_TYPES = ['Q103229495', 'Q28140340'];

export interface TeamTarget {
  /** Id do time na api-sports. */
  providerId: string;
  name: string;
  /** País do time em inglês (core.country.name.en). */
  country: string | null;
}

export interface TeamCandidate {
  personId: string;
  providerId: string;
  name: string;
  fullName: string | null;
  nationality: string | null;
  /** Idade informada pela api-sports (players/squads) e a data dessa informação. */
  age: number;
  ageAt: string;
  /** Times (api-sports) em que foi escalado na temporada. */
  teams: string[];
}

export type TeamResolution = { qid: string } | { ambiguous: string[] } | { none: true };

export interface TeamPlayer {
  qid: string;
  birthDate: string;
  labels: string[];
  countries: string[];
  image: string | null;
  teams: string[];
}

export interface TeamMatch {
  candidate: TeamCandidate;
  player: TeamPlayer;
}

export interface TeamMatchReport {
  matches: TeamMatch[];
  ambiguous: number;
  unmatched: number;
  /** Candidatos cujos times não têm QID único no Wikidata. */
  noTeam: number;
}

// ─── funções puras ───────────────────────────────────────────────────────────────────────────────

/** Time feminino na api-sports: nome terminado em " W" ("Roma W"). */
export function isWomenTeam(name: string): boolean {
  return /\sW$/.test(name.trim());
}

/** Nome para a busca: sem o " W" do feminino. */
export function teamSearchName(name: string): string {
  return name.trim().replace(/\sW$/, '');
}

/** Valores de uma propriedade nas afirmações do `wbgetentities` (ids de item). */
export function claimItemIds(claims: Record<string, unknown[]> | undefined, prop: string): string[] {
  return (claims?.[prop] ?? [])
    .map(
      (c) => (c as { mainsnak?: { datavalue?: { value?: { id?: string } } } }).mainsnak?.datavalue?.value?.id,
    )
    .filter((v): v is string => typeof v === 'string');
}

/**
 * Time do core → QID: entre os itens achados pela busca, os que são clube de futebol (do gênero certo) e do mesmo
 * país. Um só: resolvido. Mais de um: ambíguo. Nenhum: sem QID.
 */
export function resolveTeam(
  team: TeamTarget,
  found: string[],
  claims: Map<string, Record<string, unknown[]>>,
  countryLabels: Map<string, string>,
): TeamResolution {
  const types = new Set(isWomenTeam(team.name) ? WOMEN_TYPES : MEN_TYPES);
  const ok = [...new Set(found)].filter((id) => {
    const c = claims.get(id);
    if (!claimItemIds(c, 'P31').some((t) => types.has(t))) return false;
    const countries = claimItemIds(c, 'P17').map((q) => countryLabels.get(q) ?? q);
    return countriesMatch(team.country, countries);
  });
  if (ok.length === 1) return { qid: ok[0]! };
  return ok.length ? { ambiguous: ok } : { none: true };
}

/** Jogadores com passagem pelos times em 2026 (P54 com início até 2026 e fim a partir de 2026, quando houver). */
export function teamPlayersQuery(teamQids: string[], season = 2026): string {
  return `SELECT ?player ?team ?birth ?image ?label ?country WHERE {
  VALUES ?team { ${teamQids.map((q) => `wd:${q}`).join(' ')} }
  ?player p:P54 ?st. ?st ps:P54 ?team.
  OPTIONAL { ?st pq:P580 ?start }
  OPTIONAL { ?st pq:P582 ?end }
  FILTER(!BOUND(?start) || YEAR(?start) <= ${season})
  FILTER(!BOUND(?end) || YEAR(?end) >= ${season})
  ?player wdt:P569 ?birth.
  FILTER(YEAR(?birth) >= ${season - 50})
  OPTIONAL { ?player wdt:P18 ?image }
  ?player rdfs:label ?label FILTER(LANG(?label) IN ("en", "es", "pt", "fr", "it", "de"))
  OPTIONAL { ?player wdt:P27 ?c. ?c rdfs:label ?country FILTER(LANG(?country) = "en") }
}`;
}

export function teamPlayers(rows: SparqlBinding[]): TeamPlayer[] {
  const out = new Map<string, TeamPlayer>();
  for (const r of rows) {
    const qid = r.player?.value.split('/').pop();
    const team = r.team?.value.split('/').pop();
    if (!qid || !team || !r.birth) continue;
    const p = out.get(qid) ?? {
      qid,
      birthDate: r.birth.value.slice(0, 10),
      labels: [],
      countries: [],
      image: null,
      teams: [],
    };
    if (r.label && !p.labels.includes(r.label.value)) p.labels.push(r.label.value);
    if (r.country && !p.countries.includes(r.country.value)) p.countries.push(r.country.value);
    if (!p.teams.includes(team)) p.teams.push(team);
    const img = r.image?.value.split('/').pop();
    if (img && !p.image) p.image = decodeURIComponent(img).replace(/_/g, ' ');
    out.set(qid, p);
  }
  return [...out.values()];
}

/** Idade (anos completos) na data `at` de quem nasceu em `birth` (YYYY-MM-DD). */
export function ageOn(birth: string, at: string): number {
  const [by, bm, bd] = birth.split('-').map(Number) as [number, number, number];
  const [ay, am, ad] = at.slice(0, 10).split('-').map(Number) as [number, number, number];
  return ay - by - (am < bm || (am === bm && ad < bd) ? 1 : 0);
}

/**
 * Casa cada candidato com os jogadores dos times dele no Wikidata: nome compatível, idade com ±1 ano e
 * nacionalidade que não diverge. Liga só com um candidato único; o mesmo QID para duas pessoas do core não liga
 * nenhuma (conta como ambíguo).
 */
export function matchByTeam(
  candidates: TeamCandidate[],
  players: TeamPlayer[],
  teams: Map<string, TeamResolution>,
): TeamMatchReport {
  const byTeam = new Map<string, TeamPlayer[]>();
  for (const p of players) for (const t of p.teams) byTeam.set(t, [...(byTeam.get(t) ?? []), p]);
  const report: TeamMatchReport = { matches: [], ambiguous: 0, unmatched: 0, noTeam: 0 };
  const found: TeamMatch[] = [];
  for (const c of candidates) {
    const qids = c.teams.flatMap((t) => {
      const r = teams.get(t);
      return r && 'qid' in r ? [r.qid] : [];
    });
    if (!qids.length) {
      report.noTeam += 1;
      continue;
    }
    const pool = [...new Map(qids.flatMap((q) => byTeam.get(q) ?? []).map((p) => [p.qid, p])).values()];
    const hits = pool.filter(
      (p) =>
        p.labels.some((l) => namesMatch(c, l)) &&
        Math.abs(ageOn(p.birthDate, c.ageAt) - c.age) <= 1 &&
        countriesMatch(c.nationality, p.countries),
    );
    if (hits.length === 1) found.push({ candidate: c, player: hits[0]! });
    else if (hits.length > 1) report.ambiguous += 1;
    else report.unmatched += 1;
  }
  const uses = new Map<string, number>();
  for (const m of found) uses.set(m.player.qid, (uses.get(m.player.qid) ?? 0) + 1);
  for (const m of found) {
    if (uses.get(m.player.qid) === 1) report.matches.push(m);
    else report.ambiguous += 1;
  }
  return report;
}

/** Nacionalidade a gravar: só com um país no Wikidata (dupla nacionalidade não decide sozinha). */
export function nationalityOf(p: TeamPlayer): string | null {
  return p.countries.length === 1 ? p.countries[0]! : null;
}

/** O casamento no formato do fluxo de fotos da Commons (`importPeoplePhotos`). */
export function asPhotoMatch(m: TeamMatch): PhotoMatch | null {
  if (!m.player.image) return null;
  return {
    candidate: {
      personId: m.candidate.personId,
      providerId: m.candidate.providerId,
      name: m.candidate.name,
      fullName: m.candidate.fullName,
      birthDate: m.player.birthDate,
      nationality: m.candidate.nationality,
    },
    person: {
      qid: m.player.qid,
      birthDate: m.player.birthDate,
      labels: m.player.labels,
      countries: m.player.countries,
      image: m.player.image,
    },
  };
}

// ─── banco e Wikidata ────────────────────────────────────────────────────────────────────────────

/**
 * Jogadores sem foto e sem nascimento escalados desde `since` em competições tier ≤ `maxTier`, com a idade do
 * elenco mais recente (`players/squads` no raw) e os times da temporada. Sem idade, fica de fora (técnicos inclusive).
 */
export async function teamCandidates(
  db: Database,
  options: { since: Date; maxTier: number },
): Promise<{ candidates: TeamCandidate[]; teams: TeamTarget[] }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local max_parallel_workers_per_gather = 0`);
    const rows = await tx.execute<{
      person_id: string;
      provider_id: string;
      name: string;
      full_name: string | null;
      nationality: string | null;
      age: number;
      age_at: string;
      teams: string[];
    }>(sql`
      with lu as (
        select distinct p->'player'->>'id' as pid, l->'team'->>'id' as team
        from core.football_fixture f
        join core.event e on e.id = f.event_id
        join core.competition c on c.id = e.competition_id,
          lateral jsonb_array_elements(case when jsonb_typeof(f.detail->'lineups') = 'array' then f.detail->'lineups' else '[]'::jsonb end) l,
          lateral jsonb_array_elements(coalesce(l->'startXI', '[]'::jsonb) || coalesce(l->'substitutes', '[]'::jsonb)) p
        where f.detail is not null and e.starts_at >= ${options.since.toISOString()}::timestamptz and c.tier <= ${options.maxTier}
          and p->'player'->>'id' is not null and l->'team'->>'id' is not null
      ),
      idade as (
        select distinct on (pl->>'id') pl->>'id' as pid, (pl->>'age')::int as age, r.fetched_at
        from raw.api_response r,
          lateral jsonb_array_elements(case when jsonb_typeof(r.body->'response') = 'array' then r.body->'response' else '[]'::jsonb end) s,
          lateral jsonb_array_elements(case when jsonb_typeof(s->'players') = 'array' then s->'players' else '[]'::jsonb end) pl
        where r.provider = 'api-sports' and r.sport = 'football' and r.endpoint = '/players/squads'
          and pl->>'age' ~ '^[0-9]+$'
        order by pl->>'id', r.fetched_at desc
      )
      select p.id as person_id, m.provider_id, p.name,
             nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as full_name,
             p.nationality, i.age, i.fetched_at::date::text as age_at, array_agg(distinct lu.team) as teams
      from lu
      join idade i on i.pid = lu.pid
      join core.provider_map m on m.provider = 'api-sports' and m.sport = 'football' and m.entity_type = 'person'
        and m.provider_id = lu.pid
      join core.person p on p.id = m.entity_id
      where p.photo_asset_id is null and p.birth_date is null and m.provider_id ~ '^[1-9][0-9]*$'
      group by p.id, m.provider_id, p.name, p.first_name, p.last_name, p.nationality, i.age, i.fetched_at
    `);
    const candidates = [...rows].map((r) => ({
      personId: r.person_id,
      providerId: r.provider_id,
      name: r.name,
      fullName: r.full_name,
      nationality: r.nationality,
      age: Number(r.age),
      ageAt: r.age_at,
      teams: r.teams,
    }));
    const ids = [...new Set(candidates.flatMap((c) => c.teams))];
    const teams = ids.length
      ? await tx.execute<{ provider_id: string; name: string; country: string | null }>(sql`
          select m.provider_id, pa.name, co.name->>'en' as country
          from core.provider_map m
          join core.participant pa on pa.id = m.entity_id
          left join core.country co on co.code = pa.country_code
          where m.provider = 'api-sports' and m.sport = 'football' and m.entity_type = 'participant'
            and m.provider_id in (${sql.join(
              ids.map((i) => sql`${i}`),
              sql`, `,
            )})
        `)
      : [];
    return {
      candidates,
      teams: [...teams].map((t) => ({ providerId: t.provider_id, name: t.name, country: t.country })),
    };
  });
}

/** Resolve os times no Wikidata: busca pelo nome (sem acento importar), afirmações P31/P17 e rótulo dos países. */
export async function resolveTeams(
  client: WikimediaClient,
  sparql: SparqlClient,
  teams: TeamTarget[],
  options: { onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<string, TeamResolution>> {
  const found = new Map<string, string[]>();
  let done = 0;
  for (const t of teams) {
    found.set(t.providerId, await client.searchItems(teamSearchName(t.name), 10));
    if (++done % 100 === 0 || done === teams.length) options.onProgress?.(done, teams.length);
  }
  const ids = [...new Set([...found.values()].flat())];
  const claims = ids.length
    ? await client.claims(ids, ['P31', 'P17'])
    : new Map<string, Record<string, unknown[]>>();
  const countryIds = [...new Set([...claims.values()].flatMap((c) => claimItemIds(c, 'P17')))];
  const countryLabels = new Map<string, string>();
  for (let i = 0; i < countryIds.length; i += 200) {
    const batch = countryIds.slice(i, i + 200);
    const { data } = await sparql.query(
      'country-labels',
      `SELECT ?c ?label WHERE { VALUES ?c { ${batch.map((q) => `wd:${q}`).join(' ')} } ?c rdfs:label ?label FILTER(LANG(?label) = "en") }`,
      { first: batch[0]!, n: batch.length },
    );
    for (const r of data.results.bindings) {
      const q = r.c?.value.split('/').pop();
      if (q && r.label) countryLabels.set(q, r.label.value);
    }
  }
  const out = new Map<string, TeamResolution>();
  for (const t of teams)
    out.set(t.providerId, resolveTeam(t, found.get(t.providerId) ?? [], claims, countryLabels));
  return out;
}

/** Jogadores dos times resolvidos, em lotes de `teamsPerQuery` times. */
export async function findTeamPlayers(
  sparql: SparqlClient,
  teamQids: string[],
  options: { teamsPerQuery?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<TeamPlayer[]> {
  const size = options.teamsPerQuery ?? 10;
  const unique = [...new Set(teamQids)].sort();
  const players = new Map<string, TeamPlayer>();
  for (let i = 0; i < unique.length; i += size) {
    const batch = unique.slice(i, i + size);
    const { data } = await sparql.query('football-team-players-2026', teamPlayersQuery(batch), {
      first: batch[0]!,
      n: batch.length,
    });
    for (const p of teamPlayers(data.results.bindings)) {
      const prev = players.get(p.qid);
      if (prev) prev.teams = [...new Set([...prev.teams, ...p.teams])];
      else players.set(p.qid, p);
    }
    options.onProgress?.(Math.min(i + size, unique.length), unique.length);
  }
  return [...players.values()];
}

export interface BioReport {
  linked: number;
  birthDates: number;
  nationalities: number;
}

/**
 * Grava o que veio do Wikidata: nascimento e nacionalidade só onde o core não tem (o null nunca apaga) e o QID em
 * `core.provider_map` (`wikidata`/`football`/`person`). Grava também o QID dos times resolvidos (`participant`).
 */
export async function saveTeamMatches(
  db: Database,
  matches: TeamMatch[],
  teams: Map<string, TeamResolution>,
): Promise<BioReport> {
  const report: BioReport = { linked: 0, birthDates: 0, nationalities: 0 };
  for (const m of matches) {
    await db.transaction(async (tx) => {
      const [before] = await tx.execute<{ birth: string | null; nat: string | null }>(sql`
        select birth_date::text as birth, nationality as nat from core.person where id = ${m.candidate.personId} for update
      `);
      if (!before) return;
      const nat = nationalityOf(m.player);
      await tx.execute(sql`
        update core.person
        set birth_date = coalesce(birth_date, ${m.player.birthDate}::date),
            nationality = coalesce(nationality, ${nat}),
            updated_at = now()
        where id = ${m.candidate.personId}
      `);
      if (!before.birth) report.birthDates += 1;
      if (!before.nat && nat) report.nationalities += 1;
      await tx.execute(sql`
        insert into core.provider_map (entity_type, entity_id, provider, sport, provider_id)
        values ('person', ${m.candidate.personId}, 'wikidata', 'football', ${m.player.qid})
        on conflict do nothing
      `);
      report.linked += 1;
    });
  }
  for (const [providerId, r] of teams) {
    if (!('qid' in r)) continue;
    await db.execute(sql`
      insert into core.provider_map (entity_type, entity_id, provider, sport, provider_id)
      select 'participant', m.entity_id, 'wikidata', 'football', ${r.qid}
      from core.provider_map m
      where m.provider = 'api-sports' and m.sport = 'football' and m.entity_type = 'participant' and m.provider_id = ${providerId}
      on conflict do nothing
    `);
  }
  return report;
}
