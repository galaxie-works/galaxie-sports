import { and, desc, eq, inArray, sql, type AnyColumn } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  LeadersQuery,
  StandingsParams,
  type CompetitionLeaders,
  type LeaderCategory,
  type LeaderRow,
} from '@galaxie/contracts';
import { asset, competition, participant, person, personSeasonStat, season } from '@galaxie/db';
import { alias } from 'drizzle-orm/pg-core';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { formatInstant, resolveLocale } from '../../i18n.js';
import { teamLogoId } from '../../assets/custom-logos.js';
import { loadTeamNames, teamNameOptions } from '../../teams/display-name.js';
import { assetUrl, parseInput, UUID_RE } from '../../util.js';

const MODULE = { module: 'core_data' } as const;

/** Soma de um jogador na temporada do campeonato (todas as linhas dele, de todos os times). */
export interface LeaderTotals {
  personId: string;
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
}

/** O número que a categoria ordena. */
export function leaderValue(t: LeaderTotals, category: LeaderCategory): number {
  if (category === 'goals') return t.goals;
  if (category === 'assists') return t.assists;
  return t.yellowCards + t.redCards;
}

/**
 * Ordena e numera: maior valor primeiro; nos cartões, mais vermelhos desempata; depois menos jogos e menos
 * minutos (fez o mesmo jogando menos). A posição é a do valor: empatados nele dividem a posição (1, 2, 2, 4).
 * Fica de fora quem tem zero.
 */
export function rankLeaders<T extends LeaderTotals>(
  rows: T[],
  category: LeaderCategory,
  limit: number,
): (T & { rank: number; value: number })[] {
  const sorted = rows
    .map((r) => ({ ...r, value: leaderValue(r, category) }))
    .filter((r) => r.value > 0)
    .sort(
      (a, b) =>
        b.value - a.value ||
        (category === 'cards' ? b.redCards - a.redCards : 0) ||
        a.appearances - b.appearances ||
        a.minutes - b.minutes ||
        a.personId.localeCompare(b.personId),
    )
    .slice(0, limit);
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || r.value !== sorted[i - 1]!.value) rank = i + 1;
    return { ...r, rank };
  });
}

/** Expressão SQL da categoria (para o `order by` e o corte no banco). */
function valueSql(category: LeaderCategory) {
  const sum = (col: AnyColumn) => sql`coalesce(sum(${col}), 0)`;
  if (category === 'goals') return sum(personSeasonStat.goals);
  if (category === 'assists') return sum(personSeasonStat.assists);
  return sql`${sum(personSeasonStat.yellowCards)} + ${sum(personSeasonStat.redCards)}`;
}

/** Linhas lidas a mais que o `limit`, para os desempates por jogos e minutos ficarem certos no corte. */
const SLACK = 20;

