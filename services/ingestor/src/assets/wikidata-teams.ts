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

/**
 * Tipos de clube aceitos (P31): clube e time de futebol, time masculino (Q103229495), feminino (Q28140340) e clube
 * poliesportivo (Q847017, o Boca Juniors só tem esse). O tipo não diz a categoria: o Chelsea é Q103229495, o
 * Boca Q847017, e as categorias de base do Boca são Q15944511. A categoria sai do rótulo e da descrição.
 */
const FOOTBALL_TYPES = new Set(['Q476028', 'Q15944511', 'Q103229495', 'Q28140340']);
const SPORTS_CLUB_TYPE = 'Q847017';
const WOMEN_TEAM_TYPE = 'Q28140340';

/**
 * Categoria de um time: o principal masculino, o feminino, a base (sub-N, academia), a reserva (B, II) ou outra
 * modalidade (futsal, areia, amputados), que nunca liga.
 */
export type TeamCategory = 'senior' | 'women' | 'youth' | 'reserve' | 'other';

export interface TeamTarget {
  /** Id do time na api-sports. */
  providerId: string;
  name: string;
  /** País do time em inglês (core.country.name.en). */
  country: string | null;
  /** Ligas nacionais em que o time jogou (core.competition.name), para desempatar homônimos. */
  leagues: string[];
}

