import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';
import { suspiciousDrop } from '../multisport/wikidata/drop-guard.js';
import type { SparqlBinding, SparqlClient } from '../multisport/wikidata/sparql-client.js';

/**
 * Campeões por edição das competições (Wikidata P1346 "vencedor" de cada temporada P3450), gravados em
 * `core.competition_title` para o "busca o tetra" (`seeks_title_{n}`). Sem IA e com proveniência: cada
 * linha guarda o QID da edição e o do vencedor.
 *
 * Melhor faltar do que errar:
 * - edição com erro conhecido na fonte: corrigida por `EDITION_CORRECTIONS` (com a URL da lista oficial,
 *   `source = 'curated'`) ou recusada;
 * - edição com mais de um vencedor (sem qualificador), sem data, com rótulo e datas divergentes, ou cujo
 *   vencedor não está entre os participantes (P1923) que a própria edição lista: fica de fora;
 * - edição cuja final está no nosso core com outro campeão: fica de fora (o core manda);
 * - vencedor sem QID ligado ao nosso time: a linha é guardada sem `participant_id` (não conta). A ligação
 *   nova só sai com nome igual a um rótulo/apelido do Wikidata, mesmo país, time adulto masculino e par
 *   único dos dois lados.
 */

export interface TitleCompetition {
  /** QID da competição no Wikidata (as edições apontam para ela com P3450). */
  qid: string;
  /** Competições nossas (core.competition.slug) que recebem os títulos. */
  slugs: string[];
  label: string;
  /** Anos sem edição (competição não disputada): não contam como lacuna na cobertura. */
  noEditionYears?: readonly number[];
  /**
   * Só as edições cujo rótulo (en) casa: a liga com Apertura e Clausura no mesmo QID vira dois feeds, cada um com o
   * campeão do seu torneio. Edição sem o torneio no rótulo fica de fora dos dois (melhor faltar do que contar o
   * campeão do Apertura como o do Clausura).
   */
  edition?: RegExp;
}

/** Competições cobertas: continentais e mundiais de clubes, Brasil e ligas tier 1 da LatAm. */
export const TITLE_COMPETITIONS: readonly TitleCompetition[] = [
  { qid: 'Q184795', slugs: ['conmebol-libertadores'], label: 'Copa Libertadores' },
  { qid: 'Q60585', slugs: ['conmebol-sudamericana'], label: 'Copa Sudamericana' },
  { qid: 'Q734296', slugs: ['conmebol-recopa'], label: 'Recopa Sudamericana' },
  { qid: 'Q843989', slugs: ['copa-do-brasil'], label: 'Copa do Brasil' },
  { qid: 'Q206813', slugs: ['brasileirao-serie-a'], label: 'Campeonato Brasileiro Série A' },
  { qid: 'Q18756', slugs: ['uefa-champions-league'], label: 'UEFA Champions League' },
  {
    qid: 'Q223366',
    slugs: ['fifa-club-world-cup'],
    label: 'FIFA Club World Cup',
    noEditionYears: [2001, 2002, 2003, 2004, 2024],
  },
  { qid: 'Q223170', slugs: ['argentina-liga-profesional'], label: 'Primera División (Argentina)' },
  { qid: 'Q287453', slugs: ['uruguay-primera'], label: 'Primera División (Uruguai)' },
  { qid: 'Q606832', slugs: ['chile-primera-division'], label: 'Primera División (Chile)' },
  { qid: 'Q1033349', slugs: ['colombia-primera-a'], label: 'Primera A (Colômbia)' },
  { qid: 'Q606652', slugs: ['peru-liga-1'], label: 'Primera División (Peru)' },
  { qid: 'Q2289847', slugs: ['ecuador-ligapro-serie-a'], label: 'Serie A (Equador)' },
  {
    qid: 'Q954911',
    slugs: ['paraguay-primera-apertura'],
    label: 'Primera División (Paraguai) · Apertura',
    edition: /\bapertura\b/i,
  },
  {
    qid: 'Q954911',
    slugs: ['paraguay-primera-clausura'],
    label: 'Primera División (Paraguai) · Clausura',
    edition: /\bclausura\b/i,
  },
  { qid: 'Q764690', slugs: ['liga-mx'], label: 'Liga MX' },
  { qid: 'Q1622667', slugs: ['bolivia-primera-division'], label: 'Primera División (Bolívia)' },
  { qid: 'Q1033339', slugs: ['venezuela-primera-division'], label: 'Primera División (Venezuela)' },
];

