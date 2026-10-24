/**
 * Candidatas da Commons para cada alvo do acervo de fotos da F1 (rede; a decisão fica em `select.ts`).
 *
 * - Piloto: o item do Wikidata pelo nome, **conferido** pela data de nascimento do F1DB e pela ocupação de
 *   piloto (ou o esporte automobilismo). Dele saem a foto principal (P18) e a categoria da Commons (P373); as
 *   candidatas são a categoria, a de retratos ("Portrait photographs of …") e as de cada temporada
 *   ("<piloto> in <ano>"), que dão o ano da foto.
 * - Carro: a categoria do chassi ("McLaren MP4/4") e as subcategorias dela (por piloto), sem motores,
 *   miniaturas, arte e afins.
 */
import { WikimediaError, type CommonsFile, type WikimediaClient } from './client.js';
import type { CarTarget, CommonsTarget, DriverTarget } from './scope.js';

/** Ocupações aceitas: piloto de automobilismo, piloto de F1; ou esporte (P641) automobilismo/F1. */
const RACING_OCCUPATIONS = new Set(['Q10841764', 'Q378622']);
const RACING_SPORTS = new Set(['Q5386', 'Q1968']);
/** Subcategorias que não são fotos do piloto ou do carro em si. */
const SKIP_SUBCATEGORY =
  /\b(engine|engines|model|models|toy|toys|scale|lego|in art|art\b|painting|drawing|monument|memorial|statue|grave|signature|logo|film|video game|museum shop|stamp|coin|helmet replica)\b/i;
const MAX_FILES_PER_TARGET = 120;

/** Texto comparável: sem acento, minúsculo ("Räikkönen" → "raikkonen"). */
const plain = (v: string) =>
  v
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export interface Candidate {
  file: CommonsFile;
  /** Ano da temporada quando a categoria diz ("Ayrton Senna in 1988", carro de 1988). */
  season: number | null;
  /** Foto principal do Wikidata (P18). */
  wikidataImage: boolean;
  /** Veio da categoria de retratos. */
  portraitCategory: boolean;
  /** Carro de destaque: a foto cita o piloto (título ou categoria), então é o carro com ele. */
  featured?: boolean;
  /** Carro de destaque: a foto cita outro piloto da temporada (e não o do destaque). */
  other?: boolean;
}

export interface Discovery {
  target: CommonsTarget;
  wikidata: string | null;
  category: string | null;
  candidates: Candidate[];
  /** Por que não há candidatas (sem item no Wikidata, sem categoria...). */
  note: string | null;
}

interface Snak {
  mainsnak?: { datavalue?: { value?: unknown } };
}
const values = (claims: unknown[] | undefined) =>
  (claims ?? []).map((c) => (c as Snak).mainsnak?.datavalue?.value).filter((v) => v != null);
const itemIds = (claims: unknown[] | undefined) =>
  values(claims)
    .map((v) => (v as { id?: string }).id)
    .filter((v): v is string => !!v);

/** Item do Wikidata do piloto, só se a data de nascimento bater com a do F1DB e for piloto. */
export async function findDriverItem(
  client: WikimediaClient,
  target: DriverTarget,
): Promise<{ id: string; image: string[]; category: string | null } | null> {
  if (!target.dateOfBirth) return null;
  const ids = await client.searchItems(target.name);
  if (!ids.length) return null;
  const claims = await client.claims(ids, ['P18', 'P373', 'P569', 'P106', 'P641']);
  for (const id of ids) {
    const c = claims.get(id);
    if (!c) continue;
    const births = values(c.P569).map((v) => String((v as { time?: string }).time ?? '').slice(1, 11));
    const racing =
      itemIds(c.P106).some((q) => RACING_OCCUPATIONS.has(q)) ||
      itemIds(c.P641).some((q) => RACING_SPORTS.has(q));
    if (!births.includes(target.dateOfBirth) || !racing) continue;
    const category = values(c.P373).map(String)[0] ?? null;
    return { id, image: values(c.P18).map((v) => `File:${String(v)}`), category };
  }
  return null;
}

