/**
 * Importância global × relevância por mercado (docs/06 §3.2).
 *
 * `importance` (0–100) é global e gravado no banco; a relevância soma um bônus do país pedido e é
 * calculada na requisição (`?market=BR`, ou o único mercado do plano do tenant) — não há coluna por
 * mercado: o bônus depende só do país dos participantes, do país da competição, da confederação e, na
 * semifinal, dos times do outro lado da chave, que mudam pouco e cabem numa expressão SQL
 * (ordenação/filtro) e num lookup em lote (resposta).
 *   +10 participante do país do mercado;
 *   +5  competição do país, ou continental/de seleções da confederação do mercado (FIFA/global não conta);
 *   +5  semifinal de mata-mata cuja outra semifinal tem um time do país: o jogo define o adversário dele
 *       na final (ou, decidida a outra semi e com disputa de 3º lugar, o adversário de quem caiu);
 *   bônus total ≤ 10; score = min(100, importance + bônus).
 * O detalhe do evento traz a conta em todos os mercados ativos (`relevance_by_market`).
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type {
  Event,
  EventRelevance,
  ImportanceBreakdown,
  RelevanceReason,
  RelevanceReasonCode,
} from '@galaxie/contracts';
import { competition, event, participant, season, stage, type EventImportanceBreakdown } from '@galaxie/db';
import { GLOBAL_CONFEDERATION, loadGeoConfig, type GeoConfig } from '@galaxie/geo';
import { knockoutStageRules } from '@galaxie/rules';
import {
  goalsOf,
  groupTies,
  loadStageMatches,
  rulesStageKey,
  type BuildContext,
  type StageMatch,
} from './builder.js';

export const TEAM_BONUS = 10;
export const COMPETITION_BONUS = 5;
export const OPPONENT_BONUS = 5;
export const MAX_MARKET_BONUS = 10;

let defaultGeo: GeoConfig | null | undefined;

/** config/geo carregada uma vez; sem ela, só o bônus de participante e de competição doméstica. */
export function marketGeo(): GeoConfig | null {
  if (defaultGeo === undefined) {
    try {
      defaultGeo = loadGeoConfig();
    } catch {
      defaultGeo = null;
    }
  }
  return defaultGeo;
}

/** `?market=` explícito; senão o mercado do plano quando o tenant tem exatamente um. */
export function resolveMarket(request: FastifyRequest, requested: string | undefined): string | null {
  if (requested) return requested.toUpperCase();
  const markets = request.tenant?.markets ?? [];
  return markets.length === 1 ? markets[0]!.toUpperCase() : null;
}

