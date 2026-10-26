import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { asset, assetCredit, type Database } from '@galaxie/db';
import type { SparqlBinding, SparqlClient } from '../multisport/wikidata/sparql-client.js';
import type { WikimediaClient } from './commons/client.js';
import { commonsSourceUrl } from './commons/import.js';
import { readLicense } from './commons/license.js';
import { imageInfo } from './image-info.js';
import type { ObjectStore } from './object-store.js';

/**
 * Fotos de pessoas do futebol vindas do Wikidata (P18) e da Wikimedia Commons, para quem a api-sports não tem foto.
 * Casamento: mesma data de nascimento (P569), nome compatível e nacionalidade compatível (P27). A licença segue a
 * regra do acervo da Commons (`readLicense`: domínio público, CC0, CC BY e CC BY-SA). O asset fica com
 * `origin = commons` e o crédito em `core.asset_credit`, como as fotos da F1.
 */

/** Ocupações aceitas: jogador de futebol (Q937857) e técnico de futebol (Q628099). */
const OCCUPATIONS = ['wd:Q937857', 'wd:Q628099'];

export interface PhotoCandidate {
  personId: string;
  /** Id no core (`123` jogador, `coach:123` técnico). */
  providerId: string;
  name: string;
  fullName: string | null;
  birthDate: string;
  nationality: string | null;
}

export interface WikidataPerson {
  qid: string;
  birthDate: string;
  labels: string[];
  countries: string[];
  /** Nome do arquivo no Commons (sem o prefixo `File:`). */
  image: string;
}

export interface PhotoMatch {
  candidate: PhotoCandidate;
  person: WikidataPerson;
}

// ─── funções puras ───────────────────────────────────────────────────────────────────────────────

/** Consulta SPARQL: pessoas do futebol com foto nascidas nestas datas, com rótulos e países. */
export function birthDateQuery(dates: string[]): string {
  const values = dates.map((d) => `"${d}T00:00:00Z"^^xsd:dateTime`).join(' ');
  return `SELECT ?item ?birth ?image ?label ?country WHERE {
  VALUES ?birth { ${values} }
  VALUES ?occupation { ${OCCUPATIONS.join(' ')} }
  ?item wdt:P569 ?birth; wdt:P106 ?occupation; wdt:P18 ?image.
  ?item rdfs:label ?label FILTER(LANG(?label) IN ("en", "es", "pt", "fr", "it", "de"))
  OPTIONAL { ?item wdt:P27 ?c. ?c rdfs:label ?country FILTER(LANG(?country) = "en") }
}`;
}

/** Agrupa as linhas SPARQL por pessoa do Wikidata. */
export function wikidataPeople(rows: SparqlBinding[]): WikidataPerson[] {
  const byQid = new Map<string, WikidataPerson>();
  for (const r of rows) {
    const qid = r.item?.value.split('/').pop();
    const image = r.image?.value.split('/').pop();
    if (!qid || !image || !r.birth) continue;
    const p = byQid.get(qid) ?? {
      qid,
      birthDate: r.birth.value.slice(0, 10),
      labels: [],
      countries: [],
      image: decodeURIComponent(image).replace(/_/g, ' '),
    };
    if (r.label && !p.labels.includes(r.label.value)) p.labels.push(r.label.value);
    if (r.country && !p.countries.includes(r.country.value)) p.countries.push(r.country.value);
    byQid.set(qid, p);
  }
  return [...byQid.values()];
}

export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nome do core compatível com um rótulo do Wikidata. Vale o nome inteiro igual, ou o sobrenome (último token do
 * nome curto, "J. Valencia") no rótulo com o primeiro nome (ou a inicial) batendo com o primeiro token do rótulo.
 */
