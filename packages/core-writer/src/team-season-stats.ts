/**
 * Estatísticas do time na temporada (`core.team_season_stat`, #893): a resposta nova substitui a linha inteira
 * (é o agregado da temporada), mas só quando foi coletada depois da gravada — o reprocessamento de um raw antigo
 * nunca volta os números. Linha igual não é tocada (nem `updated_at`).
 */
import { sql } from 'drizzle-orm';
import { teamSeasonStat } from '@galaxie/db';
import type { NormalizedBatch, SeasonRef } from '@galaxie/providers';
import { chunks, dedupeBy, replaceUpdate, type Tx } from './sql-helpers.js';

const VALUE_KEYS = [
  'played',
  'won',
  'drawn',
  'lost',
  'goalsFor',
  'goalsAgainst',
  'cleanSheets',
  'failedToScore',
  'form',
  'stats',
] as const;

export async function upsertTeamSeasonStats(
  tx: Tx,
  batch: NormalizedBatch,
  refs: {
    participantId: (pid: string | null) => string | null;
    seasonId: (ref: SeasonRef | null) => string | null;
  },
): Promise<number> {
  const rows = dedupeBy(
    batch.teamSeasonStats.flatMap((r) => {
      const participantId = refs.participantId(r.participantId);
      const seasonId = refs.seasonId(r.season);
      if (!participantId || !seasonId) return [];
      const { participantId: _p, season: _s, stats, ...values } = r;
      return [
        {
          participantId,
          seasonId,
          ...values,
          stats: stats as unknown as Record<string, unknown>,
          observedAt: batch.observedAt,
        },
      ];
    }),
    (r) => `${r.participantId}|${r.seasonId}`,
  );
  for (const chunk of chunks(rows, 500)) {
    // `changed`: algum número mudou; sem mudança, uma coleta mais nova só avança `observed_at` (a data do dado)
    const { set, setWhere: changed } = replaceUpdate(teamSeasonStat, VALUE_KEYS);
    await tx
      .insert(teamSeasonStat)
      .values(chunk)
      .onConflictDoUpdate({
        target: [teamSeasonStat.participantId, teamSeasonStat.seasonId],
        set: {
          ...set,
          observedAt: sql`greatest(${teamSeasonStat.observedAt}, excluded.observed_at)`,
          updatedAt: sql`case when ${changed} then now() else ${teamSeasonStat.updatedAt} end`,
        },
        setWhere: sql`excluded.observed_at >= ${teamSeasonStat.observedAt}
          and ((${changed}) or excluded.observed_at > ${teamSeasonStat.observedAt})`,
      });
  }
  return rows.length;
}