/** Lista oficial de campeões usada nas correções curadas (proveniência gravada em `source_ref`). */
const LIBERTADORES_FINALS = 'https://en.wikipedia.org/wiki/List_of_Copa_Libertadores_finals';

/**
 * Correções curadas de edições com erro no Wikidata (vandalismo ou campo trocado), cada uma com a fonte.
 * Sem elas, a edição fica recusada e a competição sem cobertura completa (nenhuma contagem sai). Valem só
 * para a edição listada; corrigida na fonte, a entrada pode sair daqui.
 */
export const EDITION_CORRECTIONS: Readonly<
  Record<string, { year: number; winner: string; note: string; sourceRef: string }>
> = {
  Q917635: {
    year: 1991,
    winner: 'Q207373',
    note: 'Wikidata aponta o Santiago Wanderers; campeão: Colo-Colo',
    sourceRef: LIBERTADORES_FINALS,
  },
  Q568076: {
    year: 1993,
    winner: 'Q38568',
    note: 'Wikidata aponta um item que não é clube; campeão: São Paulo',
    sourceRef: LIBERTADORES_FINALS,
  },
  Q578089: {
    year: 1997,
    winner: 'Q188277',
    note: 'Wikidata aponta o vice (Sporting Cristal); campeão: Cruzeiro',
    sourceRef: LIBERTADORES_FINALS,
  },
  Q522980: {
    year: 1998,
    winner: 'Q5014111',
    note: 'Wikidata aponta o Atlético Bucaramanga; campeão: Vasco da Gama',
    sourceRef: LIBERTADORES_FINALS,
  },
  Q26159444: {
    year: 2018,
    winner: 'Q15799',
    note: 'Wikidata rotula a edição como 2016 e aponta o Boca Juniors; campeão de 2018: River Plate',
    sourceRef: LIBERTADORES_FINALS,
  },
};

export type RejectReason =
  'several_winners' | 'no_date' | 'label_year_mismatch' | 'winner_not_participant' | 'core_disagrees';

export interface Edition {
  qid: string;
  competitionQid: string;
  label: string | null;
  winners: string[];
  /** Ano da edição (P585; sem ele, o início P580; sem ele, o fim P582). */
  seasonYear: number | null;
  seasonLabel: string | null;
  /** Fim da edição (P582) ou, só com o ano, 31/12. */
  decidedOn: string | null;
  /** A edição lista participantes (P1923) e o vencedor está entre eles? null = não lista. */
  winnerInParticipants: boolean | null;
  rejected?: { reason: RejectReason; detail?: string };
  /** `curated` quando uma correção de `EDITION_CORRECTIONS` substituiu o vencedor do Wikidata. */
  source: 'wikidata' | 'curated';
  sourceRef?: string;
  /** Vencedor(es) que o Wikidata afirmava, quando corrigido. */
  claimed?: string[];
}

const qidOf = (term: { value: string } | undefined) => term?.value.split('/').pop() ?? null;
const dateOf = (term: { value: string } | undefined) => (term ? term.value.slice(0, 10) : null);
const yearOf = (date: string | null) => (date ? Number(date.slice(0, 4)) : null);

export function editionsQuery(competitionQid: string): string {
  return `SELECT ?ed ?winner ?start ?end ?pit ?label ?hasPart ?inPart WHERE {
  ?ed wdt:P3450 wd:${competitionQid}.
  ?ed p:P1346 ?st. ?st ps:P1346 ?winner; wikibase:rank ?rank.
  FILTER(?rank != wikibase:DeprecatedRank)
  FILTER NOT EXISTS { ?st pq:P642 ?of }
  FILTER NOT EXISTS { ?st pq:P1352 ?pos FILTER(?pos != 1) }
  OPTIONAL { ?ed wdt:P580 ?start }
  OPTIONAL { ?ed wdt:P582 ?end }
  OPTIONAL { ?ed wdt:P585 ?pit }
  OPTIONAL { ?ed rdfs:label ?label FILTER(LANG(?label) = "en") }
  BIND(EXISTS { ?ed wdt:P1923 ?any } AS ?hasPart)
  BIND(EXISTS { ?ed wdt:P1923 ?winner } AS ?inPart)
} ORDER BY ?ed ?winner`;
}