export function namesMatch(c: Pick<PhotoCandidate, 'name' | 'fullName'>, label: string): boolean {
  const l = normalizeName(label);
  if (!l) return false;
  const full = c.fullName ? normalizeName(c.fullName) : '';
  const short = normalizeName(c.name);
  if (l === short || (full && l === full)) return true;
  const lt = l.split(' ');
  const st = short.split(' ').filter(Boolean);
  const ft = full.split(' ').filter(Boolean);
  const surname = st.length > 1 ? st[st.length - 1]! : null;
  if (!surname || !lt.slice(1).includes(surname)) {
    // nome completo do fornecedor ("Jhon Alexander Valencia Hinestroza"): primeiro nome e um sobrenome no rótulo
    return ft.length >= 2 && lt.length >= 2 && lt[0] === ft[0] && ft.slice(1).includes(lt[lt.length - 1]!);
  }
  const first = st[0]!;
  // inicial ("J. Valencia" vira "j valencia") ou primeiro nome por extenso
  return first.length === 1
    ? lt[0]!.startsWith(first)
    : lt[0] === first || (ft.length > 0 && lt[0] === ft[0]);
}

/** Nomes de país do fornecedor que o Wikidata grava diferente (rótulo em inglês do P27). */
const COUNTRY_ALIASES: Record<string, string[]> = {
  england: ['united kingdom'],
  scotland: ['united kingdom'],
  wales: ['united kingdom'],
  'northern ireland': ['united kingdom'],
  usa: ['united states', 'united states of america'],
  'korea republic': ['south korea'],
  'korea dpr': ['north korea'],
  'czech republic': ['czechia'],
  turkey: ['turkiye'],
  'congo dr': ['democratic republic of the congo'],
  congo: ['republic of the congo'],
  'ivory coast': ['cote d ivoire'],
  'cote d ivoire': ['ivory coast'],
  'cape verde islands': ['cape verde', 'cabo verde'],
  'republic of ireland': ['ireland'],
  'chinese taipei': ['taiwan'],
  macedonia: ['north macedonia'],
  bosnia: ['bosnia and herzegovina'],
};

export function countriesMatch(nationality: string | null, countries: string[]): boolean {
  if (!nationality || !countries.length) return true;
  const n = normalizeName(nationality);
  const wanted = new Set([n, ...(COUNTRY_ALIASES[n] ?? [])]);
  return countries.some((c) => wanted.has(normalizeName(c)));
}

/**
 * Casa candidatos com pessoas do Wikidata: mesma data de nascimento, nome e nacionalidade compatíveis.
 * Candidato com duas pessoas possíveis fica de fora (ambíguo), e cada pessoa do Wikidata vai para um só candidato.
 */
export function matchCandidates(candidates: PhotoCandidate[], people: WikidataPerson[]): PhotoMatch[] {
  const byDate = new Map<string, WikidataPerson[]>();
  for (const p of people) byDate.set(p.birthDate, [...(byDate.get(p.birthDate) ?? []), p]);
  const out: PhotoMatch[] = [];
  const taken = new Map<string, number>();
  for (const c of candidates) {
    const hits = (byDate.get(c.birthDate) ?? []).filter(
      (p) => p.labels.some((l) => namesMatch(c, l)) && countriesMatch(c.nationality, p.countries),
    );
    if (hits.length !== 1) continue;
    taken.set(hits[0]!.qid, (taken.get(hits[0]!.qid) ?? 0) + 1);
    out.push({ candidate: c, person: hits[0]! });
  }
  return out.filter((m) => taken.get(m.person.qid) === 1);
}

// ─── banco, Wikidata e Commons ───────────────────────────────────────────────────────────────────

/**
 * Pessoas sem foto com data de nascimento, escaladas desde `since` em competições de tier ≤ `maxTier`
 * (prioridades 1 e 2 da lista de "sem foto"), da mais escalada para a menos.
 */
