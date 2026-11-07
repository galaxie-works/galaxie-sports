import { and, asc, desc, eq, inArray, lte, sql, type AnyColumn } from 'drizzle-orm';
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

/** Expressão SQL da categoria: o número que ordena e numera. */
function valueSql(category: LeaderCategory) {
  const sum = (col: AnyColumn) => sql`coalesce(sum(${col}), 0)`;
  if (category === 'goals') return sum(personSeasonStat.goals);
  if (category === 'assists') return sum(personSeasonStat.assists);
  return sql`${sum(personSeasonStat.yellowCards)} + ${sum(personSeasonStat.redCards)}`;
}

/** Teto de linhas quando há empatados no corte (o mesmo máximo do `limit`). */
export const LEADERS_MAX_ROWS = 50;

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

        // O banco é a única fonte da ordem e da posição: `rank()` dá a posição pelo valor (empatados dividem:
        // 1, 2, 2, 4) e o corte é pela posição, então quem empata com o último entra junto (até o teto).
        const value = valueSql(query.category);
        const sum = (col: AnyColumn) => sql<number>`coalesce(sum(${col}), 0)::int`;
        const totals = db
          .select({
            personId: personSeasonStat.personId,
            value: sql<number>`(${value})::int`.as('value'),
            rank: sql<number>`(rank() over (order by ${value} desc))::int`.as('rank'),
            appearances: sum(personSeasonStat.appearances).as('appearances'),
            minutes: sum(personSeasonStat.minutes).as('minutes'),
            goals: sum(personSeasonStat.goals).as('goals'),
            assists: sum(personSeasonStat.assists).as('assists'),
            yellowCards: sum(personSeasonStat.yellowCards).as('yellow_cards'),
            redCards: sum(personSeasonStat.redCards).as('red_cards'),
            // o time em que mais jogou (quem trocou de clube na temporada tem uma linha por time); empate
            // em jogos e minutos fica com o time da linha atualizada por último, e depois com o id (estável)
            teamId:
              sql<string>`(array_agg(${personSeasonStat.participantId} order by ${personSeasonStat.appearances} desc nulls last, ${personSeasonStat.minutes} desc nulls last, ${personSeasonStat.updatedAt} desc, ${personSeasonStat.participantId}::text))[1]`.as(
                'team_id',
              ),
            updatedAt: sql<Date | string | null>`max(${personSeasonStat.updatedAt})`.as('updated_at'),
          })
          .from(personSeasonStat)
          .where(eq(personSeasonStat.seasonId, s.id))
          .groupBy(personSeasonStat.personId)
          .having(sql`${value} > 0`)
          .as('t');
        const ranked = await db
          .select()
          .from(totals)
          .where(lte(totals.rank, query.limit))
          // dentro da posição: nos cartões, mais vermelhos primeiro; depois menos jogos e menos minutos
          .orderBy(
            asc(totals.rank),
            ...(query.category === 'cards' ? [desc(totals.redCards)] : []),
            asc(totals.appearances),
            asc(totals.minutes),
            sql`${totals.personId}::text`,
          )
          .limit(LEADERS_MAX_ROWS);

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
        // os números vêm da carga diária (sem change feed): o TTL de 1 h basta; a tag da competição cobre o purge manual
        return { body, tags: [`competition:${c.id}`] };
      },
    });
  });
}