/** Linhas do SPARQL → edições (uma por QID), já com as checagens que não dependem do core. */
export function parseEditions(competitionQid: string, rows: readonly SparqlBinding[]): Edition[] {
  const byQid = new Map<
    string,
    {
      label: string | null;
      winners: Set<string>;
      starts: string[];
      ends: string[];
      pits: string[];
      hasPart: boolean;
      notIn: Set<string>;
    }
  >();
  for (const r of rows) {
    const qid = qidOf(r.ed);
    const winner = qidOf(r.winner);
    if (!qid || !winner || !/^Q\d+$/.test(winner)) continue;
    const e = byQid.get(qid) ?? {
      label: r.label?.value ?? null,
      winners: new Set<string>(),
      starts: [],
      ends: [],
      pits: [],
      hasPart: false,
      notIn: new Set<string>(),
    };
    e.winners.add(winner);
    for (const [list, term] of [
      [e.starts, r.start],
      [e.ends, r.end],
      [e.pits, r.pit],
    ] as const) {
      const d = dateOf(term);
      if (d && !list.includes(d)) list.push(d);
    }
    if (r.hasPart?.value === 'true') e.hasPart = true;
    if (r.hasPart?.value === 'true' && r.inPart?.value !== 'true') e.notIn.add(winner);
    byQid.set(qid, e);
  }
  const out: Edition[] = [];
  for (const [qid, e] of byQid) {
    const start = e.starts.length === 1 ? e.starts[0]! : null;
    const end = e.ends.length === 1 ? e.ends[0]! : null;
    const pit = e.pits.length === 1 ? e.pits[0]! : null;
    // início depois do fim é erro de digitação na fonte: vale o fim
    const startYear = start && (!end || start <= end) ? yearOf(start) : null;
    const dateYears = [yearOf(pit), startYear, yearOf(end)].filter((y): y is number => y !== null);
    const range = labelRange(e.label);
    const rangeOk = !!range && range.some((y) => dateYears.includes(y));
    // temporada que cruza o ano ("2020–21"): vale o ano de início, como no core
    const seasonYear = rangeOk ? range[0]! : (dateYears[0] ?? null);
    const decidedOn = end ?? (dateYears.length ? `${Math.max(...dateYears)}-12-31` : null);
    const winners = [...e.winners].sort();
    const edition: Edition = {
      qid,
      competitionQid,
      label: e.label,
      winners,
      seasonYear,
      seasonLabel:
        seasonYear === null
          ? null
          : rangeOk
            ? `${range[0]}–${String(range[1]).slice(-2)}`
            : String(seasonYear),
      decidedOn,
      winnerInParticipants: e.hasPart ? e.notIn.size === 0 : null,
      source: 'wikidata',
    };
    const labelYears = range ?? labelSingleYear(e.label);
    const fix = EDITION_CORRECTIONS[qid];
    if (fix) {
      Object.assign(edition, {
        winners: [fix.winner],
        claimed: winners,
        seasonYear: fix.year,
        seasonLabel: String(fix.year),
        decidedOn: end && yearOf(end) === fix.year ? end : `${fix.year}-12-31`,
        source: 'curated',
        sourceRef: fix.sourceRef,
      });
    } else if (winners.length !== 1)
      edition.rejected = { reason: 'several_winners', detail: winners.join(', ') };
    else if (seasonYear === null || decidedOn === null) edition.rejected = { reason: 'no_date' };
    else if (labelYears && !labelYears.some((y) => dateYears.includes(y)))
      edition.rejected = { reason: 'label_year_mismatch', detail: `${e.label} × ${dateYears.join('/')}` };
    else if (edition.winnerInParticipants === false) edition.rejected = { reason: 'winner_not_participant' };
    out.push(edition);
  }
  return out.sort((a, b) => (a.seasonYear ?? 0) - (b.seasonYear ?? 0) || a.qid.localeCompare(b.qid));
}

/** Temporada que cruza o ano no rótulo: "2020–21 UEFA Champions League" → [2020, 2021]. */
export function labelRange(label: string | null): [number, number] | null {
  const m = label ? /\b(1[89]\d\d|20\d\d)\s*[–/-]\s*(\d{4}|\d{2})\b/.exec(label) : null;
  if (!m) return null;
  const first = Number(m[1]);
  const second = m[2]!.length === 4 ? Number(m[2]) : Math.floor(first / 100) * 100 + Number(m[2]);
  return second === first + 1 || (second === first + 1 - 100 && m[2]!.length === 2)
    ? [first, first + 1]
    : null;
}

/** Ano único no rótulo: "2021 Copa Libertadores" → [2021]. */
export function labelSingleYear(label: string | null): number[] | null {
  const m = label ? /\b(1[89]\d\d|20\d\d)\b/.exec(label) : null;
  return m ? [Number(m[1])] : null;
}

// ─── casamento estrito dos vencedores com os nossos times ────────────────────────────────────────