/** Categorias-mãe que marcam um piloto de F1 na Commons ("Formula One drivers from Brazil", "Racing drivers"). */
const DRIVER_PARENT = /\b(formula one|formula 1|f1) drivers\b|\bracing drivers\b|\bracecar drivers\b/i;

/**
 * Sem a API do Wikidata (atrasada ou fora): a categoria da Commons com o nome exato do piloto (ou "<nome>
 * (racing driver)"), conferida pelas categorias-mãe de piloto e pelo ano de nascimento ("1960 births"). A foto
 * principal (P18) vem pelo `Special:EntityData` (cache, sem `maxlag`): item da categoria → tema principal (P301) →
 * a pessoa, cuja data de nascimento tem de bater com a do F1DB; senão, sem P18.
 */
export async function findDriverCategory(
  client: WikimediaClient,
  target: DriverTarget,
): Promise<{ id: string | null; image: string[]; category: string } | null> {
  for (const name of [target.name, `${target.name} (racing driver)`]) {
    const body = await client.get('https://commons.wikimedia.org/w/api.php', {
      action: 'query',
      titles: `Category:${name}`,
      prop: 'categories|pageprops',
      ppprop: 'wikibase_item',
      cllimit: 'max',
    });
    const page = ((
      body.query as {
        pages?: {
          missing?: boolean;
          categories?: { title: string }[];
          pageprops?: { wikibase_item?: string };
        }[];
      }
    )?.pages ?? [])[0];
    if (!page || page.missing) continue;
    const parents = (page.categories ?? []).map((c) => c.title);
    if (!parents.some((t) => DRIVER_PARENT.test(t))) continue;
    // "1960 births" tem de bater com o ano de nascimento do F1DB (homônimos ficam de fora)
    const born = parents.map((t) => /Category:(\d{4}) births$/.exec(t)?.[1]).find(Boolean);
    if (!born || born !== target.dateOfBirth?.slice(0, 4)) continue;
    const person = await personOfCategory(client, page.pageprops?.wikibase_item, target);
    return { id: person?.id ?? null, image: person?.image ?? [], category: name };
  }
  return null;
}

/** A pessoa do item da categoria (P301), conferida pela data de nascimento completa do F1DB. */
async function personOfCategory(
  client: WikimediaClient,
  categoryItem: string | undefined,
  target: DriverTarget,
): Promise<{ id: string; image: string[] } | null> {
  if (!categoryItem || !target.dateOfBirth) return null;
  try {
    const cat = await client.entityClaims(categoryItem, ['P301']);
    const id = itemIds(cat?.P301)[0];
    if (!id) return null;
    const c = await client.entityClaims(id, ['P18', 'P569']);
    const births = values(c?.P569).map((v) => String((v as { time?: string }).time ?? '').slice(1, 11));
    if (!births.includes(target.dateOfBirth)) return null;
    return { id, image: values(c?.P18).map((v) => `File:${String(v)}`) };
  } catch (err) {
    // sem o EntityData, fica a categoria (já conferida) sem a foto principal
    if (err instanceof WikimediaError) return null;
    throw err;
  }
}

async function filesWithSubcategories(
  client: WikimediaClient,
  category: string,
  keepSub: (name: string) => boolean,
): Promise<{ title: string; from: string }[]> {
  const out: { title: string; from: string }[] = [];
  const members = await client.get('https://commons.wikimedia.org/w/api.php', {
    action: 'query',
    list: 'categorymembers',
    cmtitle: `Category:${category}`,
    cmtype: 'file|subcat',
    cmlimit: 200,
  });
  const list = ((members.query as { categorymembers?: { ns: number; title: string }[] } | undefined)
    ?.categorymembers ?? []) as { ns: number; title: string }[];
  for (const m of list) if (m.ns === 6) out.push({ title: m.title, from: category });
  for (const m of list) {
    if (m.ns !== 14) continue;
    const sub = m.title.replace(/^Category:/, '');
    if (SKIP_SUBCATEGORY.test(sub) || !keepSub(sub)) continue;
    for (const title of await client.categoryFiles(sub, 100)) out.push({ title, from: sub });
  }
  return out;
}

