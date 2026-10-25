import { and, eq, inArray, sql } from 'drizzle-orm';
import type { TeamCompetition } from '@galaxie/contracts';
import {
  asset,
  competition,
  competitionProfile,
  event,
  eventParticipant,
  participant,
  season,
  stage,
  standing,
} from '@galaxie/db';
import { loadStageMatches, type BuildContext } from '../events/builder.js';
import { pickText } from '../i18n.js';
import { competitionLogoId, teamLogoId } from '../assets/custom-logos.js';
import { assetUrl } from '../util.js';
import { competitionProfileJoin } from '../competitions/profile.js';
import {
  computeCampaign,
  isOngoing,
  TIE_KINDS,
  type CampaignMatch,
  type CampaignStanding,
} from './campaign.js';
import { campaignText } from './campaign-text.js';
import { loadTeamNames } from './display-name.js';

/** Temporadas não atuais entram se o time jogou nelas nos últimos 12 meses. */
const RECENT_MS = 365 * 24 * 3600_000;

/** Linha da tabela preferida: o grupo do time, não a classificação geral ("Overall"). */
function pickStanding(rows: (CampaignStanding & { seasonId: string })[]): CampaignStanding | null {
  const row = rows.find((r) => !/overall/i.test(r.group ?? '')) ?? rows[0];
  return row ? { rank: row.rank, points: row.points, played: row.played, group: row.group } : null;
}

/**
 * Campanha do time em cada competição (temporada atual ou a mais recente), inclusive copas sem
 * tabela, para o overview do time. Ordem: em disputa primeiro; depois a atividade mais recente.
 * Com `year`, a campanha de cada competição na temporada daquele ano (`season.year`), por mais antiga.
 */