/** Nome comparável: sem acento, minúsculo, pontuação vira espaço e siglas soltas se juntam ("L.P." → "lp"). */
export function normalizeTeamName(s: string): string {
  const tokens = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const out: { text: string; acronym: boolean }[] = [];
  for (const t of tokens) {
    const letter = /^[a-z]$/.test(t);
    const prev = out[out.length - 1];
    if (letter && prev?.acronym) prev.text += t;
    else out.push({ text: t, acronym: letter });
  }
  return out.map((t) => t.text).join(' ');
}

/** Tokens genéricos de nome de clube, ignorados na segunda forma de comparação. */
const GENERIC = new Set([
  'club',
  'clube',
  'fc',
  'cf',
  'sc',
  'ec',
  'ac',
  'ca',
  'cd',
  'de',
  'del',
  'da',
  'do',
  'futbol',
  'football',
  'futebol',
]);

/** Formas comparáveis do nome: inteiro e sem os tokens genéricos (se sobrar algo). */
export function teamNameKeys(s: string): string[] {
  const full = normalizeTeamName(s);
  const core = full
    .split(' ')
    .filter((t) => !GENERIC.has(t))
    .join(' ');
  return [...new Set([full, core].filter(Boolean))];
}

/** Time da base, sem base/feminino/reserva no nome ("Palmeiras U20", "Palmeiras W", "Estudiantes La Plata Res"). */
export function isSeniorMenName(name: string): boolean {
  return !/(\s(W|U\d{2}|II|III|B|Res\.?|Reserves?|Women|Fem\.?|Femenino|Feminino)|\sSub-?\d{2})$/i.test(
    name.trim(),
  );
}

export interface WinnerInfo {
  qid: string;
  names: string[];
  /** ISO do país (P297, ou P300 para Inglaterra/Escócia...). */
  countries: string[];
}

export interface CoreTeam {
  id: string;
  name: string;
  country: string | null;
}

/** País do core ("GB-ENG") compatível com o ISO do Wikidata ("GB-ENG" ou "GB"). */
export function countryCompatible(core: string | null, iso: readonly string[]): boolean {
  if (!core || !iso.length) return false;
  return iso.some((c) => c === core || core.startsWith(`${c}-`));
}

export type WinnerResolution =
  | { participantId: string; via: 'provider_map' | 'name' }
  | { ambiguous: string[] }
  /**
   * A ligação do `provider_map` não serve: aponta para um time de base/feminino, ou o nome do vencedor bate
   * exatamente com outro time nosso, ou o único time com o nome exato tem outro QID. `suggested` = o time que o
   * nome indica, para `--corrigir-ligacoes`.
   */
  | { conflict: string; mappedTo: string; suggested?: string }
  | { none: true };

export interface MappedTeam {
  id: string;
  name: string;
}

interface TeamIndex {
  /** Nome inteiro normalizado → times. */
  exact: ReadonlyMap<string, CoreTeam[]>;
  /** Nome sem os tokens genéricos → times. */
  loose: ReadonlyMap<string, CoreTeam[]>;
  /** Time → QID que ele já tem no `provider_map`. */
  qidOf: ReadonlyMap<string, string>;
}

/** Times adultos masculinos do mesmo país cujo nome bate com um rótulo/apelido: exato e solto. */
function nameHits(w: WinnerInfo, index: TeamIndex): { exact: CoreTeam[]; loose: CoreTeam[] } {
  const pick = (map: ReadonlyMap<string, CoreTeam[]>, keys: Iterable<string>) => {
    const hits = new Map<string, CoreTeam>();
    for (const k of keys)
      for (const t of map.get(k) ?? [])
        if (isSeniorMenName(t.name) && countryCompatible(t.country, w.countries)) hits.set(t.id, t);
    return [...hits.values()];
  };
  return {
    exact: pick(index.exact, new Set(w.names.map(normalizeTeamName))),
    loose: pick(index.loose, new Set(w.names.flatMap(teamNameKeys))),
  };
}

/**
 * Vencedor → nosso time.
 * - Já ligado em `provider_map`: vale, salvo se o time ligado é de base/feminino ou se o nome do vencedor bate
 *   exatamente (rótulo/apelido inteiro) com outro time nosso — aí é conflito e não conta.
 * - Sem ligação: nome igual a um rótulo/apelido (primeiro o nome inteiro; sem par exato, sem os tokens
 *   genéricos), mesmo país, time adulto masculino sem outro QID, e um só candidato. O par único dos dois lados
 *   é conferido em `resolveWinners`.
 */