/** Mercados ativos: os de config/geo (`markets`) e, depois, os do plano do tenant que faltarem. */
export function activeMarkets(request: FastifyRequest, geo: GeoConfig | null = marketGeo()): string[] {
  const out = [...(geo?.markets ?? [])];
  for (const m of request.tenant?.markets ?? []) {
    const code = m.toUpperCase();
    if (/^[A-Z]{2}$/.test(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

/** O código do país pertence ao mercado? (GB cobre GB-ENG, GB-SCT…). */
export function inMarket(code: string | null | undefined, market: string): boolean {
  if (!code) return false;
  const c = code.toUpperCase();
  return c === market || c.startsWith(`${market}-`);
}

/** Confederação do mercado (GB → a dos membros GB-*). */
function confederationOf(geo: GeoConfig, market: string): string | undefined {
  return (
    geo.country(market)?.confederation ??
    geo.allCountries().find((c) => c.code.startsWith(`${market}-`))?.confederation
  );
}

export interface ContinentalEntry {
  sport: string;
  slug: string;
  /** Confederação dona da competição (a primeira não global do escopo). */
  confederation: string | null;
  /** O mercado entra como convidado (listado em `countries`), não pela confederação. */
  guest: boolean;
}

/**
 * Competições internacionais (por esporte) da confederação do mercado ou que o listam como convidado.
 * As globais (FIFA) ficam de fora: valem para todos os mercados, então não diferenciam nenhum.
 */
export function continentalSlugs(geo: GeoConfig | null, market: string): ContinentalEntry[] {
  if (!geo) return [];
  const conf = confederationOf(geo, market);
  return geo.scopedSports().flatMap((sport) =>
    geo.scopeEntries(sport).flatMap((e): ContinentalEntry[] => {
      const listed = e.countries.some((c) => inMarket(c, market));
      const member =
        conf !== undefined &&
        e.confederations.includes(conf) &&
        !e.confederations.includes(GLOBAL_CONFEDERATION);
      if (!member && !listed) return [];
      return [
        {
          sport,
          slug: e.slug,
          confederation: e.confederations.find((c) => c !== GLOBAL_CONFEDERATION) ?? null,
          guest: !member,
        },
      ];
    }),
  );
}

/** Time do outro lado da chave (semifinal) e onde ele pode cruzar com quem sair deste jogo. */
export interface BracketTeam {
  id: string;
  name: string;
  countryCode: string | null;
  /** `final`: em aberto ou classificado; `third_place`: caiu e há disputa de 3º lugar. */
  round: 'final' | 'third_place';
}

export interface MarketFacts {
  participantCountries: readonly (string | null)[];
  competition: { sport: string; slug: string; countryCode: string | null } | null;
  /** Só na semifinal de mata-mata: os times da outra semifinal. */
  bracket?: readonly BracketTeam[] | undefined;
}

export interface MarketReason {
  code: RelevanceReasonCode;
  points: number;
  /** Times da outra semifinal citados no motivo (`decides_*_opponent`). */
  teams: BracketTeam[];
}

/** Bônus de mercado (função pura). `details` traz os pontos de cada motivo; `bonus` respeita o teto. */
export function marketBonus(
  market: string,
  facts: MarketFacts,
  continental: ReadonlySet<string>,
): { bonus: number; reasons: EventRelevance['reasons']; details: MarketReason[] } {
  const details: MarketReason[] = [];
  if (facts.participantCountries.some((c) => inMarket(c, market)))
    details.push({ code: 'team_from_market', points: TEAM_BONUS, teams: [] });
  const c = facts.competition;
  if (c && inMarket(c.countryCode, market))
    details.push({ code: 'domestic_competition', points: COMPETITION_BONUS, teams: [] });
  else if (c && continental.has(`${c.sport}|${c.slug}`))
    details.push({ code: 'continental_competition', points: COMPETITION_BONUS, teams: [] });
  // semifinal: conta uma vez só, mesmo com dois times do país do outro lado (a final é contra um deles)
  const rivals = (facts.bracket ?? []).filter((t) => inMarket(t.countryCode, market));
  const toFinal = rivals.filter((t) => t.round === 'final');
  if (toFinal.length)
    details.push({ code: 'decides_final_opponent', points: OPPONENT_BONUS, teams: toFinal });
  else if (rivals.length)
    details.push({ code: 'decides_third_place_opponent', points: OPPONENT_BONUS, teams: rivals });
  const bonus = Math.min(
    MAX_MARKET_BONUS,
    details.reduce((sum, d) => sum + d.points, 0),
  );
  return { bonus, reasons: details.map((d) => d.code), details };
}

// ─── textos dos motivos ──────────────────────────────────────────────────────────────────────────

type Lang = 'pt' | 'es' | 'en';

interface ReasonVars {
  /** Times do país em campo ("Palmeiras e Fluminense"). */
  teams: string;
  /** Times da outra semifinal ("Flamengo ou Estudiantes L.P."). */
  rivals: string;
  confederation: string | null;
  guest: boolean;
}

type ReasonDict = { and: string; or: string } & Record<RelevanceReasonCode, (v: ReasonVars) => string>;

/** Nomes de clubes vão sem artigo ("de Estudiantes"): o gênero do nome não está na base. */
const REASON_TEXTS: Record<Lang, ReasonDict> = {
  pt: {
    and: 'e',
    or: 'ou',
    team_from_market: (v) => (v.teams ? `Time do país: ${v.teams}` : 'Time do país'),
    domestic_competition: () => 'Competição do país',
    continental_competition: (v) =>
      v.guest
        ? `País convidado (${v.confederation ?? 'competição continental'})`
        : v.confederation
          ? `Competição da ${v.confederation}`
          : 'Competição da confederação',
    decides_final_opponent: (v) => `Define o adversário de ${v.rivals} na final`,
    decides_third_place_opponent: (v) => `Define o adversário de ${v.rivals} na disputa do 3º lugar`,
  },
  es: {
    and: 'y',
    or: 'o',
    team_from_market: (v) => (v.teams ? `Equipo del país: ${v.teams}` : 'Equipo del país'),
    domestic_competition: () => 'Competición del país',
    continental_competition: (v) =>
      v.guest
        ? `País invitado (${v.confederation ?? 'competición continental'})`
        : v.confederation
          ? `Competición de la ${v.confederation}`
          : 'Competición de la confederación',
    decides_final_opponent: (v) => `Define el rival de ${v.rivals} en la final`,
    decides_third_place_opponent: (v) => `Define el rival de ${v.rivals} en el partido por el 3.er puesto`,
  },
  en: {
    and: 'and',
    or: 'or',
    team_from_market: (v) => (v.teams ? `Home-country team: ${v.teams}` : 'Home-country team'),
    domestic_competition: () => 'Domestic competition',
    continental_competition: (v) =>
      v.guest
        ? `Guest country (${v.confederation ?? 'continental competition'})`
        : v.confederation
          ? `${v.confederation} competition`
          : 'Confederation competition',
    decides_final_opponent: (v) => `Decides the final opponent of ${v.rivals}`,
    decides_third_place_opponent: (v) => `Decides the third-place opponent of ${v.rivals}`,
  },
};

function joinNames(names: string[], word: string): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${word} ${names.at(-1)}`;
}

/** Motivo pronto para a resposta: pontos, texto no idioma pedido e o time citado. */
export function reasonDto(
  d: MarketReason,
  locale: string,
  vars: { teams: string[]; continental: ContinentalEntry | undefined },
): RelevanceReason {
  const dict = REASON_TEXTS[locale.split('-')[0] as Lang] ?? REASON_TEXTS.en;
  const text = dict[d.code]({
    teams: joinNames(vars.teams, dict.and),
    rivals: joinNames(
      d.teams.map((t) => t.name),
      dict.or,
    ),
    confederation: vars.continental?.confederation ?? null,
    guest: vars.continental?.guest ?? false,
  });
  const first = d.teams[0];
  return {
    code: d.code,
    points: d.points,
    text,
    participant: first ? { id: first.id, name: first.name } : null,
  };
}

// ─── chave da semifinal ──────────────────────────────────────────────────────────────────────────

/**
 * Resultado do confronto (ida e volta somadas; empate decidido nos pênaltis da última perna). Decidido só
 * com todas as pernas esperadas encerradas; empate sem pênaltis no core fica em aberto.
 */
export function tieOutcome(
  legs: StageMatch[],
  expectedLegs: number | null,
): { winner: string; loser: string } | null {
  const first = legs[0];
  if (!first?.homeId || !first.awayId) return null;
  if (legs.length < (expectedLegs ?? legs.length) || legs.some((l) => l.status !== 'finished')) return null;
  const [a, b] = [first.homeId, first.awayId];
  const totals = new Map<string, number>([
    [a, 0],
    [b, 0],
  ]);
  for (const l of legs) {
    const g = goalsOf(l);
    if (!g) return null;
    for (const [id, n] of g) totals.set(id, (totals.get(id) ?? 0) + n);
  }
  const ga = totals.get(a)!;
  const gb = totals.get(b)!;
  if (ga !== gb) return ga > gb ? { winner: a, loser: b } : { winner: b, loser: a };
  const last = legs.at(-1)!;
  const pen = last.score?.penalty;
  if (pen?.home == null || pen.away == null || pen.home === pen.away || !last.homeId || !last.awayId)
    return null;
  const winner = pen.home > pen.away ? last.homeId : last.awayId;
  return { winner, loser: winner === a ? b : a };
}

/**
 * Times do outro lado da chave de cada semifinal do lote. Só é exato com duas semifinais na fase: a
 * outra é o outro lado da chave. Em quartas e oitavas a api-sports não informa o chaveamento.
 * TODO(chaveamento): estender às quartas e oitavas quando o regulamento (`config/rules`) cadastrar a chave.
 */
export async function loadBrackets(
  ctx: Pick<BuildContext, 'db' | 'rules'>,
  events: Pick<Event, 'id' | 'stage'>[],
): Promise<Map<string, BracketTeam[]>> {
  const out = new Map<string, BracketTeam[]>();
  const semis = events.filter((e) => e.stage?.kind === 'semi_final').map((e) => e.id);
  if (!semis.length) return out;
  const heads = await ctx.db
    .select({
      id: event.id,
      stageId: stage.id,
      label: stage.providerLabel,
      slug: competition.slug,
      year: season.year,
      thirdPlace: sql<boolean>`exists (select 1 from core.stage s3
        where s3.season_id = ${stage.seasonId} and s3.kind = 'third_place')`,
    })
    .from(event)
    .innerJoin(stage, eq(stage.id, event.stageId))
    .leftJoin(competition, eq(competition.id, event.competitionId))
    .leftJoin(season, eq(season.id, event.seasonId))
    .where(and(inArray(event.id, semis), eq(stage.kind, 'semi_final')));
  if (!heads.length) return out;
  const ties = groupTies(
    (await loadStageMatches(ctx.db, [...new Set(heads.map((h) => h.stageId))])).filter(
      (m) => m.status !== 'cancelled',
    ),
  );
  const pending = new Map<string, { id: string; round: BracketTeam['round'] }[]>();
  for (const h of heads) {
    const stageTies = [...ties.entries()].filter(([k]) => k.startsWith(`${h.stageId}|`)).map(([, v]) => v);
    if (stageTies.length !== 2) continue;
    const other = stageTies.find((legs) => !legs.some((l) => l.id === h.id));
    const [home, away] = [other?.[0]?.homeId, other?.[0]?.awayId];
    if (!other || !home || !away) continue;
    const rules = h.slug ? await ctx.rules.get(h.slug, h.year) : null;
    const expected = rules ? knockoutStageRules(rules, rulesStageKey('semi_final', h.label)).legs : null;
    const outcome = tieOutcome(other, expected);
    pending.set(
      h.id,
      outcome
        ? [
            { id: outcome.winner, round: 'final' },
            ...(h.thirdPlace ? [{ id: outcome.loser, round: 'third_place' as const }] : []),
          ]
        : [
            { id: home, round: 'final' },
            { id: away, round: 'final' },
          ],
    );
  }
  const ids = [...new Set([...pending.values()].flat().map((t) => t.id))];
  if (!ids.length) return out;
  const parts = await ctx.db
    .select({ id: participant.id, name: participant.name, country: participant.countryCode })
    .from(participant)
    .where(inArray(participant.id, ids));
  const partBy = new Map(parts.map((p) => [p.id, p]));
  for (const [eventId, teams] of pending)
    out.set(
      eventId,
      teams.map((t) => ({
        id: t.id,
        name: partBy.get(t.id)?.name ?? '',
        countryCode: partBy.get(t.id)?.country ?? null,
        round: t.round,
      })),
    );
  return out;
}

// ─── preenchimento das respostas ─────────────────────────────────────────────────────────────────

type RelevanceCtx = Pick<BuildContext, 'db' | 'rules' | 'locale'>;

interface RelevanceFacts {
  countryOf: Map<string, string | null>;
  compOf: Map<string, { sport: string; slug: string; country: string | null }>;
  brackets: Map<string, BracketTeam[]>;
}

/** Países dos participantes, competições e chaves das semifinais do lote (uma consulta por tabela). */
async function loadFacts(ctx: RelevanceCtx, events: Event[]): Promise<RelevanceFacts> {
  const participantIds = [...new Set(events.flatMap((e) => e.participants.map((p) => p.id)))];
  const competitionIds = [...new Set(events.flatMap((e) => (e.competition ? [e.competition.id] : [])))];
  const [parts, comps, brackets] = await Promise.all([
    participantIds.length
      ? ctx.db
          .select({ id: participant.id, country: participant.countryCode })
          .from(participant)
          .where(inArray(participant.id, participantIds))
      : [],
    competitionIds.length
      ? ctx.db
          .select({
            id: competition.id,
            sport: competition.sport,
            slug: competition.slug,
            country: competition.countryCode,
          })
          .from(competition)
          .where(inArray(competition.id, competitionIds))
      : [],
    loadBrackets(ctx, events),
  ]);
  return {
    countryOf: new Map(parts.map((p) => [p.id, p.country])),
    compOf: new Map(comps.map((c) => [c.id, c])),
    brackets,
  };
}

function relevanceOf(
  e: Event,
  market: string,
  facts: RelevanceFacts,
  continental: ContinentalEntry[],
  locale: string,
): EventRelevance {
  const comp = e.competition ? facts.compOf.get(e.competition.id) : undefined;
  const { bonus, reasons, details } = marketBonus(
    market,
    {
      participantCountries: e.participants.map((p) => facts.countryOf.get(p.id) ?? null),
      competition: comp ? { sport: comp.sport, slug: comp.slug, countryCode: comp.country } : null,
      bracket: facts.brackets.get(e.id),
    },
    new Set(continental.map((c) => `${c.sport}|${c.slug}`)),
  );
  const vars = {
    teams: e.participants.filter((p) => inMarket(facts.countryOf.get(p.id), market)).map((p) => p.name),
    continental: comp ? continental.find((c) => c.sport === comp.sport && c.slug === comp.slug) : undefined,
  };
  return {
    market,
    score: Math.min(100, e.importance + bonus),
    bonus,
    reasons,
    details: details.map((d) => reasonDto(d, locale, vars)),
  };
}

/** Preenche `relevance` dos eventos já montados no mercado pedido. */
export async function applyRelevance(
  ctx: RelevanceCtx,
  events: Event[],
  market: string | null,
  geo: GeoConfig | null = marketGeo(),
): Promise<void> {
  if (!market || !events.length) return;
  const facts = await loadFacts(ctx, events);
  const continental = continentalSlugs(geo, market);
  for (const e of events) e.relevance = relevanceOf(e, market, facts, continental, ctx.locale);
}

/**
 * Preenche `relevance_by_market` (detalhe do evento): a conta em cada mercado ativo, da maior nota para a
 * menor (no empate, a ordem de `markets`). Com `market`, também preenche `relevance`.
 */
export async function applyRelevanceByMarket(
  ctx: RelevanceCtx,
  events: Event[],
  markets: string[],
  market: string | null,
  geo: GeoConfig | null = marketGeo(),
): Promise<void> {
  if (!events.length) return;
  const facts = await loadFacts(ctx, events);
  const continental = new Map(
    [...new Set([...markets, ...(market ? [market] : [])])].map((m) => [m, continentalSlugs(geo, m)]),
  );
  for (const e of events) {
    if (market) e.relevance = relevanceOf(e, market, facts, continental.get(market)!, ctx.locale);
    e.relevance_by_market = markets
      .map((m, i) => ({ r: relevanceOf(e, m, facts, continental.get(m)!, ctx.locale), i }))
      .sort((a, b) => b.r.score - a.r.score || a.i - b.i)
      .map(({ r }) => r);
  }
}

/**
 * Mesma conta em SQL (ordenação `order=relevance` e filtro `relevance_min`). O bônus da semifinal aqui
 * considera os dois times da outra semifinal mesmo depois de decidida; a resposta (`relevance`) é exata.
 */
export function relevanceSql(market: string, geo: GeoConfig | null = marketGeo()): SQL {
  const like = `${market}-%`;
  const continental = continentalSlugs(geo, market);
  const continentalCond = continental.length
    ? sql` or (c.sport, c.slug) in (${sql.join(
        continental.map((x) => sql`(${x.sport}, ${x.slug})`),
        sql`, `,
      )})`
    : sql``;
  return sql`least(100, ${event.importance} + least(${MAX_MARKET_BONUS},
    (case when exists (select 1 from core.event_participant ep
                         join core.participant p on p.id = ep.participant_id
                        where ep.event_id = ${event.id}
                          and (p.country_code = ${market} or p.country_code like ${like}))
          then ${TEAM_BONUS} else 0 end)
  + (case when exists (select 1 from core.competition c
                        where c.id = ${event.competitionId}
                          and (c.country_code = ${market} or c.country_code like ${like}${continentalCond}))
          then ${COMPETITION_BONUS} else 0 end)
  + (case when exists (select 1 from core.stage s
                         join core.event e2 on e2.stage_id = s.id and e2.id <> ${event.id}
                                           and e2.status <> 'cancelled'
                         join core.event_participant ep2 on ep2.event_id = e2.id
                         join core.participant p2 on p2.id = ep2.participant_id
                        where s.id = ${event.stageId} and s.kind = 'semi_final'
                          and (p2.country_code = ${market} or p2.country_code like ${like})
                          and not exists (select 1 from core.event_participant ep3
                                           where ep3.event_id = ${event.id}
                                             and ep3.participant_id = ep2.participant_id))
          then ${OPPONENT_BONUS} else 0 end)))`;
}

/** Detalhamento público do `importance` (sem os campos internos do recálculo). */
export function importanceBreakdownDto(b: EventImportanceBreakdown | null): ImportanceBreakdown | null {
  if (!b) return null;
  const known = new Set(['title', 'relegation', 'elimination', 'qualification']);
  return {
    tier: b.tier,
    phase: b.phase,
    derby: b.derby,
    decisive: b.decisive,
    prestige: b.prestige ?? 0,
    flags: (b.flags ?? []).filter((f): f is ImportanceBreakdown['flags'][number] => known.has(f)),
  };
}