export async function loadTeamCompetitions(
  bctx: BuildContext,
  teamId: string,
  year?: number,
): Promise<TeamCompetition[]> {
  const { db, locale } = bctx;

  // 1. temporadas com jogos ou tabela do time
  const [activity, standingSeasons] = await Promise.all([
    db
      .select({
        seasonId: event.seasonId,
        last: sql<number>`extract(epoch from max(${event.startsAt}))::float8`.mapWith(Number),
        lastPlayed: sql<number | null>`extract(epoch from max(${event.startsAt})
          filter (where ${event.status} = 'finished'))::float8`,
      })
      .from(event)
      .innerJoin(eventParticipant, eq(eventParticipant.eventId, event.id))
      .where(eq(eventParticipant.participantId, teamId))
      .groupBy(event.seasonId),
    db
      .selectDistinct({ seasonId: standing.seasonId })
      .from(standing)
      .where(eq(standing.participantId, teamId)),
  ]);
  const lastBy = new Map<string, number>();
  for (const a of activity) {
    if (a.seasonId) lastBy.set(a.seasonId, Number(a.lastPlayed ?? a.last) * 1000);
  }
  const candidateIds = [...new Set([...lastBy.keys(), ...standingSeasons.map((s) => s.seasonId)])];
  if (!candidateIds.length) return [];
  const seasonRows = await db
    .select({
      s: {
        id: season.id,
        year: season.year,
        label: season.label,
        current: season.current,
        endDate: season.endDate,
      },
      c: {
        id: competition.id,
        slug: competition.slug,
        name: competition.name,
        labels: competition.labels,
        type: competition.type,
        tier: competition.tier,
      },
      profileLabels: competitionProfile.labels,
      logoKey: asset.storageKey,
      logoUrl: asset.sourceUrl,
    })
    .from(season)
    .innerJoin(competition, eq(competition.id, season.competitionId))
    .leftJoin(competitionProfile, competitionProfileJoin(bctx.minReview ?? 'approved'))
    .leftJoin(asset, eq(asset.id, competitionLogoId(bctx.customLogos)))
    .where(and(inArray(season.id, candidateIds), year === undefined ? undefined : eq(season.year, year)));

  // por competição: a temporada atual ou, sem ela, a mais recente; antigas (sem jogo há 12 meses) saem.
  // Com `year` só sobra uma temporada por competição (única por ano) e nenhuma sai por ser antiga.
  const byCompetition = new Map<string, (typeof seasonRows)[number]>();
  for (const r of seasonRows) {
    const cur = byCompetition.get(r.c.id);
    if (
      !cur ||
      Number(r.s.current) - Number(cur.s.current) > 0 ||
      (r.s.current === cur.s.current && r.s.year > cur.s.year)
    )
      byCompetition.set(r.c.id, r);
  }
  const cutoff = bctx.now.getTime() - RECENT_MS;
  const selected = [...byCompetition.values()].filter(
    (r) => year !== undefined || r.s.current || (lastBy.get(r.s.id) ?? 0) >= cutoff,
  );
  if (!selected.length) return [];
  const seasonIds = selected.map((r) => r.s.id);

  // 2. fases, jogos do time, tabela e jogos pendentes da temporada
  const [stages, teamEvents, tables, openRows] = await Promise.all([
    db
      .select({
        id: stage.id,
        seasonId: stage.seasonId,
        kind: stage.kind,
        order: stage.order,
        name: stage.name,
        providerLabel: stage.providerLabel,
      })
      .from(stage)
      .where(inArray(stage.seasonId, seasonIds)),
    db
      .select({ id: event.id, seasonId: event.seasonId, stageId: event.stageId, status: event.status })
      .from(event)
      .innerJoin(eventParticipant, eq(eventParticipant.eventId, event.id))
      .where(and(eq(eventParticipant.participantId, teamId), inArray(event.seasonId, seasonIds))),
    db
      .select({
        seasonId: standing.seasonId,
        group: standing.group,
        rank: standing.rank,
        points: standing.points,
        played: standing.played,
      })
      .from(standing)
      .where(and(eq(standing.participantId, teamId), inArray(standing.seasonId, seasonIds))),
    db
      .selectDistinct({ seasonId: event.seasonId })
      .from(event)
      .where(
        and(
          inArray(event.seasonId, seasonIds),
          sql`${event.status} not in ('finished', 'cancelled', 'abandoned')`,
        ),
      ),
  ]);
  // em aberto: com jogo por disputar ou com o calendário ainda por terminar (o F1DB só cria a sessão disputada, mas
  // fecha a temporada no último GP previsto): a liderança de uma temporada em andamento não é "terminou em"
  const today = bctx.now.toISOString().slice(0, 10);
  const openSeasons = new Set([
    ...openRows.map((r) => r.seasonId),
    ...selected.filter((r) => r.s.endDate != null && r.s.endDate >= today).map((r) => r.s.id),
  ]);

  // 3. confrontos: jogos das fases de mata-mata disputadas pelo time e os vencedores do fornecedor
  const stageKind = new Map(stages.map((s) => [s.id, s.kind]));
  const tieStageIds = [
    ...new Set(
      teamEvents
        .map((e) => e.stageId)
        .filter((id): id is string => !!id && TIE_KINDS.has(stageKind.get(id) ?? '')),
    ),
  ];
  const stageMatches = await loadStageMatches(db, tieStageIds);
  const teamMatchIds = stageMatches
    .filter((m) => m.homeId === teamId || m.awayId === teamId)
    .map((m) => m.id);
  const winners = teamMatchIds.length
    ? await db
        .select({ eventId: eventParticipant.eventId, participantId: eventParticipant.participantId })
        .from(eventParticipant)
        .where(
          and(
            inArray(eventParticipant.eventId, teamMatchIds),
            sql`(${eventParticipant.result} ->> 'winner') = 'true'`,
          ),
        )
    : [];
  const winnersBy = new Map<string, string[]>();
  for (const w of winners) winnersBy.set(w.eventId, [...(winnersBy.get(w.eventId) ?? []), w.participantId]);
  const tieMatches: CampaignMatch[] = stageMatches.map((m) => ({
    ...m,
    winnerIds: winnersBy.get(m.id) ?? [],
  }));

  // 4. campanha por temporada
  const computed = await Promise.all(
    selected.map(async (r) => {
      const seasonStages = stages.filter((s) => s.seasonId === r.s.id);
      const ids = new Set(seasonStages.map((s) => s.id));
      const campaign = computeCampaign({
        teamId,
        stages: seasonStages,
        teamEvents: teamEvents.filter((e) => e.seasonId === r.s.id),
        tieMatches: tieMatches.filter((m) => ids.has(m.stageId)),
        standing: pickStanding(tables.filter((t) => t.seasonId === r.s.id)),
        seasonOpen: openSeasons.has(r.s.id),
        rules: await bctx.rules.get(r.c.slug, r.s.year),
        competitionType: r.c.type,
      });
      return campaign ? { r, campaign } : null;
    }),
  );
  const rows = computed.filter((x) => x !== null);

  // 5. adversários (nome no rótulo e referência)
  const opponentIds = [
    ...new Set(rows.map((x) => x.campaign.tie?.opponentId).filter((x) => !!x)),
  ] as string[];
  const opponents = opponentIds.length
    ? await db
        .select({
          id: participant.id,
          name: participant.name,
          shortName: participant.shortName,
          logoKey: asset.storageKey,
          logoUrl: asset.sourceUrl,
        })
        .from(participant)
        .leftJoin(asset, eq(asset.id, teamLogoId(bctx.customLogos)))
        .where(inArray(participant.id, opponentIds))
    : [];
  const names = await loadTeamNames(db, opponentIds, {
    locale,
    minReview: bctx.minReview ?? 'approved',
  });
  const opponentBy = new Map(opponents.map((o) => [o.id, { ...o, ...names.of(o.id, o.name) }]));

  return rows
    .map(({ r, campaign: c }) => {
      const opp = c.tie ? opponentBy.get(c.tie.opponentId) : undefined;
      const text = campaignText(c, locale, opp?.name ?? null);
      const labels = { ...(r.c.labels ?? {}), ...(r.profileLabels ?? {}) } as Record<string, string>;
      const decided = c.tie && (c.tie.state === 'won' || c.tie.state === 'lost') ? c.tie.lastEventId : null;
      const entry: TeamCompetition = {
        competition: {
          id: r.c.id,
          slug: r.c.slug,
          name: pickText(labels, locale, r.c.name)!,
          logo: assetUrl(bctx.assetsBaseUrl, r.logoKey, r.logoUrl),
        },
        season: { year: r.s.year, label: r.s.label },
        group: c.group || null,
        campaign: {
          status: c.status,
          stage_kind: c.stageKind,
          label: { [locale]: text.label },
          detail: text.detail ? { [locale]: text.detail } : null,
          rank: c.rank,
          points: c.points,
          opponent: opp
            ? {
                id: opp.id,
                name: opp.name,
                provider_name: opp.provider_name,
                short_name: opp.shortName,
                logo: assetUrl(bctx.assetsBaseUrl, opp.logoKey, opp.logoUrl),
              }
            : null,
          decided_by_event_id: decided,
          ongoing: isOngoing(c),
        },
      };
      return { entry, last: lastBy.get(r.s.id) ?? 0, tier: r.c.tier };
    })
    .sort(
      (a, b) =>
        Number(b.entry.campaign.ongoing) - Number(a.entry.campaign.ongoing) ||
        b.last - a.last ||
        a.tier - b.tier,
    )
    .map((x) => x.entry);
}