export async function discoverDriver(
  client: WikimediaClient,
  target: DriverTarget,
  thumbWidth: number,
): Promise<Discovery> {
  let item: { id: string | null; image: string[]; category: string | null } | null;
  let note: string | null = null;
  try {
    item = await findDriverItem(client, target);
  } catch (err) {
    // Wikidata atrasado (maxlag) ou fora: a identificação pela categoria da Commons é conferível do mesmo jeito
    if (!(err instanceof WikimediaError)) throw err;
    item = await findDriverCategory(client, target);
    note = item ? 'identificado pela categoria da Commons (Wikidata atrasado)' : null;
  }
  if (!item)
    return { target, wikidata: null, category: null, candidates: [], note: 'sem item conferido no Wikidata' };
  const sources: { title: string; from: string }[] = item.image.map((title) => ({
    title,
    from: 'wikidata:P18',
  }));
  if (item.category) {
    const first = target.seasons[0] ?? 0;
    const last = target.seasons.at(-1) ?? 9999;
    // na categoria do piloto: retratos e "<piloto> in <ano>" da carreira na F1 (±1 ano)
    sources.push(
      ...(await filesWithSubcategories(client, item.category, (sub) => {
        if (/portrait/i.test(sub)) return true;
        const year = /\bin (\d{4})$/.exec(sub)?.[1];
        return year ? Number(year) >= first - 1 && Number(year) <= last + 1 : false;
      })),
    );
    // as temporadas ficam também em "<piloto> by year" → "<piloto> in <ano>"
    for (const year of target.seasons) {
      const sub = `${item.category} in ${year}`;
      if (sources.some((s) => s.from === sub)) continue;
      if (await client.categoryExists(sub))
        for (const title of await client.categoryFiles(sub, 100)) sources.push({ title, from: sub });
    }
  }
  const byTitle = new Map<string, { from: string[] }>();
  for (const s of sources) byTitle.set(s.title, { from: [...(byTitle.get(s.title)?.from ?? []), s.from] });
  const titles = [...byTitle.keys()].slice(0, MAX_FILES_PER_TARGET);
  const files = await client.imageInfo(titles, thumbWidth);
  const candidates = files.map((file) => {
    const from = byTitle.get(file.title)?.from ?? [];
    const year = from.map((f) => /\bin (\d{4})$/.exec(f)?.[1]).find(Boolean);
    return {
      file,
      season: year ? Number(year) : null,
      wikidataImage: from.includes('wikidata:P18'),
      portraitCategory: from.some((f) => /portrait/i.test(f)),
    };
  });
  return {
    target,
    wikidata: item.id,
    category: item.category,
    candidates,
    note: item.category ? note : 'sem categoria na Commons',
  };
}

/**
 * Categorias da Commons do chassi quando o nome do F1DB não é exatamente o da Commons: busca no espaço de
 * categorias e aceita só as que trazem o construtor e o mesmo chassi, com fronteira (312T casa com "Ferrari 312 T",
 * não com "Ferrari 312 T3"). As mais curtas primeiro (a do carro antes das "… of <piloto>"), no máximo 4.
 */
