/**
 * Biografia do piloto de F1 (`f1:biografia`): fatos estruturados, sem IA, cada um com a fonte.
 *
 * - F1DB (raw do release): nome completo, data da morte e a família no automobilismo
 *   (`driver_family_relationship`: `type` é o que o parente é do piloto — `PARENT` = pai ou mãe).
 * - Wikidata, só com o QID casado de forma **estrita**: a mesma data de nascimento do F1DB **e** o id do piloto
 *   (P3684 Driver Database ou P8140 motorsportstats igual ao id do F1DB) ou, sem ele, o nome em inglês igual ao do
 *   F1DB com a ocupação de piloto; o candidato tem de ser único. Do QID: local da morte (P20, só quando há um), causa
 *   (P509) e circunstância (P1196) da morte, apelidos (P1449) e vitórias nas 500 Milhas de Indianápolis e nas 24 Horas
 *   de Le Mans (P1346 nas edições). Se a data da morte do Wikidata (P570) divergir da do F1DB, os fatos da morte
 *   ficam de fora: na dúvida, não mostra.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { apiResponse, type Database, type ParticipantBioFacts, type WikidataLabels } from '@galaxie/db';
import {
  F1DB_PROVIDER,
  rowsOf,
  str,
  type F1dbRow,
  type F1dbTableName,
  type F1dbTables,
} from '@galaxie/providers';
import type { SparqlBinding, SparqlClient } from '../multisport/wikidata/sparql-client.js';

export interface DriverBio {
  f1dbId: string;
  name: string;
  fullName: string | null;
  birthDate: string | null;
  deathDate: string | null;
  family: NonNullable<ParticipantBioFacts['family']>;
}

const genderOf = (v: unknown): 'male' | 'female' | null =>
  v === 'MALE' ? 'male' : v === 'FEMALE' ? 'female' : null;

/** Nome completo, morte e família de cada piloto do F1DB. Puro. */
export function f1dbBiographies(tables: F1dbTables): Map<string, DriverBio> {
  const drivers = new Map(rowsOf(tables, 'driver').map((d) => [str(d.id)!, d]));
  const out = new Map<string, DriverBio>();
  for (const [id, d] of drivers)
    out.set(id, {
      f1dbId: id,
      name: str(d.name) ?? id,
      fullName: str(d.full_name),
      birthDate: str(d.date_of_birth),
      deathDate: str(d.date_of_death),
      family: [],
    });
  const relations = [...rowsOf(tables, 'driver_family_relationship')].sort(
    (a, b) => Number(a.position_display_order ?? 0) - Number(b.position_display_order ?? 0),
  );
  for (const r of relations) {
    const bio = out.get(str(r.driver_id) ?? '');
    const other = drivers.get(str(r.other_driver_id) ?? '');
    const relation = str(r.type);
    if (!bio || !other || !relation) continue;
    bio.family.push({
      relation,
      f1db_id: str(other.id)!,
      name: str(other.name) ?? str(other.id)!,
      gender: genderOf(other.gender),
    });
  }
  return out;
}

/** As tabelas do F1DB que a biografia usa, do último release gravado no raw. */
export async function loadBiographyTables(db: Database): Promise<F1dbTables> {
  const tables: readonly F1dbTableName[] = ['driver', 'driver_family_relationship'];
  const [latest] = await db.execute<{ sha: string }>(sql`
    select params->>'package_sha256' as sha from raw.api_response
     where provider = 'f1db' and endpoint = 'sqlite/driver_family_relationship'
     order by fetched_at desc limit 1`);
  if (!latest)
    throw new Error('F1DB sem a tabela driver_family_relationship no raw: rode f1db:import --previa antes.');
  const pages = await db
    .select({ body: apiResponse.body })
    .from(apiResponse)
    .where(
      and(
        eq(apiResponse.provider, F1DB_PROVIDER),
        sql`${apiResponse.params}->>'package_sha256' = ${latest.sha}`,
        inArray(
          apiResponse.endpoint,
          tables.map((t) => `sqlite/${t}`),
        ),
      ),
    )
    .orderBy(asc(apiResponse.endpoint), asc(apiResponse.page));
  const out: F1dbTables = {};
  for (const p of pages) {
    const body = p.body as { table: F1dbTableName; rows: F1dbRow[] };
    (out[body.table] ??= []).push(...body.rows);
  }
  return out;
}

