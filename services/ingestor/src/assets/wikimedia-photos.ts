import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { asset, type Database } from '@galaxie/db';
import type { SparqlBinding, SparqlClient } from '../multisport/wikidata/sparql-client.js';
import type { PgAssetStore } from './asset-store.js';
import { imageInfo } from './image-info.js';
import type { ObjectStore } from './object-store.js';

/**
 * Fotos de pessoas do futebol vindas do Wikidata (P18) e do Wikimedia Commons, para quem a api-sports não tem foto.
 * Casamento: mesma data de nascimento (P569), nome compatível e nacionalidade compatível (P27). Só entram imagens
 * com licença livre (CC0, CC BY, CC BY-SA, domínio público); licença, autor e página da imagem ficam no asset.
 */

/** User-Agent genérico exigido pelas políticas do Wikidata e do Commons — sem e-mail nem dado pessoal. */
export const WIKIMEDIA_USER_AGENT = 'galaxie-sports/0.1 (https://sports.galaxie.works)';

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

export interface CommonsImage {
  file: string;
  thumbUrl: string;
  descriptionUrl: string;
  license: string;
  licenseUrl: string | null;
  author: string | null;
  mime: string | null;
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

/** Licença livre aceita: CC0, CC BY, CC BY-SA (qualquer versão) ou domínio público. NC e ND ficam de fora. */
export function isFreeLicense(shortName: string): boolean {
  const s = shortName.trim();
  if (/\b(NC|ND)\b/i.test(s)) return false;
  return /^(CC0|CC[ -]BY(-SA)?\b|Public domain|PD\b|PD-)/i.test(s);
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface CommonsApiPage {
  title?: string;
  imageinfo?: {
    thumburl?: string;
    url?: string;
    descriptionurl?: string;
    mime?: string;
    extmetadata?: Record<string, { value?: string } | undefined>;
  }[];
}

/** Lê a resposta de `prop=imageinfo&iiprop=url|mime|extmetadata` do Commons; só imagens com licença livre. */
export function parseCommonsInfo(body: {
  query?: {
    normalized?: { from: string; to: string }[];
    pages?: Record<string, CommonsApiPage> | CommonsApiPage[];
  };
}): CommonsImage[] {
  const pages = body.query?.pages ? Object.values(body.query.pages) : [];
  const out: CommonsImage[] = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    const license = meta.LicenseShortName?.value ? stripHtml(meta.LicenseShortName.value) : '';
    if (!p.title || !info || !license || !isFreeLicense(license)) continue;
    const author = meta.Artist?.value ? stripHtml(meta.Artist.value) : null;
    out.push({
      file: p.title.replace(/^File:/, ''),
      thumbUrl: info.thumburl ?? info.url ?? '',
      descriptionUrl:
        info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
      license,
      licenseUrl: meta.LicenseUrl?.value ?? null,
      author: author || null,
      mime: info.mime ?? null,
    });
  }
  return out.filter((i) => i.thumbUrl);
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

/** Licença, autor e miniatura das imagens no Commons, 50 por requisição. */
export async function fetchCommonsInfo(
  files: string[],
  options: { fetch?: typeof fetch; width?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Map<string, CommonsImage>> {
  const fetchFn = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const out = new Map<string, CommonsImage>();
  const unique = [...new Set(files)];
  for (let i = 0; i < unique.length; i += 50) {
    const titles = unique.slice(i, i + 50).map((f) => `File:${f}`);
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'imageinfo',
      iiprop: 'url|mime|extmetadata',
      iiurlwidth: String(options.width ?? 400),
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist',
      titles: titles.join('|'),
    }).toString();
    const res = await fetchFn(url, { headers: { 'User-Agent': WIKIMEDIA_USER_AGENT } });
    if (!res.ok) throw new Error(`Commons respondeu ${res.status}`);
    for (const img of parseCommonsInfo((await res.json()) as Parameters<typeof parseCommonsInfo>[0])) {
      out.set(img.file, img);
    }
    await sleep(500);
  }
  return out;
}

export interface WikimediaSaveReport {
  linked: number;
  /** Casados no Wikidata cuja imagem não tem licença livre (ou sumiu do Commons). */
  notFree: number;
  /** Pessoas que ganharam foto por outra via enquanto a busca rodava. */
  skipped: number;
}

/** Registra as fotos (origin wikimedia, com licença e autor), liga as pessoas sem foto e guarda o QID. */
export async function saveWikimediaPhotos(
  db: Database,
  matches: PhotoMatch[],
  images: Map<string, CommonsImage>,
): Promise<WikimediaSaveReport> {
  const report: WikimediaSaveReport = { linked: 0, notFree: 0, skipped: 0 };
  for (const m of matches) {
    const img = images.get(m.person.image);
    if (!img) {
      report.notFree += 1;
      continue;
    }
    await db.transaction(async (tx) => {
      const [current] = await tx.execute<{ photo: string | null }>(sql`
        select photo_asset_id as photo from core.person where id = ${m.candidate.personId} for update
      `);
      if (!current || current.photo) {
        report.skipped += 1;
        return;
      }
      await tx
        .insert(asset)
        .values({
          kind: m.candidate.providerId.startsWith('coach:') ? 'coach' : 'player',
          sourceUrl: img.thumbUrl,
          origin: 'wikimedia',
          license: img.license,
          licenseUrl: img.licenseUrl,
          author: img.author,
          attributionUrl: img.descriptionUrl,
        })
        .onConflictDoNothing();
      const linked = await tx.execute<{ id: string }>(sql`
        update core.person p set photo_asset_id = a.id, updated_at = now()
        from core.asset a
        where a.source_url = ${img.thumbUrl} and p.id = ${m.candidate.personId} and p.photo_asset_id is null
        returning p.id
      `);
      if (!linked.length) {
        report.skipped += 1;
        return;
      }
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

/** Baixa as fotos do Commons ainda não espelhadas para o bucket (`wikimedia/people/<sha256>.<ext>`). */
export async function mirrorWikimediaPhotos(
  db: Database,
  assets: PgAssetStore,
  objects: ObjectStore,
  options: { fetch?: typeof fetch; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ stored: number; failed: number; bytes: number }> {
  const fetchFn = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pending = await db.execute<{ id: string; source_url: string }>(sql`
    select id, source_url from core.asset
    where origin = 'wikimedia' and storage_key is null and fetched_at is null
    order by created_at
  `);
  const report = { stored: 0, failed: 0, bytes: 0 };
  for (const a of pending) {
    try {
      const res = await fetchFn(a.source_url, { headers: { 'User-Agent': WIKIMEDIA_USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = new Uint8Array(await res.arrayBuffer());
      const sha256 = createHash('sha256').update(body).digest('hex');
      const info = imageInfo(body, res.headers.get('content-type') ?? undefined);
      const ext = info.contentType?.split('/')[1]?.replace('jpeg', 'jpg') ?? 'img';
      const key = `wikimedia/people/${sha256}.${ext}`;
      await objects.put(key, body, info.contentType, sha256);
      await assets.markStored(a.id, {
        storageKey: key,
        sha256,
        bytes: body.length,
        width: info.width,
        height: info.height,
        fetchedAt: new Date(),
      });
      report.stored += 1;
      report.bytes += body.length;
    } catch {
      report.failed += 1;
    }
    await sleep(options.delayMs ?? 400);
  }
  return report;
}