export async function photoCandidates(
  db: Database,
  options: { since: Date; maxTier: number; limit?: number | undefined },
): Promise<PhotoCandidate[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local max_parallel_workers_per_gather = 0`);
    const rows = await tx.execute<{
      person_id: string;
      provider_id: string;
      name: string;
      full_name: string | null;
      birth_date: string;
      nationality: string | null;
    }>(sql`
      with lu as (
        select p->'player'->>'id' as pid, count(*) as games
        from core.football_fixture f
        join core.event e on e.id = f.event_id
        join core.competition c on c.id = e.competition_id,
          lateral jsonb_array_elements(case when jsonb_typeof(f.detail->'lineups') = 'array' then f.detail->'lineups' else '[]'::jsonb end) l,
          lateral jsonb_array_elements(coalesce(l->'startXI', '[]'::jsonb) || coalesce(l->'substitutes', '[]'::jsonb)) p
        where f.detail is not null and e.starts_at >= ${options.since.toISOString()}::timestamptz and c.tier <= ${options.maxTier}
          and p->'player'->>'id' is not null
        group by 1
        union all
        select 'coach:' || (l->'coach'->>'id'), count(*)
        from core.football_fixture f
        join core.event e on e.id = f.event_id
        join core.competition c on c.id = e.competition_id,
          lateral jsonb_array_elements(case when jsonb_typeof(f.detail->'lineups') = 'array' then f.detail->'lineups' else '[]'::jsonb end) l
        where f.detail is not null and e.starts_at >= ${options.since.toISOString()}::timestamptz and c.tier <= ${options.maxTier}
          and l->'coach'->>'id' is not null and l->'coach'->>'id' <> '0'
        group by 1
      )
      select p.id as person_id, m.provider_id, p.name,
             nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as full_name,
             p.birth_date::text as birth_date, p.nationality
      from lu
      join core.provider_map m on m.provider = 'api-sports' and m.sport = 'football' and m.entity_type = 'person'
        and m.provider_id = lu.pid
      join core.person p on p.id = m.entity_id
      where p.photo_asset_id is null and p.birth_date is not null
      order by lu.games desc, p.id
      ${options.limit ? sql`limit ${options.limit}` : sql``}
    `);
    return [...rows].map((r) => ({
      personId: r.person_id,
      providerId: r.provider_id,
      name: r.name,
      fullName: r.full_name,
      birthDate: r.birth_date,
      nationality: r.nationality,
    }));
  });
}

/** Pessoas do Wikidata com foto nascidas nas datas dos candidatos, em lotes de `datesPerQuery` datas. */
export async function findWikidataPeople(
  client: SparqlClient,
  candidates: PhotoCandidate[],
  options: { datesPerQuery?: number; onBatch?: (done: number, total: number) => void } = {},
): Promise<WikidataPerson[]> {
  const dates = [...new Set(candidates.map((c) => c.birthDate))].sort();
  const size = options.datesPerQuery ?? 40;
  const people: WikidataPerson[] = [];
  for (let i = 0; i < dates.length; i += size) {
    const batch = dates.slice(i, i + size);
    const { data } = await client.query('football-people-by-birth', birthDateQuery(batch), {
      first: batch[0]!,
      last: batch[batch.length - 1]!,
    });
    people.push(...wikidataPeople(data.results.bindings));
    options.onBatch?.(Math.min(i + size, dates.length), dates.length);
  }
  return people;
}

/** Largura da miniatura baixada da Commons: o bastante para o rosto num card ou perfil. */
export const PEOPLE_THUMB_WIDTH = 800;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

/** Chave no bucket: `commons/people/<pessoa>.<sha256[0:12]>.<ext>` (o prefixo `commons/` é o do acervo). */
export function peoplePhotoKey(personId: string, sha256: string, contentType: string): string | null {
  const ext = EXT[contentType];
  return ext ? `commons/people/${personId}.${sha256.slice(0, 12)}.${ext}` : null;
}

export interface PeoplePhotosReport {
  linked: number;
  /** Casados no Wikidata cuja imagem não passou na regra de licença (ou sumiu da Commons). */
  notFree: number;
  /** Pessoas que ganharam foto por outra via enquanto a busca rodava. */
  skipped: number;
  bytes: number;
}

const fileTitle = (image: string) => `File:${image.replace(/_/g, ' ')}`;

/**
 * Baixa a miniatura de cada foto casada, grava no bucket e em `core.asset` (`origin = commons`, fonte
 * `commons://File:…`), registra o crédito em `core.asset_credit`, liga a pessoa (só se ainda não tiver foto) e
 * guarda o QID em `core.provider_map` (`wikidata`/`football`/`person`).
 */
export async function importPeoplePhotos(
  db: Database,
  store: ObjectStore,
  client: WikimediaClient,
  matches: PhotoMatch[],
  options: { thumbWidth?: number } = {},
): Promise<PeoplePhotosReport> {
  const report: PeoplePhotosReport = { linked: 0, notFree: 0, skipped: 0, bytes: 0 };
  const titles = [...new Set(matches.map((m) => fileTitle(m.person.image)))];
  const infos = titles.length ? await client.imageInfo(titles, options.thumbWidth ?? PEOPLE_THUMB_WIDTH) : [];
  const byTitle = new Map(infos.map((i) => [i.title, i]));
  for (const m of matches) {
    const title = fileTitle(m.person.image);
    const info = byTitle.get(title);
    const license = info ? readLicense(info.extmetadata) : null;
    if (!info || !license?.ok) {
      report.notFree += 1;
      continue;
    }
    const [current] = await db.execute<{ photo: string | null }>(
      sql`select photo_asset_id as photo from core.person where id = ${m.candidate.personId}`,
    );
    if (!current || current.photo) {
      report.skipped += 1;
      continue;
    }
    const sourceUrl = commonsSourceUrl(title);
    const [existing] = await db.execute<{ id: string; storage_key: string | null }>(
      sql`select id, storage_key from core.asset where source_url = ${sourceUrl}`,
    );
    let file: { body: Uint8Array; sha: string; key: string; meta: ReturnType<typeof imageInfo> } | null =
      null;
    if (!existing?.storage_key) {
      const { body, contentType } = await client.download(info.thumbUrl);
      const meta = imageInfo(body, contentType ?? info.mime);
      const sha = createHash('sha256').update(body).digest('hex');
      const key = peoplePhotoKey(m.candidate.personId, sha, meta.contentType);
      if (!key) {
        report.notFree += 1;
        continue;
      }
      await store.put(key, body, meta.contentType, sha);
      file = { body, sha, key, meta };
      report.bytes += body.byteLength;
    }
    await db.transaction(async (tx) => {
      const [locked] = await tx.execute<{ photo: string | null }>(
        sql`select photo_asset_id as photo from core.person where id = ${m.candidate.personId} for update`,
      );
      if (!locked || locked.photo) {
        report.skipped += 1;
        return;
      }
      let assetId = existing?.id ?? null;
      if (file) {
        const values = {
          storageKey: file.key,
          sha256: file.sha,
          width: file.meta.width,
          height: file.meta.height,
          bytes: file.body.byteLength,
          fetchedAt: new Date(),
          origin: 'commons' as const,
        };
        const [row] = await tx
          .insert(asset)
          .values({
            kind: m.candidate.providerId.startsWith('coach:') ? 'coach' : 'player',
            sourceUrl,
            ...values,
          })
          .onConflictDoUpdate({ target: asset.sourceUrl, set: values })
          .returning({ id: asset.id });
        assetId = row!.id;
      }
      const credit = license.value;
      const creditValues = {
        author: credit.author,
        authorUrl: credit.authorUrl,
        license: credit.license,
        licenseUrl: credit.licenseUrl,
        credit: credit.credit,
        attribution: credit.attribution,
        attributionCheckedAt: new Date(),
        attributionRequired: credit.attributionRequired,
        shareAlike: credit.shareAlike,
        dateTaken: credit.dateTaken,
        originalWidth: info.width,
        originalHeight: info.height,
      };
      await tx
        .insert(assetCredit)
        .values({
          assetId: assetId!,
          source: 'wikimedia-commons',
          title,
          pageUrl: info.pageUrl,
          ...creditValues,
        })
        .onConflictDoUpdate({ target: assetCredit.assetId, set: creditValues });
      await tx.execute(
        sql`update core.person set photo_asset_id = ${assetId}, updated_at = now() where id = ${m.candidate.personId}`,
      );
      await tx.execute(sql`
        insert into core.provider_map (entity_type, entity_id, provider, sport, provider_id)
        values ('person', ${m.candidate.personId}, 'wikidata', 'football', ${m.person.qid})
        on conflict do nothing
      `);
      report.linked += 1;
    });
  }
  return report;
}