// ─── Wikidata: casamento estrito ─────────────────────────────────────────────────────────────────

/** Ocupações de piloto (Formula One driver, racing automobile driver, racing driver). */
export const RACER_OCCUPATIONS = ['Q10841764', 'Q10349745', 'Q378622'] as const;
/** Morte acidental (P1196): o "acidente" que marca a morte em corrida. */
export const ACCIDENT_MANNERS = ['Q21142718', 'Q171558'] as const;
/** Corridas fora da F1 com vitória registrada (P1346 nas edições). */
export const OTHER_RACES = { Q8032: 'indy500', Q187579: 'le_mans_24h' } as const;

export interface WikidataCandidate {
  qid: string;
  birthDate: string;
  label: string | null;
  /** P3684 e P8140 (ids no estilo do F1DB, "ayrton-senna"). */
  driverIds: string[];
  racer: boolean;
}

const qidOf = (uri: string | undefined) => uri?.replace('http://www.wikidata.org/entity/', '') ?? '';
/** Nome comparável: sem acento, minúsculo, sem pontuação. */
export const comparableName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Consulta dos candidatos nascidos nas datas dadas, só pessoas com id de piloto ou ocupação de piloto. */
export function candidatesQuery(dates: string[]): string {
  const values = dates.map((d) => `"${d}T00:00:00Z"^^xsd:dateTime`).join(' ');
  return `SELECT ?d ?dob ?label ?ddb ?mss ?occ WHERE {
  VALUES ?dob { ${values} }
  ?d wdt:P569 ?dob .
  { ?d wdt:P3684 [] } UNION { ?d wdt:P8140 [] } UNION { ?d wdt:P106 ?anyOcc . VALUES ?anyOcc { ${RACER_OCCUPATIONS.map((q) => `wd:${q}`).join(' ')} } }
  ?d wdt:P31 wd:Q5 .
  OPTIONAL { ?d rdfs:label ?label FILTER(LANG(?label) = "en") }
  OPTIONAL { ?d wdt:P3684 ?ddb }
  OPTIONAL { ?d wdt:P8140 ?mss }
  OPTIONAL { ?d wdt:P106 ?occ . VALUES ?occ { ${RACER_OCCUPATIONS.map((q) => `wd:${q}`).join(' ')} } }
}`;
}

/** Linhas da consulta → um candidato por QID. Puro. */
export function parseCandidates(rows: SparqlBinding[]): WikidataCandidate[] {
  const byQid = new Map<string, WikidataCandidate>();
  for (const r of rows) {
    const qid = qidOf(r.d?.value);
    if (!qid) continue;
    const c = byQid.get(qid) ?? {
      qid,
      birthDate: (r.dob?.value ?? '').slice(0, 10),
      label: r.label?.value ?? null,
      driverIds: [],
      racer: false,
    };
    for (const id of [r.ddb?.value, r.mss?.value]) if (id && !c.driverIds.includes(id)) c.driverIds.push(id);
    if (r.occ) c.racer = true;
    byQid.set(qid, c);
  }
  return [...byQid.values()];
}

/**
 * O QID do piloto, ou null quando não há um candidato só: mesma data de nascimento e o id de piloto igual ao do
 * F1DB ou, sem ele, o nome (o curto ou o completo do F1DB) igual ao rótulo em inglês, com a ocupação de piloto.
 */