/** Item do Wikidata achado na busca pelo time, com os nomes das ligas (P118) já resolvidos. */
export interface TeamItem {
  label: string | null;
  names: string[];
  description: string | null;
  types: string[];
  /** Países (P17) em inglês. */
  countries: string[];
  /** Nomes (rótulos e apelidos) das ligas (P118). */
  leagues: string[];
  /** Itens de que este faz parte (P361): o time principal alemão aponta para o clube. */
  partOf: string[];
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

/** Categoria do nosso time pelo nome da api-sports ("Roma W", "Palmeiras U20", "Barcelona B", "Estudiantes Res."). */
export function teamCategory(name: string): TeamCategory {
  const n = name.trim();
  if (/\s(W|Women|Fem\.?|Femenino|Feminino)$/i.test(n)) return 'women';
  if (/\s(U-?\d{2}|Sub-?\d{2})$/i.test(n)) return 'youth';
  if (/\s(II|III|B|Res\.?|Reserves?)$/i.test(n)) return 'reserve';
  return 'senior';
}

const WOMEN_WORDS = /\b(women|ladies|femenino|feminino|femminile|frauen|f[ée]minines?|dames|vrouwen)\b/i;
const YOUTH_WORDS = /\b(youth|academy|u-?\d{2}|under-\d{2}|sub-?\d{2}|juvenil|primavera|jugend)\b/i;
const RESERVE_WORDS = /\b(reserves?|second team|b team)\b/i;
/** Outra modalidade. "Esports" sozinho fica de fora: é "esportes" em catalão (Centre d'Esports Sabadell). */
const OTHER_WORDS = /\b(futsal|beach|amputee|e-sports|esports team|video game|blind|veterans)\b/i;
/** Outro esporte na descrição de um clube só poliesportivo ("handball team", "motorcycle speedway club"). */
const OTHER_SPORTS = /\b(speedway|handball|basketball|volleyball|hockey|rugby|cricket|baseball)\b/i;

/**
 * Categoria do item do Wikidata pelo rótulo e pela descrição ("Chelsea F.C. Women", "reserve and youth academy
 * teams of Boca Juniors", "Real Madrid Castilla: association football reserve team"). Os apelidos ficam de fora:
 * o do Hoffenheim inclui "1899 Hoffenheim II".
 */
export function itemCategory(item: Pick<TeamItem, 'label' | 'description' | 'types'>): TeamCategory {
  const text = [item.label, item.description].filter(Boolean).join(' | ');
  if (OTHER_WORDS.test(text)) return 'other';
  if (!item.types.some((t) => FOOTBALL_TYPES.has(t)) && OTHER_SPORTS.test(text)) return 'other';
  if (item.types.includes(WOMEN_TEAM_TYPE) || WOMEN_WORDS.test(text)) return 'women';
  if (YOUTH_WORDS.test(text)) return 'youth';
  if (RESERVE_WORDS.test(text) || /\s(II|III|B)$/.test(item.label ?? '')) return 'reserve';
  return 'senior';
}

/** Item do primeiro time masculino de um clube ("first men's team of 1. FC Heidenheim"). */
const FIRST_TEAM = /\bfirst (men's )?((association )?football |soccer )?team\b/i;

/** Nome para a busca: sem o sufixo de categoria (" W", " U20", " II"…). */
export function teamSearchName(name: string): string {
  const n = name.trim();
  return teamCategory(n) === 'senior' ? n : n.replace(/\s\S+$/, '');
}

/** Nome comparável: sem acento, caixa e pontuação ("Estudiantes L.P." = "Estudiantes LP"). */
export function normalizeTeamName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Valores de uma propriedade nas afirmações do `wbgetentities` (ids de item). */
export function claimItemIds(claims: Record<string, unknown[]> | undefined, prop: string): string[] {
  return (claims?.[prop] ?? [])
    .map(
      (c) => (c as { mainsnak?: { datavalue?: { value?: { id?: string } } } }).mainsnak?.datavalue?.value?.id,
    )
    .filter((v): v is string => typeof v === 'string');
}

/** Os que passam no teste; se nenhum passa, todos seguem (o desempate não elimina sozinho). */
function narrow(ids: string[], test: (id: string) => boolean): string[] {
  const hit = ids.filter(test);
  return hit.length ? hit : ids;
}

/** Liga do Wikidata compatível com a nossa: nome igual, ou um contém o outro ("Scottish Premiership" ⊃ "Premiership"). */
function leagueMatches(ours: string, theirs: string): boolean {
  if (ours === theirs) return true;
  const [short, long] = ours.length < theirs.length ? [ours, theirs] : [theirs, ours];
  return short.length >= 6 && ` ${long} `.includes(` ${short} `);
}

/**
 * Time do core → QID: entre os itens achados pela busca, os que são clube de futebol (ou poliesportivo), do mesmo
 * país e da mesma categoria (o principal nunca liga com o feminino, a base ou a reserva). Um item principal com o
 * nome inteiro igual ao nosso também vale ("Willem II" é o principal, não a reserva do "Willem"); o feminino de
 * mesmo nome não (o "Club Tijuana" feminino). Entre os que sobram:
 * - o time de futebol passa à frente do clube poliesportivo de mesmo nome (Kongsvinger IL Toppfotball × Kongsvinger
 *   IL);
 * - o clube passa à frente do item do primeiro time dele ("first men's team of 1. FC Heidenheim", P361 = o clube):
 *   é no clube que o P54 dos jogadores aponta;
 * - homônimos desempatam pelo nome exato (rótulo ou apelido) e depois pela liga (P118 com o nome de uma liga em
 *   que o time jogou).
 * Um só: resolvido. Mais de um: ambíguo. Nenhum: sem QID.
 */
export function resolveTeam(team: TeamTarget, found: string[], items: Map<string, TeamItem>): TeamResolution {
  const category = teamCategory(team.name);
  const fullName = normalizeTeamName(team.name);
  let ok = [...new Set(found)].filter((id) => {
    const it = items.get(id);
    if (!it) return false;
    const itCategory = itemCategory(it);
    const sameCategory =
      itCategory === category ||
      (itCategory === 'senior' && it.names.some((n) => normalizeTeamName(n) === fullName));
    return (
      it.types.some((t) => FOOTBALL_TYPES.has(t) || t === SPORTS_CLUB_TYPE) &&
      countriesMatch(team.country, it.countries) &&
      sameCategory
    );
  });
  if (ok.length > 1) ok = narrow(ok, (id) => items.get(id)!.types.some((t) => FOOTBALL_TYPES.has(t)));
  if (ok.length > 1) {
    const set = new Set(ok);
    ok = narrow(ok, (id) => {
      const it = items.get(id)!;
      return !it.partOf.some((p) => set.has(p)) && !FIRST_TEAM.test(it.description ?? '');
    });
  }
  const name = normalizeTeamName(teamSearchName(team.name));
  if (ok.length > 1) ok = narrow(ok, (id) => items.get(id)!.names.some((n) => normalizeTeamName(n) === name));
  const leagues = new Set(team.leagues.map(normalizeTeamName));
  if (ok.length > 1 && leagues.size)
    ok = narrow(ok, (id) =>
      items.get(id)!.leagues.some((l) => [...leagues].some((o) => leagueMatches(o, normalizeTeamName(l)))),
    );
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
      ? await tx.execute<{
          provider_id: string;
          name: string;
          country: string | null;
          leagues: string[] | null;
        }>(sql`
          with t as (
            select m.provider_id, pa.id, pa.name, pa.country_code
            from core.provider_map m
            join core.participant pa on pa.id = m.entity_id
            where m.provider = 'api-sports' and m.sport = 'football' and m.entity_type = 'participant'
              and m.provider_id in (${sql.join(
                ids.map((i) => sql`${i}`),
                sql`, `,
              )})
          ),
          lg as (
            select ep.participant_id, array_agg(distinct c.name) as leagues
            from core.event_participant ep
            join core.event e on e.id = ep.event_id
            join core.competition c on c.id = e.competition_id
            where ep.participant_id in (select id from t) and c.type = 'league'
              and e.starts_at >= ${options.since.toISOString()}::timestamptz
            group by ep.participant_id
          )
          select t.provider_id, t.name, co.name->>'en' as country, lg.leagues
          from t
          left join core.country co on co.code = t.country_code
          left join lg on lg.participant_id = t.id
        `)
      : [];
    return {
      candidates,
      teams: [...teams].map((t) => ({
        providerId: t.provider_id,
        name: t.name,
        country: t.country,
        leagues: t.leagues ?? [],
      })),
    };
  });
}