/** Artilharia e líderes por campeonato e temporada (#828), a partir de `core.person_season_stat`. */
export async function leadersRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/v1/competitions/:id/seasons/:season/leaders', { config: MODULE }, async (request, reply) => {
    const params = parseInput(StandingsParams, request.params);
    const query = parseInput(LeadersQuery, request.query);
    const locale = resolveLocale(query.locale, request.headers['accept-language']);
    const tz = query.tz ?? 'UTC';
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      ttl: CACHE_TTL.standings,
      vary: [locale, tz],
      load: async () => {
        const db = requireDb(ctx);
        const where = UUID_RE.test(params.id)
          ? eq(competition.id, params.id)
          : eq(competition.slug, params.id);
        const [c] = await db
          .select({ id: competition.id, sport: competition.sport })
          .from(competition)
          .where(where)
          .orderBy(sql`(${competition.sport} = 'football') desc`)
          .limit(1);
        if (!c) throw problems.notFound('Competição');
        const [s] = await db
          .select({ id: season.id, year: season.year, label: season.label })
          .from(season)
          .where(
            and(
              eq(season.competitionId, c.id),
              params.season === 'current' ? eq(season.current, true) : eq(season.year, Number(params.season)),
            ),
          )
          .orderBy(desc(season.year))
          .limit(1);
        if (!s) throw problems.notFound('Temporada');

        const value = valueSql(query.category);
        const totals = await db
          .select({
            personId: personSeasonStat.personId,
            appearances: sql<number>`coalesce(sum(${personSeasonStat.appearances}), 0)::int`,
            minutes: sql<number>`coalesce(sum(${personSeasonStat.minutes}), 0)::int`,
            goals: sql<number>`coalesce(sum(${personSeasonStat.goals}), 0)::int`,
            assists: sql<number>`coalesce(sum(${personSeasonStat.assists}), 0)::int`,
            yellowCards: sql<number>`coalesce(sum(${personSeasonStat.yellowCards}), 0)::int`,
            redCards: sql<number>`coalesce(sum(${personSeasonStat.redCards}), 0)::int`,
            // o time em que mais jogou (quem trocou de clube na temporada tem uma linha por time)
            teamId: sql<string>`(array_agg(${personSeasonStat.participantId} order by ${personSeasonStat.appearances} desc nulls last, ${personSeasonStat.minutes} desc nulls last))[1]`,
            updatedAt: sql<Date | string | null>`max(${personSeasonStat.updatedAt})`,
          })
          .from(personSeasonStat)
          .where(eq(personSeasonStat.seasonId, s.id))
          .groupBy(personSeasonStat.personId)
          .having(sql`${value} > 0`)
          .orderBy(sql`${value} desc`)
          .limit(query.limit + SLACK);

        const ranked = rankLeaders(totals, query.category, query.limit);
        const personIds = ranked.map((r) => r.personId);
        const teamIds = [...new Set(ranked.map((r) => r.teamId).filter(Boolean))];
        const photo = alias(asset, 'photo');
        const logo = alias(asset, 'logo');
        const [people, teams, names] = await Promise.all([
          personIds.length
            ? db
                .select({
                  id: person.id,
                  name: person.name,
                  storageKey: photo.storageKey,
                  sourceUrl: photo.sourceUrl,
                })
                .from(person)
                .leftJoin(photo, eq(photo.id, person.photoAssetId))
                .where(inArray(person.id, personIds))
            : [],
          teamIds.length
            ? db
                .select({
                  id: participant.id,
                  name: participant.name,
                  shortName: participant.shortName,
                  storageKey: logo.storageKey,
                  sourceUrl: logo.sourceUrl,
                })
                .from(participant)
                .leftJoin(logo, eq(logo.id, teamLogoId(ctx.logos.enabled())))
                .where(inArray(participant.id, teamIds))
            : [],
          loadTeamNames(db, teamIds, teamNameOptions(ctx, locale)),
        ]);
        const personBy = new Map(people.map((p) => [p.id, p]));
        const teamBy = new Map(teams.map((t) => [t.id, t]));

        let updatedAt: Date | null = null;
        const data: LeaderRow[] = [];
        for (const r of ranked) {
          const p = personBy.get(r.personId);
          if (!p) continue;
          const t = teamBy.get(r.teamId);
          const at = r.updatedAt ? new Date(r.updatedAt) : null;
          if (at && (!updatedAt || at > updatedAt)) updatedAt = at;
          data.push({
            rank: r.rank,
            person: { id: p.id, name: p.name, photo: assetUrl(ctx.assetsBaseUrl, p.storageKey, p.sourceUrl) },
            team: t
              ? {
                  id: t.id,
                  ...names.of(t.id, t.name),
                  short_name: t.shortName,
                  logo: assetUrl(ctx.assetsBaseUrl, t.storageKey, t.sourceUrl),
                }
              : null,
            value: r.value,
            appearances: r.appearances,
            minutes: r.minutes,
            goals: r.goals,
            assists: r.assists,
            yellow_cards: r.yellowCards,
            red_cards: r.redCards,
          });
        }
        const body: CompetitionLeaders = {
          competition_id: c.id,
          sport: c.sport,
          season: { year: s.year, label: s.label },
          category: query.category,
          data,
          updated_at: updatedAt ? formatInstant(updatedAt, tz) : null,
        };
        return { body, tags: [`leaders:${s.id}`, `competition:${c.id}`] };
      },
    });
  });
}