export function matchDriver(
  bio: Pick<DriverBio, 'f1dbId' | 'name' | 'fullName' | 'birthDate'>,
  candidates: WikidataCandidate[],
): { qid: string; matchedBy: 'driver_id' | 'name' } | null {
  if (!bio.birthDate) return null;
  const born = candidates.filter((c) => c.birthDate === bio.birthDate);
  const byId = born.filter((c) => c.driverIds.includes(bio.f1dbId));
  if (byId.length === 1) return { qid: byId[0]!.qid, matchedBy: 'driver_id' };
  if (byId.length > 1) return null;
  const names = new Set([bio.name, bio.fullName].filter((n): n is string => !!n).map(comparableName));
  const byName = born.filter((c) => c.racer && c.label && names.has(comparableName(c.label)));
  return byName.length === 1 ? { qid: byName[0]!.qid, matchedBy: 'name' } : null;
}

// ─── Wikidata: fatos do QID ──────────────────────────────────────────────────────────────────────

export interface WikidataFacts {
  deathDate: string | null;
  deathPlaces: { qid: string; labels: WikidataLabels; country: string | null }[];
  causes: { qid: string; labels: WikidataLabels }[];
  manners: { qid: string; labels: WikidataLabels }[];
  nicknames: { text: string; lang: string }[];
  wins: { race: 'indy500' | 'le_mans_24h'; year: number; qid: string }[];
}

const qidValues = (qids: string[]) => qids.map((q) => `wd:${q}`).join(' ');
const LABELS = `OPTIONAL { ?v rdfs:label ?pt FILTER(LANG(?pt) = "pt-br") }
  OPTIONAL { ?v rdfs:label ?pt2 FILTER(LANG(?pt2) = "pt") }
  OPTIONAL { ?v rdfs:label ?es FILTER(LANG(?es) = "es") }
  OPTIONAL { ?v rdfs:label ?en FILTER(LANG(?en) = "en") }`;

/** Morte (data, local com o país, causa e circunstância) e apelidos dos QIDs. */
export const factsQuery = (qids: string[]) => `SELECT ?d ?prop ?v ?pt ?pt2 ?es ?en ?iso ?date ?nick WHERE {
  VALUES ?d { ${qidValues(qids)} }
  {
    VALUES ?prop { wdt:P20 wdt:P509 wdt:P1196 }
    ?d ?prop ?v .
    ${LABELS}
    OPTIONAL { ?v wdt:P17/wdt:P297 ?iso }
  } UNION {
    BIND(wdt:P570 AS ?prop) ?d wdt:P570 ?date .
  } UNION {
    BIND(wdt:P1449 AS ?prop) ?d wdt:P1449 ?nick .
  }
}`;

/** Vitórias nas 500 Milhas de Indianápolis e nas 24 Horas de Le Mans (P1346 nas edições). */
export const winsQuery = (qids: string[]) => `SELECT ?d ?e ?series ?date ?label WHERE {
  VALUES ?d { ${qidValues(qids)} }
  VALUES ?series { ${Object.keys(OTHER_RACES)
    .map((q) => `wd:${q}`)
    .join(' ')} }
  ?e wdt:P1346 ?d .
  { ?e wdt:P31 ?series } UNION { ?e wdt:P3450 ?series } UNION { ?e wdt:P179 ?series }
  OPTIONAL { ?e wdt:P585 ?date }
  OPTIONAL { ?e rdfs:label ?label FILTER(LANG(?label) = "en") }
}`;

const emptyFacts = (): WikidataFacts => ({
  deathDate: null,
  deathPlaces: [],
  causes: [],
  manners: [],
  nicknames: [],
  wins: [],
});