export function resolveWinner(
  w: WinnerInfo,
  mapped: ReadonlyMap<string, MappedTeam>,
  index: TeamIndex,
): WinnerResolution {
  const { exact, loose } = nameHits(w, index);
  const best = exact.length ? exact : loose;
  const free = (t: CoreTeam | undefined) => (t && !index.qidOf.has(t.id) ? t.id : undefined);
  const known = mapped.get(w.qid);
  if (known) {
    if (!isSeniorMenName(known.name)) {
      const suggested = best.length === 1 ? free(best[0]) : undefined;
      return {
        conflict: 'ligado a time de base/feminino',
        mappedTo: known.name,
        ...(suggested ? { suggested } : {}),
      };
    }
    if (exact.length === 1 && exact[0]!.id !== known.id) {
      const suggested = free(exact[0]);
      return {
        conflict: `o nome bate com ${exact[0]!.name}`,
        mappedTo: known.name,
        ...(suggested ? { suggested } : {}),
      };
    }
    return { participantId: known.id, via: 'provider_map' };
  }
  if (best.length > 1) return { ambiguous: best.map((t) => t.id) };
  const only = best[0];
  if (!only) return { none: true };
  // o único time com esse nome já tem outro QID: com nome exato, a ligação antiga é suspeita (ex.: o QID das
  // categorias de base no lugar do clube); com nome solto, é outro clube
  const other = index.qidOf.get(only.id);
  if (other)
    return exact.length === 1
      ? { conflict: `o time já tem outro QID (${other})`, mappedTo: '(sem ligação)', suggested: only.id }
      : { none: true };
  return { participantId: only.id, via: 'name' };
}

export function resolveWinners(
  winners: readonly WinnerInfo[],
  mapped: ReadonlyMap<string, MappedTeam>,
  teams: readonly CoreTeam[],
): Map<string, WinnerResolution> {
  const exact = new Map<string, CoreTeam[]>();
  const loose = new Map<string, CoreTeam[]>();
  for (const t of teams) {
    const full = normalizeTeamName(t.name);
    exact.set(full, [...(exact.get(full) ?? []), t]);
    for (const k of teamNameKeys(t.name)) loose.set(k, [...(loose.get(k) ?? []), t]);
  }
  const qidOf = new Map([...mapped.entries()].map(([qid, m]) => [m.id, qid]));
  const index: TeamIndex = { exact, loose, qidOf };
  const out = new Map<string, WinnerResolution>();
  for (const w of winners) out.set(w.qid, resolveWinner(w, mapped, index));
  // um time indicado para dois vencedores diferentes (casamento novo ou correção): nenhum vale
  const byTeam = new Map<string, string[]>();
  for (const [qid, r] of out) {
    const id =
      'participantId' in r && r.via === 'name' ? r.participantId : 'suggested' in r ? r.suggested : undefined;
    if (id) byTeam.set(id, [...(byTeam.get(id) ?? []), qid]);
  }
  for (const qids of byTeam.values())
    if (qids.length > 1) for (const q of qids) out.set(q, { ambiguous: qids });
  return out;
}

export function winnersInfoQuery(qids: readonly string[]): string {
  return `SELECT ?team ?name ?iso WHERE {
  VALUES ?team { ${qids.map((q) => `wd:${q}`).join(' ')} }
  { ?team rdfs:label ?name FILTER(LANG(?name) IN ("en", "es", "pt")) }
  UNION { ?team skos:altLabel ?name FILTER(LANG(?name) IN ("en", "es", "pt")) }
  OPTIONAL { ?team wdt:P17 ?c. OPTIONAL { ?c wdt:P297 ?iso2 } OPTIONAL { ?c wdt:P300 ?iso3 } BIND(COALESCE(?iso2, ?iso3) AS ?iso) }
}`;
}

export function parseWinnersInfo(rows: readonly SparqlBinding[]): WinnerInfo[] {
  const by = new Map<string, WinnerInfo>();
  for (const r of rows) {
    const qid = qidOf(r.team);
    if (!qid) continue;
    const w = by.get(qid) ?? { qid, names: [], countries: [] };
    if (r.name?.value && !w.names.includes(r.name.value)) w.names.push(r.name.value);
    if (r.iso?.value && !w.countries.includes(r.iso.value)) w.countries.push(r.iso.value);
    by.set(qid, w);
  }
  return [...by.values()];
}

// ─── banco ───────────────────────────────────────────────────────────────────────────────────────

export interface CoreChampion {
  /** Campeão pela final no core (null se não dá para afirmar: pênaltis sem `winner`). */
  participantId: string | null;
  /** Data da última partida da final. */
  decidedOn: string;
}