export async function chassisCategories(
  client: WikimediaClient,
  constructorName: string,
  chassisFullName: string,
): Promise<string[]> {
  const spaced = (v: string) =>
    plain(v)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const maker = spaced(constructorName).split(' ')[0];
  const model = spaced(chassisFullName.replace(constructorName, '')).replace(/ /g, '');
  if (!maker || !model) return [];
  const pattern = new RegExp(`(?<![a-z0-9])${[...model].join('\\s?')}(?![a-z0-9])`);
  // o nome do F1DB e o mesmo sem espaços no modelo ("Vanwall VW 5" → "Vanwall VW5")
  const queries = [
    ...new Set([
      chassisFullName,
      `${constructorName} ${chassisFullName.replace(constructorName, '').replace(/\s+/g, '')}`,
    ]),
  ];
  const titles: string[] = [];
  for (const q of queries) {
    const body = await client.get('https://commons.wikimedia.org/w/api.php', {
      action: 'query',
      list: 'search',
      srnamespace: 14,
      srsearch: q,
      srlimit: 20,
    });
    for (const r of (body.query as { search?: { title: string }[] } | undefined)?.search ?? []) {
      const t = r.title.replace(/^Category:/, '');
      if (!titles.includes(t)) titles.push(t);
    }
  }
  return titles
    .filter((t) => {
      const n = spaced(t);
      return n.split(' ').includes(maker) && pattern.test(n) && !SKIP_SUBCATEGORY.test(t);
    })
    .sort((a, b) => a.length - b.length)
    .slice(0, 4);
}

export async function discoverCar(
  client: WikimediaClient,
  target: CarTarget,
  thumbWidth: number,
): Promise<Discovery> {
  const sources: { title: string; from: string }[] = [];
  let category: string | null = null;
  for (const chassis of target.chassis) {
    // o nome do F1DB nem sempre é o da Commons ("Mercedes F1 W11" → "Mercedes-AMG F1 W11 EQ Performance"):
    // sem a categoria exata, as que trazem o construtor e o mesmo chassi
    const exact = (await client.categoryExists(chassis))
      ? await filesWithSubcategories(client, chassis, () => true)
      : [];
    if (exact.length) {
      category ??= chassis;
      sources.push(...exact);
      continue;
    }
    // categoria exata vazia (redirecionamento da Commons) ou inexistente: as do mesmo chassi com outro nome
    for (const cat of await chassisCategories(client, target.constructorName, chassis)) {
      category ??= cat;
      sources.push(...(await filesWithSubcategories(client, cat, () => true)));
    }
  }
  if (!sources.length)
    return {
      target,
      wikidata: null,
      category: null,
      candidates: [],
      note: 'sem categoria do chassi na Commons',
    };
  // carro de destaque: as fotos que citam o piloto vêm primeiro (e não ficam de fora do limite)
  const surname = target.driver ? plain(target.driver.lastName) : null;
  const cites = (text: string) => !!surname && plain(text).includes(surname);
  const featured = new Set(sources.filter((s) => cites(s.title) || cites(s.from)).map((s) => s.title));
  const others = (target.others ?? []).map((o) => plain(o).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const citesOther = (text: string) => others.some((o) => new RegExp(`\\b${o}\\b`).test(plain(text)));
  const other = new Set(
    sources
      .filter((s) => !featured.has(s.title) && (citesOther(s.title) || citesOther(s.from)))
      .map((s) => s.title),
  );
  const titles = [
    ...new Set([...sources.filter((s) => featured.has(s.title)), ...sources].map((s) => s.title)),
  ].slice(0, MAX_FILES_PER_TARGET);
  const files = await client.imageInfo(titles, thumbWidth);
  return {
    target,
    wikidata: null,
    category,
    candidates: files.map((file) => ({
      file,
      season: target.year,
      wikidataImage: false,
      portraitCategory: false,
      ...(featured.has(file.title) ? { featured: true } : {}),
      ...(other.has(file.title) ? { other: true } : {}),
    })),
    note: null,
  };
}

export function discover(
  client: WikimediaClient,
  target: CommonsTarget,
  thumbWidth: number,
): Promise<Discovery> {
  return target.kind === 'driver'
    ? discoverDriver(client, target, thumbWidth)
    : discoverCar(client, target, thumbWidth);
}