/** Linhas das duas consultas → fatos por QID. Puro. */
export function parseFacts(facts: SparqlBinding[], wins: SparqlBinding[]): Map<string, WikidataFacts> {
  const out = new Map<string, WikidataFacts>();
  const of = (qid: string) => {
    let f = out.get(qid);
    if (!f) out.set(qid, (f = emptyFacts()));
    return f;
  };
  for (const r of facts) {
    const f = of(qidOf(r.d?.value));
    const prop = (r.prop?.value ?? '').split('/').pop();
    if (prop === 'P570' && r.date?.value) {
      f.deathDate = r.date.value.slice(0, 10);
      continue;
    }
    if (prop === 'P1449' && r.nick?.value) {
      const nick = { text: r.nick.value, lang: r.nick['xml:lang'] ?? '' };
      if (!f.nicknames.some((n) => n.text === nick.text)) f.nicknames.push(nick);
      continue;
    }
    const qid = qidOf(r.v?.value);
    if (!/^Q\d+$/.test(qid)) continue;
    const labels: WikidataLabels = {};
    const pt = r.pt?.value ?? r.pt2?.value;
    if (pt) labels.pt = pt;
    if (r.es?.value) labels.es = r.es.value;
    if (r.en?.value) labels.en = r.en.value;
    const list =
      prop === 'P20' ? f.deathPlaces : prop === 'P509' ? f.causes : prop === 'P1196' ? f.manners : null;
    if (!list || list.some((x) => x.qid === qid)) continue;
    if (prop === 'P20') f.deathPlaces.push({ qid, labels, country: r.iso?.value?.toUpperCase() ?? null });
    else list.push({ qid, labels });
  }
  for (const r of wins) {
    const f = of(qidOf(r.d?.value));
    const race = OTHER_RACES[qidOf(r.series?.value) as keyof typeof OTHER_RACES];
    const qid = qidOf(r.e?.value);
    // o ano: a data da edição ou o ano no rótulo ("1966 Indianapolis 500")
    const year = Number(r.date?.value?.slice(0, 4) ?? /\b(19|20)\d{2}\b/.exec(r.label?.value ?? '')?.[0]);
    if (!race || !qid || !Number.isFinite(year) || f.wins.some((w) => w.qid === qid)) continue;
    f.wins.push({ race, year, qid });
  }
  for (const f of out.values()) f.wins.sort((a, b) => a.year - b.year);
  return out;
}

/** O bloco `wikidata` dos fatos do piloto (a morte só quando a data bate com a do F1DB). */
export function wikidataBlock(
  bio: Pick<DriverBio, 'deathDate'>,
  match: { qid: string; matchedBy: 'driver_id' | 'name' },
  facts: WikidataFacts | undefined,
  checkedAt: string,
): NonNullable<ParticipantBioFacts['wikidata']> {
  const f = facts ?? emptyFacts();
  // morte: só de quem o F1DB dá como morto, e na mesma data (data divergente = dúvida)
  const death = !!bio.deathDate && f.deathDate === bio.deathDate;
  return {
    qid: match.qid,
    matched_by: match.matchedBy,
    // mais de um local (o circuito e o hospital, por exemplo) também é dúvida
    death_place: death && f.deathPlaces.length === 1 ? f.deathPlaces[0]! : null,
    death_cause: death ? f.causes : [],
    death_manner: death ? f.manners : [],
    nicknames: f.nicknames,
    wins: f.wins,
    checked_at: checkedAt,
  };
}