/** Línguas dos nomes das ligas: as das ligas que cobrimos ("Liga Profesional Argentina", "Brasileirão"). */
const LEAGUE_LANGUAGES = ['en', 'es', 'pt', 'it', 'fr', 'de'];

/**
 * Resolve os times no Wikidata: busca pelo nome (sem acento importar), rótulo, apelidos, descrição e afirmações
 * P31/P17/P118 dos achados, e os nomes dos países e das ligas.
 */
export async function resolveTeams(
  client: WikimediaClient,
  teams: TeamTarget[],
  options: { onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<string, TeamResolution>> {
  const found = new Map<string, string[]>();
  let done = 0;
  for (const t of teams) {
    // o nome inteiro acha "Willem II" e "Inter U23"; sem o sufixo, o clube principal do " W" e do " U20"
    const names = [...new Set([t.name.trim(), teamSearchName(t.name)])];
    const ids: string[] = [];
    for (const n of names) ids.push(...(await client.searchItems(n, 10)));
    found.set(t.providerId, [...new Set(ids)]);
    if (++done % 100 === 0 || done === teams.length) options.onProgress?.(done, teams.length);
  }
  const ids = [...new Set([...found.values()].flat())];
  const raw = await client.items(ids, ['P31', 'P17', 'P118', 'P361']);
  const refs = (prop: string) => [
    ...new Set([...raw.values()].flatMap((it) => claimItemIds(it.claims, prop))),
  ];
  const countries = await client.items(refs('P17'), []);
  const leagues = await client.items(refs('P118'), [], LEAGUE_LANGUAGES);
  const items = new Map<string, TeamItem>();
  for (const [id, it] of raw)
    items.set(id, {
      label: it.label,
      names: it.names,
      description: it.description,
      types: claimItemIds(it.claims, 'P31'),
      countries: claimItemIds(it.claims, 'P17').map((q) => countries.get(q)?.label ?? q),
      leagues: claimItemIds(it.claims, 'P118').flatMap((q) => leagues.get(q)?.names ?? []),
      partOf: claimItemIds(it.claims, 'P361'),
    });
  const out = new Map<string, TeamResolution>();
  for (const t of teams) out.set(t.providerId, resolveTeam(t, found.get(t.providerId) ?? [], items));
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
