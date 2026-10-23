/**
 * Normalização do pacote de hipismo (SQLite exportado, ver docs/13-hipismo.md §3) para o modelo `equestrian`.
 *
 * Funções puras sobre as tabelas do pacote: nada de I/O. Regras preservadas:
 * - classificação geral (`results`) e rodada (`rounds`) nunca se misturam;
 * - campo ausente fica `null` (nunca zero) e o bruto é mantido;
 * - toda linha leva fonte, URL e data de observação; divergências viram registros próprios;
 * - a mesma classificação vista em duas páginas (histórico do atleta e lista completa da prova) vira uma linha só.
 */
import { createHash } from 'node:crypto';
import type { PublishedBreakdown, RoundCells, ScorePart, TeamMember } from '@galaxie/db';
import {
  articleCode,
  countryFromName,
  displayName,
  horseGender,
  int,
  isGrandPrix,
  isoDate,
  judging,
  levelKind,
  num,
  stars,
  statusFromPosition,
  text,
} from './parse.js';

export type Row = Record<string, unknown>;
export type PackageTables = Record<string, Row[]>;

export interface NAthlete {
  feiId: string;
  nameAsPublished: string;
  displayName: string;
  firstName: string | null;
  familyName: string | null;
  gender: string | null;
  birthDate: string | null;
  birthDateRaw: string | null;
  nationality: string | null;
  competingFor: string | null;
  registryStatusRaw: string | null;
  historyCoverage: 'complete' | 'partial' | 'not_collected';
  displayedTotalRaw: string | null;
  collectedResults: number | null;
  sourceUrl: string | null;
  observedAt: string | null;
}

export interface NHorse {
  feiId: string;
  name: string;
  nameVariants: string[] | null;
  birthName: string | null;
  completeName: string | null;
  birthDate: string | null;
  birthDateRaw: string | null;
  gender: string | null;
  castrated: string | null;
  color: string | null;
  breed: string | null;
  studbook: string | null;
  breeder: string | null;
  sire: string | null;
  dam: string | null;
  damSire: string | null;
  birthCountry: string | null;
  adminNf: string | null;
  registryStatusRaw: string | null;
  profileStatus: 'detailed' | 'pending';
  sourceUrl: string | null;
  observedAt: string | null;
}

export interface NOwner {
  sourceKey: string;
  horseFeiId: string;
  ownerName: string;
  nationality: string | null;
  sinceRaw: string | null;
  percentageRaw: string | null;
  sourceUrl: string | null;
  observedAt: string | null;
}

export interface NCompetition {
  sourceKey: string;
  name: string;
  level: string | null;
  stars: number | null;
  levelKind: string | null;
  date: string | null;
  dateRaw: string | null;
  venue: string | null;
  countryCode: string | null;
  heightCm: number | null;
  articleCode: string | null;
  articleText: string | null;
  judging: string | null;
  isGrandPrix: boolean;
  scheduleNumber: string | null;
  showKey: string | null;
  showStart: string | null;
  showEnd: string | null;
  prizeTotal: number | null;
  prizeCurrency: string | null;
  prizeTotalRaw: string | null;
  displayedEntries: number | null;
  observedEntries: number | null;
  allEntriesObserved: boolean;
  feiReferenceCode: string | null;
  sourceUrl: string | null;
  observedAt: string | null;
}

export interface NResult {
  sourceKey: string;
  sourceKind: string;
  competitionKey: string | null;
  athleteFeiId: string | null;
  athleteNameAsPublished: string;
  horseFeiId: string | null;
  horseNameAsPublished: string | null;
  countryCode: string | null;
  countryBasis: string | null;
  date: string | null;
  position: number | null;
  positionRaw: string | null;
  status: string;
  scoreRaw: string | null;
  scoreParseStatus: string | null;
  penalties: number | null;
  penaltiesJumping: number | null;
  penaltiesTime: number | null;
  timeSeconds: number | null;
  scoreParts: ScorePart[] | null;
  roundCells: RoundCells[] | null;
  publishedBreakdown: PublishedBreakdown[] | null;
  prizeAmount: number | null;
  prizeCurrency: string | null;
  prizeRaw: string | null;
  qualityFlags: string[] | null;
  sourceUrl: string | null;
  observedAt: string | null;
}

export interface NRound {
  sourceKey: string;
  eventKey: string;
  stage: string;
  date: string | null;
  datePrecision: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  athleteFeiId: string | null;
  athleteNameAsPublished: string;
  horseFeiId: string | null;
  horseNameAsPublished: string | null;
  countryCode: string | null;
  bib: string | null;
  rankRaw: string | null;
  status: string | null;
  penaltiesJumping: number | null;
  penaltiesTime: number | null;
  score: number | null;
  scoreRaw: string | null;
  scoreSemantics: string | null;
  timeSeconds: number | null;
  sourceUrl: string | null;
  sourcePdfPage: number | null;
  sourceDocumentSha256: string | null;
  observedAt: string | null;
}