/** Casa todos os pilotos e busca os fatos: lotes de datas e de QIDs (consultas cacheadas no banco). */
export async function wikidataForDrivers(
  sparql: SparqlClient,
  bios: DriverBio[],
  batch = 60,
): Promise<{
  matches: Map<string, { qid: string; matchedBy: 'driver_id' | 'name' }>;
  facts: Map<string, WikidataFacts>;
}> {
  const dates = [...new Set(bios.map((b) => b.birthDate).filter((d): d is string => !!d))].sort();
  const candidates: WikidataCandidate[] = [];
  for (let i = 0; i < dates.length; i += batch) {
    const slice = dates.slice(i, i + batch);
    const { data } = await sparql.query('f1-bio:candidatos', candidatesQuery(slice), { from: slice[0]! });
    candidates.push(...parseCandidates(data.results.bindings));
  }
  const matches = new Map<string, { qid: string; matchedBy: 'driver_id' | 'name' }>();
  for (const b of bios) {
    const m = matchDriver(b, candidates);
    if (m) matches.set(b.f1dbId, m);
  }
  // um QID para dois pilotos também é dúvida: nenhum dos dois fica com ele
  const owners = new Map<string, string[]>();
  for (const [id, m] of matches) owners.set(m.qid, [...(owners.get(m.qid) ?? []), id]);
  for (const ids of owners.values()) if (ids.length > 1) for (const id of ids) matches.delete(id);

  const qids = [...new Set([...matches.values()].map((m) => m.qid))].sort();
  const factRows: SparqlBinding[] = [];
  const winRows: SparqlBinding[] = [];
  for (let i = 0; i < qids.length; i += batch) {
    const slice = qids.slice(i, i + batch);
    factRows.push(
      ...(await sparql.query('f1-bio:fatos', factsQuery(slice), { from: slice[0]! })).data.results.bindings,
    );
    winRows.push(
      ...(await sparql.query('f1-bio:vitorias', winsQuery(slice), { from: slice[0]! })).data.results.bindings,
    );
  }
  return { matches, facts: parseFacts(factRows, winRows) };
}

// ─── gravação ────────────────────────────────────────────────────────────────────────────────────

export interface BiographyRow {
  f1dbId: string;
  fullName: string | null;
  deathDate: string | null;
  facts: ParticipantBioFacts;
}

/**
 * Grava nome completo, morte e os fatos no participante do piloto (pelo `provider_map` do F1DB) e liga o QID
 * (`provider_map` wikidata). Idempotente: só atualiza o que mudou. Devolve quantos mudaram e os QIDs que já
 * pertencem a outro participante (não são religados).
 */
export async function saveBiographies(
  db: Database,
  rows: BiographyRow[],
): Promise<{ updated: number; linked: number; conflicts: string[] }> {
  let updated = 0;
  let linked = 0;
  const conflicts: string[] = [];
  for (const r of rows) {
    const [p] = await db.execute<{ id: string }>(sql`
      select entity_id::text as id from core.provider_map
       where provider = 'f1db' and sport = 'formula-1' and entity_type = 'participant'
         and provider_id = ${`driver-${r.f1dbId}`} limit 1`);
    if (!p) continue;
    const changed = await db.execute<{ id: string }>(sql`
      update core.participant
         set full_name = ${r.fullName}, death_date = ${r.deathDate}, bio_facts = ${JSON.stringify(r.facts)}::jsonb,
             updated_at = now()
       where id = ${p.id}::uuid
         and (full_name is distinct from ${r.fullName} or death_date is distinct from ${r.deathDate}::date
              or (bio_facts - 'wikidata') is distinct from (${JSON.stringify(r.facts)}::jsonb - 'wikidata')
              or (bio_facts->'wikidata') - 'checked_at' is distinct from
                 (${JSON.stringify(r.facts)}::jsonb->'wikidata') - 'checked_at')
      returning id::text`);
    updated += changed.length;
    const qid = r.facts.wikidata?.qid;
    if (!qid) continue;
    const [owner] = await db.execute<{ id: string }>(sql`
      select entity_id::text as id from core.provider_map
       where provider = 'wikidata' and sport = 'formula-1' and entity_type = 'participant' and provider_id = ${qid}`);
    if (owner && owner.id !== p.id) conflicts.push(`${r.f1dbId}: ${qid} já é de ${owner.id}`);
    else if (!owner) {
      await db.execute(sql`
        insert into core.provider_map (entity_type, entity_id, provider, sport, provider_id)
        values ('participant', ${p.id}::uuid, 'wikidata', 'formula-1', ${qid}) on conflict do nothing`);
      linked += 1;
    }
  }
  return { updated, linked, conflicts };
}