/** Campeões pelas finais encerradas do core, por competição × ano da temporada. */
export async function loadCoreChampions(
  db: Database,
  competitionIds: readonly string[],
): Promise<Map<string, CoreChampion>> {
  if (!competitionIds.length) return new Map();
  const rows = await db.execute<{
    competition_id: string;
    year: number;
    event_id: string;
    day: string;
    participant_id: string;
    goals: number | null;
    winner: boolean | null;
  }>(sql`
    select e.competition_id, se.year, e.id as event_id, e.starts_at::date::text as day, ep.participant_id,
           (ep.result->>'goals')::int as goals, (ep.result->>'winner')::boolean as winner
    from core.event e
    join core.stage s on s.id = e.stage_id and s.kind = 'final'
    join core.season se on se.id = e.season_id
    join core.event_participant ep on ep.event_id = e.id and ep.side in ('home', 'away')
    where e.status = 'finished' and e.competition_id in (${sql.join(
      competitionIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    order by e.starts_at
  `);
  const groups = new Map<string, (typeof rows)[number][]>();
  for (const r of rows) {
    const key = `${r.competition_id}|${r.year}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out = new Map<string, CoreChampion>();
  for (const [key, list] of groups) {
    const events = [...new Set(list.map((r) => r.event_id))];
    const last = list.filter((r) => r.event_id === events[events.length - 1]);
    const lastWinner = last.find((r) => r.winner === true)?.participant_id ?? null;
    let champion: string | null = null;
    if (events.length === 1) champion = lastWinner;
    else if (events.length === 2) {
      const agg = new Map<string, number>();
      for (const r of list) agg.set(r.participant_id, (agg.get(r.participant_id) ?? 0) + (r.goals ?? 0));
      const sorted = [...agg.entries()].sort((a, b) => b[1] - a[1]);
      champion = sorted.length === 2 && sorted[0]![1] !== sorted[1]![1] ? sorted[0]![0] : lastWinner;
    }
    out.set(key, { participantId: champion, decidedOn: last[0]!.day });
  }
  return out;
}

/** QIDs do Wikidata já ligados a times de futebol: QID → participante. */
export async function loadMappedTeams(db: Database): Promise<Map<string, MappedTeam>> {
  const rows = await db.execute<{ qid: string; id: string; name: string }>(sql`
    select m.provider_id as qid, m.entity_id as id, p.name from core.provider_map m
    join core.participant p on p.id = m.entity_id
    where m.provider = 'wikidata' and m.sport = 'football' and m.entity_type = 'participant'
  `);
  return new Map([...rows].map((r) => [r.qid, { id: r.id, name: r.name }]));
}

/** Clubes de futebol do core nos países pedidos (candidatos ao casamento por nome). */
export async function loadCoreTeams(db: Database, countries: readonly string[]): Promise<CoreTeam[]> {
  if (!countries.length) return [];
  const rows = await db.execute<{ id: string; name: string; country: string | null }>(sql`
    select id, name, country_code as country from core.participant
    where sport = 'football' and kind = 'club' and (${sql.join(
      countries.map((c) => sql`country_code = ${c} or country_code like ${`${c}-%`}`),
      sql` or `,
    )})
  `);
  return [...rows];
}

export async function loadCompetitionIds(
  db: Database,
  slugs: readonly string[],
): Promise<Map<string, string>> {
  if (!slugs.length) return new Map();
  const rows = await db.execute<{ slug: string; id: string }>(sql`
    select slug, id from core.competition where sport = 'football' and slug in (${sql.join(
      slugs.map((s) => sql`${s}`),
      sql`, `,
    )})
  `);
  return new Map([...rows].map((r) => [r.slug, r.id]));
}

export interface TitleRow {
  competitionId: string;
  participantId: string | null;
  seasonYear: number;
  seasonLabel: string;
  decidedOn: string;
  editionQid: string;
  winnerQid: string;
  competitionQid: string;
  source: 'wikidata' | 'curated';
  sourceRef: string | null;
}

export interface CoverageIssue {
  year: number;
  reason: RejectReason | 'missing_year';
  editionQid?: string;
}

export interface Coverage {
  competitionId: string;
  competitionQid: string;
  firstYear: number | null;
  latestYear: number | null;
  /** Último ano com a lista completa desde o primeiro (null = nenhum). */
  completeThrough: number | null;
  issues: CoverageIssue[];
}

/**
 * Cobertura de uma competição: anos com edição aceita, edições recusadas e anos faltando entre a primeira e a
 * última edição (fora os `noEditionYears`). A lista vale até o ano anterior à primeira lacuna.
 */
export function coverageOf(
  competition: Pick<TitleCompetition, 'qid' | 'noEditionYears'>,
  competitionId: string,
  editions: readonly Edition[],
): Coverage {
  const accepted = editions.filter((e) => !e.rejected && e.seasonYear !== null);
  const years = accepted.map((e) => e.seasonYear!);
  const issues: CoverageIssue[] = [];
  for (const e of editions) {
    if (!e.rejected) continue;
    const year = e.seasonYear ?? null;
    if (year !== null) issues.push({ year, reason: e.rejected.reason, editionQid: e.qid });
  }
  if (!years.length) {
    return {
      competitionId,
      competitionQid: competition.qid,
      firstYear: null,
      latestYear: null,
      completeThrough: null,
      issues,
    };
  }
  const first = Math.min(...years);
  const latest = Math.max(...years);
  const have = new Set(years);
  const skip = new Set(competition.noEditionYears ?? []);
  for (let y = first; y <= latest; y++)
    if (!have.has(y) && !skip.has(y)) issues.push({ year: y, reason: 'missing_year' });
  // edição recusada sem ano conhecido também quebra a lista
  const undated = editions.some((e) => e.rejected && e.seasonYear === null);
  const firstIssue = Math.min(...issues.map((i) => i.year).filter((y) => y >= first), Infinity);
  const completeThrough = undated ? null : firstIssue === Infinity ? latest : firstIssue - 1;
  issues.sort((a, b) => a.year - b.year);
  return {
    competitionId,
    competitionQid: competition.qid,
    firstYear: first,
    latestYear: latest,
    completeThrough: completeThrough !== null && completeThrough >= first ? completeThrough : null,
    issues,
  };
}

export interface SkippedCompetition {
  competitionId: string;
  reason: string;
}

/**
 * Competições que a gravação vai pular (`suspiciousDrop`: consulta sem edições aceitas, ou com menos da metade
 * dos títulos gravados), com o motivo. O `--plan` mostra a mesma lista sem gravar.
 */
export async function titleDropGuard(
  db: Pick<Database, 'execute'>,
  rows: readonly TitleRow[],
  coverage: readonly Coverage[],
): Promise<SkippedCompetition[]> {
  const ids = coverage.map((c) => c.competitionId);
  if (!ids.length) return [];
  const stored = new Map<string, number>();
  for (const r of await db.execute<{ competition_id: string; n: number }>(sql`
    select competition_id, count(*)::int as n from core.competition_title
    where source in ('wikidata', 'curated') and competition_id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
    group by competition_id
  `))
    stored.set(r.competition_id, Number(r.n));
  const incoming = new Map<string, number>();
  for (const r of rows) incoming.set(r.competitionId, (incoming.get(r.competitionId) ?? 0) + 1);
  return ids.flatMap((id) => {
    const reason = suspiciousDrop(stored.get(id) ?? 0, incoming.get(id) ?? 0);
    return reason ? [{ competitionId: id, reason }] : [];
  });
}

/**
 * Grava (idempotente): as ligações novas QID → time em `core.provider_map` e, por competição, substitui as
 * linhas `source = 'wikidata'`/`curated` pelas desta importação. Competição cuja consulta veio sem edições
 * aceitas, ou com bem menos que o gravado (`suspiciousDrop`), fica como estava (títulos e cobertura) e volta em
 * `skipped` com o motivo; `allowDrop` (`--aceitar-queda`) aceita a troca assim mesmo.
 */
export async function saveTitles(
  db: Database,
  rows: readonly TitleRow[],
  newLinks: ReadonlyMap<string, string>,
  coverage: readonly Coverage[],
  /** QID → time certo, para ligações do `provider_map` que apontavam para outro time (`--corrigir-ligacoes`). */
  relinks: ReadonlyMap<string, string> = new Map(),
  options: { allowDrop?: boolean } = {},
): Promise<{ titles: number; links: number; relinked: number; skipped: SkippedCompetition[] }> {
  return db.transaction(async (tx) => {
    const skipped = options.allowDrop ? [] : await titleDropGuard(tx, rows, coverage);
    const skippedIds = new Set(skipped.map((s) => s.competitionId));
    const competitionIds = coverage.map((c) => c.competitionId).filter((id) => !skippedIds.has(id));
    const kept = new Set(competitionIds);
    let links = 0;
    let relinked = 0;
    for (const [qid, participantId] of relinks) {
      const res = await tx.execute(sql`
        insert into core.provider_map (entity_type, entity_id, provider, sport, provider_id)
        values ('participant', ${participantId}, 'wikidata', 'football', ${qid})
        on conflict (provider, sport, entity_type, provider_id) do update set entity_id = excluded.entity_id
      `);
      relinked += res.count ?? 0;
    }
    for (const [qid, participantId] of newLinks) {
      const res = await tx.execute(sql`
        insert into core.provider_map (entity_type, entity_id, provider, sport, provider_id)
        values ('participant', ${participantId}, 'wikidata', 'football', ${qid})
        on conflict do nothing
      `);
      links += res.count ?? 0;
    }
    if (competitionIds.length)
      await tx.execute(sql`
        delete from core.competition_title where source in ('wikidata', 'curated') and competition_id in (${sql.join(
          competitionIds.map((id) => sql`${id}`),
          sql`, `,
        )})
      `);
    for (const r of rows) {
      if (!kept.has(r.competitionId)) continue;
      await tx.execute(sql`
        insert into core.competition_title
          (competition_id, participant_id, season_year, season_label, decided_on, edition_qid, winner_qid, competition_qid, source, source_ref)
        values (${r.competitionId}, ${r.participantId}, ${r.seasonYear}, ${r.seasonLabel}, ${r.decidedOn}::date,
                ${r.editionQid}, ${r.winnerQid}, ${r.competitionQid}, ${r.source}, ${r.sourceRef})
        on conflict (competition_id, edition_qid, winner_qid) do nothing
      `);
    }
    for (const c of coverage) {
      if (!kept.has(c.competitionId)) continue;
      await tx.execute(sql`
        insert into core.competition_title_coverage
          (competition_id, competition_qid, first_year, latest_year, complete_through, issues, checked_at)
        values (${c.competitionId}, ${c.competitionQid}, ${c.firstYear}, ${c.latestYear}, ${c.completeThrough},
                ${JSON.stringify(c.issues)}::jsonb, now())
        on conflict (competition_id) do update set
          competition_qid = excluded.competition_qid, first_year = excluded.first_year,
          latest_year = excluded.latest_year, complete_through = excluded.complete_through,
          issues = excluded.issues, checked_at = now()
      `);
    }
    return { titles: rows.filter((r) => kept.has(r.competitionId)).length, links, relinked, skipped };
  });
}

// ─── orquestração ────────────────────────────────────────────────────────────────────────────────

export interface CompetitionReport {
  competition: TitleCompetition;
  /** Competições nossas encontradas no core. */
  competitionIds: string[];
  editions: Edition[];
  accepted: Edition[];
  /** Anos sem edição aceita entre a primeira e a última (lacunas). */
  gaps: number[];
  latestYear: number | null;
}

/**
 * Busca as edições de todas as competições no Wikidata (uma consulta por QID), por competição da lista: a que
 * filtra o torneio (`edition`) fica só com as edições cujo rótulo casa.
 */
export async function fetchEditions(
  sparql: SparqlClient,
  competitions: readonly TitleCompetition[],
  log: (m: string) => void = () => {},
): Promise<Map<TitleCompetition, Edition[]>> {
  const out = new Map<TitleCompetition, Edition[]>();
  const byQid = new Map<string, Edition[]>();
  for (const c of competitions) {
    let all = byQid.get(c.qid);
    if (!all) {
      const { data } = await sparql.query(`titles-editions-${c.qid}`, editionsQuery(c.qid), {
        competition: c.qid,
      });
      all = parseEditions(c.qid, data.results.bindings);
      byQid.set(c.qid, all);
    }
    // cada competição com as suas cópias: a recusa por divergência com o core é marcada na edição
    const editions = all.filter((e) => !c.edition || c.edition.test(e.label ?? '')).map((e) => ({ ...e }));
    out.set(c, editions);
    log(`${c.label}: ${editions.length} edições com vencedor`);
    // o filtro do torneio (Paraguai): as edições do QID que ficaram de fora, para conferir o rótulo da fonte
    if (c.edition) {
      const left = all.filter((e) => !c.edition!.test(e.label ?? ''));
      if (left.length)
        log(
          `  fora do filtro ${c.edition}: ${left.length} — ` +
            left.map((e) => `${e.label ?? '(sem rótulo)'} (${e.qid})`).join('; '),
        );
    }
  }
  return out;
}

export async function fetchWinnersInfo(sparql: SparqlClient, qids: readonly string[]): Promise<WinnerInfo[]> {
  const unique = [...new Set(qids)].sort();
  const out: WinnerInfo[] = [];
  for (let i = 0; i < unique.length; i += 150) {
    const batch = unique.slice(i, i + 150);
    const { data } = await sparql.query('titles-winners', winnersInfoQuery(batch), {
      first: batch[0]!,
      n: batch.length,
    });
    out.push(...parseWinnersInfo(data.results.bindings));
  }
  return out;
}