export interface NTeam {
  sourceKey: string;
  eventKey: string;
  countryCode: string;
  position: number | null;
  positionRaw: string | null;
  scoreRaw: string | null;
  prizeRaw: string | null;
  members: TeamMember[];
  arithmetic: Record<string, unknown> | null;
  sourceUrl: string | null;
  sourcePdfPage: number | null;
  observedAt: string | null;
}

export interface NRanking {
  sourceKey: string;
  rankingName: string;
  athleteFeiId: string | null;
  horseFeiId: string | null;
  horseNameAsPublished: string | null;
  rank: number | null;
  rankRaw: string | null;
  points: number | null;
  pointsRaw: string | null;
  edition: string | null;
  coverage: string | null;
  sourceUrl: string | null;
  observedAt: string | null;
}

export interface NDisagreement {
  sourceKey: string;
  athleteFeiId: string | null;
  eventKey: string | null;
  field: string;
  values: { label: string; value: string | null; url: string | null; page: number | null }[];
  resolution: string | null;
}

export interface NormalizedEquestrian {
  athletes: NAthlete[];
  horses: NHorse[];
  owners: NOwner[];
  competitions: NCompetition[];
  results: NResult[];
  rounds: NRound[];
  teams: NTeam[];
  rankings: NRanking[];
  disagreements: NDisagreement[];
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const rows = (t: PackageTables, name: string): Row[] => t[name] ?? [];

/** Datas fixas do relatório oficial de Atenas 2004 (a visão `documented_rounds` do pacote usa as mesmas). */
const ATHENS_2004 = { start: '2004-08-19', end: '2004-08-29' } as const;
/** Campeonato com subtotais publicados no documento oficial (Jerez 2002). */
const JEREZ_2002 = 'jerez_2002_jumping';

function parseFlags(v: unknown): string[] | null {
  const s = text(v);
  if (!s) return null;
  const flags = s
    .split(';')
    .map((f) => f.trim())
    .filter((f) => f && f !== 'ok');
  return flags.length ? flags : null;
}

function parseJson<T>(v: unknown): T | null {
  const s = text(v);
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

// ─── atletas ─────────────────────────────────────────────────────────────────────────────────────

function athletes(t: PackageTables): Map<string, NAthlete> {
  const out = new Map<string, NAthlete>();
  const blank = (feiId: string, name: string): NAthlete => ({
    feiId,
    nameAsPublished: name,
    displayName: displayName(name),
    firstName: null,
    familyName: null,
    gender: null,
    birthDate: null,
    birthDateRaw: null,
    nationality: null,
    competingFor: countryFromName(name),
    registryStatusRaw: null,
    historyCoverage: 'not_collected',
    displayedTotalRaw: null,
    collectedResults: null,
    sourceUrl: null,
    observedAt: null,
  });
  /** Só preenche lacunas: a primeira fonte (mais confiável) prevalece. */
  const add = (feiId: string | null, name: string | null, patch: Partial<NAthlete>) => {
    if (!feiId || !name) return;
    const cur = out.get(feiId) ?? blank(feiId, name);
    for (const [k, v] of Object.entries(patch) as [keyof NAthlete, unknown][]) {
      if (v === null || v === undefined) continue;
      const prev = cur[k];
      if (prev === null || prev === undefined || (k === 'historyCoverage' && prev === 'not_collected'))
        (cur as unknown as Record<string, unknown>)[k] = v;
    }
    out.set(feiId, cur);
  };

  // 1) catálogo com status de leitura do histórico
  for (const r of rows(t, 'athletes')) {
    const collected = int(r.collected_jumping_results);
    add(text(r.athlete_fei_id), text(r.athlete_name), {
      competingFor: text(r.represented_country_current),
      historyCoverage:
        Number(r.verified_all_displayed_pages) === 1 ? 'complete' : collected ? 'partial' : 'not_collected',
      displayedTotalRaw: text(r.displayed_total),
      collectedResults: collected,
      sourceUrl: text(r.performance_url),
      observedAt: text(r.collected_at_utc),
    });
  }
  // 2) cadastro público (nome, gênero, nascimento, nacionalidade)
  for (const r of rows(t, 'athlete_profiles')) {
    const feiId = text(r.athlete_fei_id);
    const first = text(r.first_name);
    const family = text(r.family_name);
    const published = family && first ? `${family}, ${first}` : null;
    if (feiId && published && out.has(feiId)) {
      const a = out.get(feiId)!;
      a.firstName = first;
      a.familyName = family;
      a.displayName = displayName(published);
    }
    // atletas da consulta (com cadastro lido) sem histórico verificado por inteiro têm cobertura parcial
    add(feiId, published, {
      historyCoverage: 'partial',
      firstName: first,
      familyName: family,
      gender: text(r.gender_as_published),
      birthDate: isoDate(r.birth_date_raw),
      birthDateRaw: text(r.birth_date_raw),
      nationality: text(r.nationality_as_published),
      registryStatusRaw: text(r.registry_status_raw)?.replace(/\s*History\.\.\.$/, '') ?? null,
    });
    if (feiId && out.has(feiId) && !out.get(feiId)!.sourceUrl) out.get(feiId)!.sourceUrl = text(r.source_url);
  }
  // 3) participantes conhecidos só por classificações
  for (const r of rows(t, 'participants'))
    add(text(r.athlete_fei_id), text(r.athlete_name), { competingFor: text(r.country_as_observed) });
  for (const r of rows(t, 'championship_participants'))
    add(text(r.athlete_fei_id), text(r.name_as_observed), {});
  for (const r of rows(t, 'historical_classifications'))
    add(text(r.athlete_fei_id), text(r.athlete_name_as_published), {
      competingFor: text(r.country_as_published),
    });
  for (const r of rows(t, 'championship_classifications'))
    add(text(r.athlete_fei_id), text(r.athlete_name_as_published), {
      competingFor: text(r.country_as_published),
    });
  for (const r of rows(t, 'competition_entries'))
    add(text(r.athlete_fei_id), text(r.athlete_name_as_published), {
      competingFor: text(r.country_as_published),
    });
  return out;
}

// ─── cavalos ─────────────────────────────────────────────────────────────────────────────────────

function horses(t: PackageTables): Map<string, NHorse> {
  const out = new Map<string, NHorse>();
  for (const r of rows(t, 'horses')) {
    const feiId = text(r.horse_fei_id);
    const name = text(r.horse_name);
    if (!feiId || !name) continue;
    const detailed = text(r.profile_status) === 'public_detail_observed';
    const castrated = text(r.castrated);
    out.set(feiId, {
      feiId,
      name,
      nameVariants: parseJson<string[]>(r.name_variants),
      birthName: text(r.birth_name),
      completeName: text(r.complete_name_as_published),
      birthDate: isoDate(r.birth_date_iso_as_published),
      birthDateRaw: text(r.birth_date_raw),
      gender: horseGender(text(r.gender), castrated),
      castrated: castrated && castrated !== 'Unknown' ? castrated : null,
      color: text(r.color),
      breed: text(r.breed),
      studbook: text(r.studbook),
      breeder: text(r.breeder),
      sire: text(r.sire),
      dam: text(r.dam),
      damSire: text(r.dam_sire),
      birthCountry: text(r.birth_country),
      adminNf: text(r.admin_nf),
      registryStatusRaw: text(r.registry_status_raw)?.replace(/\s*History\.\.\.$/, '') ?? null,
      profileStatus: detailed ? 'detailed' : 'pending',
      sourceUrl: text(r.profile_source_url),
      observedAt: text(r.profile_collected_at),
    });
  }
  return out;
}

/** Cavalo que só aparece em resultados: entra como pendente (sem ficha), sem fundir nomes parecidos. */
function ensureHorse(map: Map<string, NHorse>, feiId: string | null, name: string | null) {
  if (!feiId || !name || map.has(feiId)) return;
  map.set(feiId, {
    feiId,
    name,
    nameVariants: null,
    birthName: null,
    completeName: null,
    birthDate: null,
    birthDateRaw: null,
    gender: null,
    castrated: null,
    color: null,
    breed: null,
    studbook: null,
    breeder: null,
    sire: null,
    dam: null,
    damSire: null,
    birthCountry: null,
    adminNf: null,
    registryStatusRaw: null,
    profileStatus: 'pending',
    sourceUrl: `https://data.fei.org/Horse/Detail.aspx?horsefeiid=${encodeURIComponent(feiId)}`,
    observedAt: null,
  });
}

// ─── provas ──────────────────────────────────────────────────────────────────────────────────────

function competitions(t: PackageTables): Map<string, NCompetition> {
  const events = new Map(rows(t, 'events').map((e) => [text(e.event_id), e]));
  const shows = new Map(rows(t, 'shows').map((s) => [text(s.show_id), s]));
  const out = new Map<string, NCompetition>();
  for (const r of rows(t, 'competitions')) {
    const key = text(r.competition_id);
    if (!key) continue;
    const level = text(r.event_category_raw);
    const article = text(r.article);
    const name = text(r.name) ?? 'Prova';
    const ev = events.get(text(r.event_id));
    const show = ev ? shows.get(text(ev.show_id)) : undefined;
    out.set(key, {
      sourceKey: key,
      name,
      level,
      stars: stars(level),
      levelKind: levelKind(level),
      date: isoDate(r.date_raw),
      dateRaw: text(r.date_raw),
      venue: text(r.venue_raw),
      countryCode: text(r.event_country),
      heightCm: int(r.height_cm_raw),
      articleCode: articleCode(article),
      articleText: article,
      judging: judging(article),
      isGrandPrix: isGrandPrix(name, article),
      scheduleNumber: text(r.schedule_number),
      showKey: text(show?.show_id),
      showStart: isoDate(show?.start_date),
      showEnd: isoDate(show?.end_date),
      prizeTotal: num(r.total_prize_amount_decimal),
      prizeCurrency: text(r.prize_currency),
      prizeTotalRaw: text(r.total_prize_raw),
      displayedEntries: int(r.displayed_entries),
      observedEntries: int(r.observed_entries),
      allEntriesObserved: Number(r.all_entries_observed) === 1,
      feiReferenceCode: text(r.fei_reference_code),
      sourceUrl: text(r.source_url),
      observedAt: text(r.collected_at),
    });
  }
  return out;
}

/** Prova sintetizada para classificações que não vieram com ID de prova (arquivo histórico, campeonatos). */
function syntheticCompetition(
  out: Map<string, NCompetition>,
  key: string,
  f: {
    name: string | null;
    level: string | null;
    date: string | null;
    venue: string | null;
    countryCode: string | null;
    article: string | null;
    sourceUrl: string | null;
    observedAt: string | null;
  },
) {
  if (out.has(key)) return;
  out.set(key, {
    sourceKey: key,
    name: f.name ?? 'Final Classification',
    level: f.level,
    stars: stars(f.level),
    levelKind: levelKind(f.level),
    date: f.date,
    dateRaw: f.date,
    venue: f.venue,
    countryCode: f.countryCode,
    heightCm: null,
    articleCode: articleCode(f.article),
    articleText: f.article,
    judging: judging(f.article) ?? 'historical',
    isGrandPrix: false,
    scheduleNumber: null,
    showKey: null,
    showStart: null,
    showEnd: null,
    prizeTotal: null,
    prizeCurrency: null,
    prizeTotalRaw: null,
    displayedEntries: null,
    observedEntries: null,
    allEntriesObserved: false,
    feiReferenceCode: null,
    sourceUrl: f.sourceUrl,
    observedAt: f.observedAt,
  });
}

// ─── classificações ──────────────────────────────────────────────────────────────────────────────

function scoreParts(t: PackageTables): Map<string, ScorePart[]> {
  const out = new Map<string, ScorePart[]>();
  for (const r of rows(t, 'score_parts')) {
    const id = text(r.result_id);
    if (!id) continue;
    const list = out.get(id) ?? [];
    list.push({
      sequence: Number(r.sequence),
      raw: String(r.raw ?? ''),
      kind: text(r.kind) ?? 'unparsed',
      value: num(r.numeric_value),
      penaltiesTotal: num(r.penalties_total),
      penaltiesJumping: num(r.penalties_jumping),
      penaltiesTime: num(r.penalties_time),
    });
    out.set(id, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.sequence - b.sequence);
  return out;
}

function roundCells(t: PackageTables): Map<string, RoundCells[]> {
  const out = new Map<string, RoundCells[]>();
  const sorted = [...rows(t, 'round_details')].sort(
    (a, b) => Number(a.column_index) - Number(b.column_index),
  );
  for (const r of sorted) {
    const id = text(r.entry_id);
    if (!id) continue;
    const list = out.get(id) ?? [];
    list.push({
      header: (text(r.round_header) ?? '').replace(/\s+/g, ' '),
      cells: parseJson<unknown>(r.cells_json),
      interpretation: text(r.interpretation_status) ?? 'raw',
    });
    out.set(id, list);
  }
  return out;
}

const comboKey = (competitionKey: string | null, athlete: string | null, horse: string | null) =>
  `${competitionKey ?? ''}|${athlete ?? ''}|${horse ?? ''}`;

export function normalizePackage(t: PackageTables): NormalizedEquestrian {
  const athleteMap = athletes(t);
  const horseMap = horses(t);
  const compMap = competitions(t);
  const parts = scoreParts(t);
  const cells = roundCells(t);
  const results: NResult[] = [];
  /** Classificação já registrada por (prova, atleta, cavalo): evita duplicar a mesma linha vista em duas páginas. */
  const seen = new Map<string, NResult>();
  const resultById = new Map<string, NResult>();

  // 1) históricos de atletas (fonte principal)
  const entityByResult = new Map(rows(t, 'result_entities').map((e) => [text(e.result_id), e]));
  for (const r of rows(t, 'results')) {
    const id = text(r.result_id);
    if (!id) continue;
    const entity = entityByResult.get(id);
    const competitionKey = text(entity?.competition_id);
    const explicit = text(r.score_parse_status) === 'explicit_single_round';
    const p = parts.get(id) ?? null;
    const explicitPart = explicit ? p?.find((x) => x.kind === 'explicit_penalties') : undefined;
    const res: NResult = {
      sourceKey: id,
      sourceKind: 'athlete_performance_history',
      competitionKey,
      athleteFeiId: text(r.athlete_fei_id),
      athleteNameAsPublished: text(r.athlete_name) ?? '—',
      horseFeiId: text(r.horse_fei_id),
      horseNameAsPublished: text(r.horse_name),
      countryCode: text(r.represented_country_current),
      countryBasis: 'current_profile_representation',
      date: isoDate(r.date_iso) ?? isoDate(r.date_raw),
      position: int(r.position),
      positionRaw: text(r.position_raw),
      status: statusFromPosition(r.position_raw, r.status),
      scoreRaw: text(r.score_raw),
      scoreParseStatus: text(r.score_parse_status),
      penalties: explicit ? num(r.penalties_round1) : null,
      penaltiesJumping: explicitPart?.penaltiesJumping ?? null,
      penaltiesTime: explicitPart?.penaltiesTime ?? null,
      timeSeconds: explicit ? num(r.time_round1_seconds) : null,
      scoreParts: p,
      roundCells: null,
      publishedBreakdown: null,
      prizeAmount: null,
      prizeCurrency: null,
      prizeRaw: null,
      qualityFlags: parseFlags(r.quality_flags),
      sourceUrl: text(r.source_result_url) ?? text(r.source_performance_url),
      observedAt: text(r.collected_at_utc),
    };
    ensureHorse(horseMap, res.horseFeiId, res.horseNameAsPublished);
    results.push(res);
    resultById.set(id, res);
    seen.set(comboKey(competitionKey, res.athleteFeiId, res.horseFeiId), res);
  }

  // 2) classificações completas de provas modernas: mesclam com o histórico quando é o mesmo conjunto
  const prizesByEntry = new Map<string, Row>();
  for (const a of rows(t, 'prize_awards')) {
    const e = text(a.entry_id);
    if (e) prizesByEntry.set(e, a);
  }
  for (const r of rows(t, 'competition_entries')) {
    const entryId = text(r.entry_id);
    const competitionKey = text(r.competition_id);
    if (!entryId) continue;
    const athleteFeiId = text(r.athlete_fei_id);
    const horseFeiId = text(r.horse_fei_id);
    const award = prizesByEntry.get(entryId);
    const prize = {
      prizeAmount: num(award?.amount_decimal) ?? num(r.prize_amount_decimal),
      prizeCurrency: text(award?.currency) ?? text(r.prize_currency),
      prizeRaw: text(r.prize_raw),
    };
    const roundCellsOf = cells.get(entryId) ?? null;
    const existing = seen.get(comboKey(competitionKey, athleteFeiId, horseFeiId));
    if (existing) {
      Object.assign(existing, prize, { roundCells: roundCellsOf });
      continue;
    }
    const comp = competitionKey ? compMap.get(competitionKey) : undefined;
    const res: NResult = {
      sourceKey: entryId,
      sourceKind: 'competition_entry',
      competitionKey,
      athleteFeiId,
      athleteNameAsPublished: text(r.athlete_name_as_published) ?? '—',
      horseFeiId,
      horseNameAsPublished: text(r.horse_name_as_published),
      countryCode: text(r.country_as_published),
      countryBasis: 'published_in_result',
      date: comp?.date ?? null,
      position: int(r.position_raw),
      positionRaw: text(r.position_raw),
      status: statusFromPosition(r.position_raw),
      scoreRaw: null,
      scoreParseStatus: 'not_published_in_entry_row',
      penalties: null,
      penaltiesJumping: null,
      penaltiesTime: null,
      timeSeconds: null,
      scoreParts: null,
      roundCells: roundCellsOf,
      publishedBreakdown: null,
      ...prize,
      qualityFlags: null,
      sourceUrl: text(r.source_url),
      observedAt: text(r.observed_at),
    };
    ensureHorse(horseMap, horseFeiId, res.horseNameAsPublished);
    results.push(res);
    seen.set(comboKey(competitionKey, athleteFeiId, horseFeiId), res);
  }

  // 3) arquivo histórico do calendário (2000–2001): prova sintetizada por cabeçalho publicado
  for (const r of rows(t, 'historical_classifications')) {
    const id = text(r.archive_result_id);
    if (!id) continue;
    const date = isoDate(r.date_iso);
    const level = text(r.event);
    const venue = text(r.venue);
    const country = text(r.event_country);
    const compName = text(r.competition);
    const competitionKey = `hist:${sha([date, level, venue, country, compName].join('|'))}`;
    syntheticCompetition(compMap, competitionKey, {
      name: compName,
      level,
      date,
      venue,
      countryCode: country,
      article: text(r.article),
      sourceUrl: text(r.source_url),
      observedAt: text(r.observed_at),
    });
    const athleteFeiId = text(r.athlete_fei_id);
    const horseFeiId = text(r.horse_fei_id);
    if (seen.has(comboKey(competitionKey, athleteFeiId, horseFeiId)) && athleteFeiId) continue;
    const res: NResult = {
      sourceKey: id,
      sourceKind: 'calendar_historical_classification',
      competitionKey,
      athleteFeiId,
      athleteNameAsPublished: text(r.athlete_name_as_published) ?? '—',
      horseFeiId,
      horseNameAsPublished: text(r.horse_name_as_published),
      countryCode: text(r.country_as_published),
      countryBasis: 'published_in_result',
      date,
      position: int(r.position_raw),
      positionRaw: text(r.position_raw),
      status: statusFromPosition(r.position_raw),
      scoreRaw: text(r.score_raw),
      scoreParseStatus: text(r.score_status),
      penalties: null,
      penaltiesJumping: null,
      penaltiesTime: null,
      timeSeconds: null,
      scoreParts: null,
      roundCells: null,
      publishedBreakdown: null,
      prizeAmount: num(r.prize_amount_decimal),
      prizeCurrency: text(r.prize_currency),
      prizeRaw: text(r.prize_raw),
      qualityFlags: parseFlags(r.quality_flags),
      sourceUrl: text(r.source_url),
      observedAt: text(r.observed_at),
    };
    ensureHorse(horseMap, horseFeiId, res.horseNameAsPublished);
    results.push(res);
    seen.set(comboKey(competitionKey, athleteFeiId, horseFeiId), res);
  }

  // 4) classificações finais de campeonatos (Atenas 2004, Jerez 2002): usam a mesma prova do histórico quando
  //    há vínculo explícito, e não duplicam o conjunto já registrado
  const champRows = rows(t, 'championship_classifications');
  const eventCompetition = new Map<string, string>();
  for (const r of champRows) {
    const base = text(r.existing_base_result_id);
    const eventKey = text(r.event_key);
    const comp = base ? resultById.get(base)?.competitionKey : null;
    if (eventKey && comp && !eventCompetition.has(eventKey)) eventCompetition.set(eventKey, comp);
  }
  // a classificação final do campeonato fica agrupada pela chave do campeonato (liga prova ↔ rodadas/equipes)
  for (const [eventKey, comp] of eventCompetition) {
    const c = compMap.get(comp);
    if (c) c.showKey = eventKey;
  }
  for (const r of champRows) {
    const id = text(r.classification_observation_id);
    const eventKey = text(r.event_key);
    if (!id || !eventKey) continue;
    if (text(r.existing_base_result_id)) continue; // já está no histórico do atleta
    let competitionKey = eventCompetition.get(eventKey);
    if (!competitionKey) {
      competitionKey = `champ:${eventKey}`;
      syntheticCompetition(compMap, competitionKey, {
        name: text(r.competition),
        level: text(r.event),
        date: isoDate(r.date_iso_as_published),
        venue: text(r.venue),
        countryCode: text(r.event_country),
        article: 'Hist',
        sourceUrl: text(r.source_url),
        observedAt: text(r.observed_at),
      });
      compMap.get(competitionKey)!.showKey = eventKey;
      eventCompetition.set(eventKey, competitionKey);
    }
    const athleteFeiId = text(r.athlete_fei_id);
    const horseFeiId = text(r.horse_fei_id);
    const dup = athleteFeiId
      ? results.find((x) => x.competitionKey === competitionKey && x.athleteFeiId === athleteFeiId)
      : undefined;
    if (dup) continue;
    const res: NResult = {
      sourceKey: id,
      sourceKind: 'championship_classification',
      competitionKey,
      athleteFeiId,
      athleteNameAsPublished: text(r.athlete_name_as_published) ?? '—',
      horseFeiId,
      horseNameAsPublished: text(r.horse_name_as_published),
      countryCode: text(r.country_as_published),
      countryBasis: 'published_in_result',
      date: isoDate(r.date_iso_as_published),
      position: int(r.position_raw),
      positionRaw: text(r.position_raw),
      status: statusFromPosition(r.position_raw),
      scoreRaw: text(r.score_raw),
      scoreParseStatus: text(r.score_raw)
        ? 'raw_preserved_requires_article_specific_parser'
        : 'not_published',
      penalties: null,
      penaltiesJumping: null,
      penaltiesTime: null,
      timeSeconds: null,
      scoreParts: null,
      roundCells: null,
      publishedBreakdown: null,
      prizeAmount: null,
      prizeCurrency: null,
      prizeRaw: text(r.prize_raw),
      qualityFlags: null,
      sourceUrl: text(r.source_url),
      observedAt: text(r.observed_at),
    };
    ensureHorse(horseMap, horseFeiId, res.horseNameAsPublished);
    results.push(res);
  }

  // 5) subtotais publicados no documento oficial de Jerez 2002, presos à classificação do atleta
  const jerezComp = eventCompetition.get(JEREZ_2002);
  for (const r of rows(t, 'jerez_individual_published_summary')) {
    const athleteFeiId = text(r.athlete_fei_id);
    const target = results.find((x) => x.competitionKey === jerezComp && x.athleteFeiId === athleteFeiId);
    if (!target) continue;
    const src = { sourceUrl: text(r.source_url), sourcePdfPage: int(r.source_pdf_page) };
    target.publishedBreakdown = [
      { label: '1st', value: text(r.first_day_raw), rank: text(r.first_day_rank_raw), ...src },
      { label: '2A', value: text(r.second_day_a_raw), rank: null, ...src },
      { label: '2B', value: text(r.second_day_b_raw), rank: null, ...src },
      { label: 'A+B', value: text(r.second_day_ab_raw), rank: text(r.second_day_ab_rank_raw), ...src },
      {
        label: '1+2',
        value: text(r.first_second_day_total_raw),
        rank: text(r.first_second_day_rank_raw),
        ...src,
      },
      { label: 'individual', value: null, rank: text(r.individual_place_raw), ...src },
    ];
  }

  // 6) rodadas documentadas (Atenas: relatório oficial; Jerez: documento digitalizado)
  const rounds: NRound[] = [];
  for (const r of rows(t, 'official_round_observations')) {
    rounds.push({
      sourceKey: text(r.round_observation_id)!,
      eventKey: text(r.event_key)!,
      stage: text(r.stage)!,
      date: isoDate(r.date_iso),
      datePrecision: 'exact_stage_date',
      eventStart: ATHENS_2004.start,
      eventEnd: ATHENS_2004.end,
      athleteFeiId: text(r.athlete_fei_id),
      athleteNameAsPublished: text(r.athlete_name) ?? '—',
      horseFeiId: text(r.horse_fei_id),
      horseNameAsPublished: text(r.horse_name),
      countryCode: text(r.country_as_published),
      bib: text(r.bib),
      rankRaw: text(r.rank_as_published),
      status: text(r.status),
      penaltiesJumping: num(r.penalties_jumping),
      penaltiesTime: num(r.penalties_time),
      score: num(r.penalties_total),
      scoreRaw: text(r.score_cells_raw),
      scoreSemantics: 'published_penalties',
      timeSeconds: num(r.time_seconds),
      sourceUrl: text(r.source_url),
      sourcePdfPage: int(r.source_pdf_page),
      sourceDocumentSha256: text(r.source_document_sha256),
      observedAt: text(r.source_document_collected_at),
    });
  }
  for (const r of rows(t, 'jerez_round_observations')) {
    rounds.push({
      sourceKey: text(r.round_observation_id)!,
      eventKey: text(r.event_key)!,
      stage: text(r.stage)!,
      date: isoDate(r.date_iso),
      datePrecision: text(r.date_precision),
      eventStart: isoDate(r.event_start_as_published),
      eventEnd: isoDate(r.event_end_as_published),
      athleteFeiId: text(r.athlete_fei_id),
      athleteNameAsPublished: text(r.athlete_name) ?? '—',
      horseFeiId: text(r.horse_fei_id),
      horseNameAsPublished: text(r.horse_name),
      countryCode: text(r.country_as_published),
      bib: null,
      rankRaw: null,
      status: text(r.status),
      penaltiesJumping: num(r.penalties_jumping),
      penaltiesTime: num(r.penalties_time),
      score: num(r.score_decimal),
      scoreRaw: text(r.score_raw),
      scoreSemantics: text(r.score_semantics),
      timeSeconds: num(r.time_seconds),
      sourceUrl: text(r.source_url),
      sourcePdfPage: int(r.source_pdf_page),
      sourceDocumentSha256: text(r.source_document_sha256),
      observedAt: text(r.observed_at),
    });
  }
  for (const r of rounds) ensureHorse(horseMap, r.horseFeiId, r.horseNameAsPublished);

  // 7) equipes: classificação publicada + detalhamento do documento oficial (Jerez)
  const membersByTeam = new Map<string, TeamMember[]>();
  for (const m of rows(t, 'championship_team_members')) {
    const k = text(m.team_observation_id);
    if (!k) continue;
    const list = membersByTeam.get(k) ?? [];
    list.push({
      athleteFeiId: text(m.athlete_fei_id),
      athleteName: text(m.athlete_name_as_published),
      horseFeiId: text(m.horse_fei_id),
      horseName: text(m.horse_name_as_published),
      individualPositionRaw: text(m.individual_classification_position_raw),
    });
    membersByTeam.set(k, list);
  }
  const jerezScores = new Map<string, Row>(
    rows(t, 'jerez_team_published_scores').map((s) => [text(s.athlete_fei_id) ?? '', s]),
  );
  const jerezTotals = new Map<string, Row>(
    rows(t, 'jerez_team_published_totals').map((s) => [text(s.country) ?? '', s]),
  );
  const teams: NTeam[] = [];
  for (const r of rows(t, 'championship_teams')) {
    const k = text(r.team_observation_id);
    const eventKey = text(r.event_key);
    const country = text(r.country);
    if (!k || !eventKey || !country) continue;
    const members = membersByTeam.get(k) ?? [];
    let arithmetic: Record<string, unknown> | null = null;
    if (eventKey === JEREZ_2002) {
      for (const m of members) {
        const s = m.athleteFeiId ? jerezScores.get(m.athleteFeiId) : undefined;
        if (s)
          m.scores = {
            '1st': text(s.first_day_raw),
            '2A': text(s.second_day_a_raw),
            '2B': text(s.second_day_b_raw),
          };
      }
      const tot = jerezTotals.get(country);
      if (tot)
        arithmetic = {
          published: {
            position: text(tot.position),
            firstDay: text(tot.first_day),
            secondDayA: text(tot.second_day_a),
            secondDayB: text(tot.second_day_b),
            total: text(tot.total),
          },
          firstDayLowestThreeRecomputed: text(tot.first_day_lowest_three_recomputed),
          firstDayArithmeticMatches:
            tot.first_day_arithmetic_matches === null ? null : Number(tot.first_day_arithmetic_matches) === 1,
          sourceUrl: text(tot.source_url),
          sourcePdfPage: int(tot.source_pdf_page),
        };
    }
    for (const m of members) ensureHorse(horseMap, m.horseFeiId, m.horseName);
    teams.push({
      sourceKey: k,
      eventKey,
      countryCode: country,
      position: int(r.position_raw),
      positionRaw: text(r.position_raw),
      scoreRaw: text(r.score_raw),
      prizeRaw: text(r.prize_raw),
      members,
      arithmetic,
      sourceUrl: text(r.source_url),
      sourcePdfPage: null,
      observedAt: text(r.observed_at),
    });
  }

  // 8) rankings observados e divergências
  const rankings: NRanking[] = rows(t, 'ranking_observations').map((r) => ({
    sourceKey: text(r.ranking_observation_id)!,
    rankingName: text(r.ranking_name) ?? '—',
    athleteFeiId: text(r.athlete_fei_id),
    horseFeiId: text(r.horse_fei_id),
    horseNameAsPublished: text(r.horse_name),
    rank: int(r.rank_raw),
    rankRaw: text(r.rank_raw),
    points: num(r.points_raw),
    pointsRaw: text(r.points_raw),
    edition: text(r.edition),
    coverage: text(r.coverage),
    sourceUrl: text(r.source_url),
    observedAt: text(r.observed_at),
  }));
  for (const r of rankings) ensureHorse(horseMap, r.horseFeiId, r.horseNameAsPublished);

  const disagreements: NDisagreement[] = [
    ...rows(t, 'source_disagreements').map((r) => ({
      sourceKey: text(r.disagreement_id)!,
      athleteFeiId: text(r.athlete_fei_id),
      eventKey: text(r.event_key),
      field: text(r.field) ?? '—',
      values: [
        { label: 'FEI', value: text(r.fei_value), url: text(r.fei_source_url), page: null },
        {
          label: 'official_report',
          value: text(r.official_report_value),
          url: text(r.official_report_source_url),
          page: int(r.official_report_pdf_page),
        },
      ],
      resolution: text(r.resolution),
    })),
    ...rows(t, 'jerez_source_disagreements').map((r) => ({
      sourceKey: text(r.issue_id)!,
      athleteFeiId: text(r.athlete_fei_id),
      eventKey: JEREZ_2002,
      field: text(r.field) ?? '—',
      values: [
        {
          label: 'team_table',
          value: text(r.team_table_value),
          url: text(r.source_url),
          page: int(r.team_pdf_page),
        },
        {
          label: 'individual_table',
          value: text(r.individual_table_value),
          url: text(r.source_url),
          page: int(r.individual_pdf_page),
        },
      ],
      resolution: text(r.resolution),
    })),
  ];

  const owners: NOwner[] = rows(t, 'horse_ownership_observations')
    .filter((r) => text(r.horse_fei_id) && text(r.owner_name))
    .map((r) => ({
      sourceKey: text(r.ownership_observation_id)!,
      horseFeiId: text(r.horse_fei_id)!,
      ownerName: text(r.owner_name)!,
      nationality: text(r.nationality_as_published),
      sinceRaw: text(r.since_raw),
      percentageRaw: text(r.percentage_raw),
      sourceUrl: text(r.source_url),
      observedAt: text(r.observed_at),
    }));

  // Atletas que só aparecem em rodadas/rankings também precisam existir
  for (const r of [...rounds, ...results])
    if (r.athleteFeiId && !athleteMap.has(r.athleteFeiId))
      athleteMap.set(r.athleteFeiId, {
        feiId: r.athleteFeiId,
        nameAsPublished: r.athleteNameAsPublished,
        displayName: displayName(r.athleteNameAsPublished),
        firstName: null,
        familyName: null,
        gender: null,
        birthDate: null,
        birthDateRaw: null,
        nationality: null,
        competingFor: r.countryCode,
        registryStatusRaw: null,
        historyCoverage: 'not_collected',
        displayedTotalRaw: null,
        collectedResults: null,
        sourceUrl: null,
        observedAt: null,
      });

  // Provas referenciadas sem cabeçalho no pacote não existem: o vínculo é descartado (nunca inventado)
  for (const r of results) if (r.competitionKey && !compMap.has(r.competitionKey)) r.competitionKey = null;

  return {
    athletes: [...athleteMap.values()],
    horses: [...horseMap.values()],
    owners,
    competitions: [...compMap.values()],
    results,
    rounds,
    teams,
    rankings,
    disagreements,
  };
}
