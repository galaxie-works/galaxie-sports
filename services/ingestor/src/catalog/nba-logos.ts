/**
 * Logos da NBA v2: times e ligas apontam para a Wikimedia (licença própria), que não entra no Asset Mirror.
 * Os mesmos times e ligas existem no api-basketball, com logo na CDN da api-sports já espelhado: o time (ou a
 * liga) da NBA v2 sem logo passa a usar o asset do correspondente do basquete. Nenhum download, nenhuma
 * chamada ao fornecedor. Roda depois do catálogo (que regrava `logo_asset_id`) e da normalização da NBA.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { competition, event, eventParticipant, participant, providerMap, type Database } from '@galaxie/db';

/** Liga da NBA v2 (texto) → ID da mesma liga no api-basketball. */
export const NBA_BASKETBALL_LEAGUES: Readonly<Record<string, string>> = {
  standard: '12',
  vegas: '17',
  utah: '19',
  sacramento: '21',
  orlando: '176',
};

/** Nomes que diferem entre as duas APIs (NBA v2 → api-basketball). */
const NAME_ALIASES: Readonly<Record<string, string>> = { 'la clippers': 'los angeles clippers' };

export function teamKey(name: string): string {
  const key = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return NAME_ALIASES[key] ?? key;
}

export interface BasketballTeam {
  name: string;
  logoAssetId: string;
  /** Jogou a NBA no api-basketball: desempata nomes repetidos (ex.: time feminino ou de base homônimo). */
  inNba: boolean;
}

/** Time da NBA v2 → asset do time homônimo do basquete; nome ambíguo sem desempate fica sem logo. */
export function matchNbaLogos(
  nbaTeams: readonly { id: string; name: string }[],
  basketball: readonly BasketballTeam[],
): Map<string, string> {
  const byKey = new Map<string, BasketballTeam[]>();
  for (const t of basketball) byKey.set(teamKey(t.name), [...(byKey.get(teamKey(t.name)) ?? []), t]);
  const out = new Map<string, string>();
  for (const t of nbaTeams) {
    const candidates = byKey.get(teamKey(t.name)) ?? [];
    const nba = candidates.filter((c) => c.inNba);
    const pick = candidates.length === 1 ? candidates[0] : nba.length === 1 ? nba[0] : undefined;
    if (pick) out.set(t.id, pick.logoAssetId);
  }
  return out;
}

/** Competições mapeadas de uma API (ID do fornecedor → ID do core). */
async function mappedCompetitions(db: Database, sport: string, providerIds: readonly string[]) {
  const rows = await db
    .select({ providerId: providerMap.providerId, entityId: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.provider, 'api-sports'),
        eq(providerMap.sport, sport),
        eq(providerMap.entityType, 'competition'),
        inArray(providerMap.providerId, [...providerIds]),
      ),
    );
  return new Map(rows.map((r) => [r.providerId, r.entityId]));
}

export interface NbaLogosReport {
  participants: number;
  competitions: number;
}

export async function linkNbaLogos(db: Database): Promise<NbaLogosReport> {
  const nbaComps = await mappedCompetitions(db, 'nba', Object.keys(NBA_BASKETBALL_LEAGUES));
  const bbById = await mappedCompetitions(db, 'basketball', Object.values(NBA_BASKETBALL_LEAGUES));

  let competitions = 0;
  for (const [key, entityId] of nbaComps) {
    const source = bbById.get(NBA_BASKETBALL_LEAGUES[key]!);
    if (!source) continue;
    const [logo] = await db
      .select({ id: competition.logoAssetId })
      .from(competition)
      .where(and(eq(competition.id, source), isNotNull(competition.logoAssetId)));
    if (!logo?.id) continue;
    const done = await db
      .update(competition)
      .set({ logoAssetId: logo.id, updatedAt: sql`now()` })
      .where(and(eq(competition.id, entityId), isNull(competition.logoAssetId)))
      .returning({ id: competition.id });
    competitions += done.length;
  }

  const nbaTeams = await db
    .select({ id: participant.id, name: participant.name })
    .from(participant)
    .where(and(eq(participant.sport, 'nba'), isNull(participant.logoAssetId)));
  if (!nbaTeams.length) return { participants: 0, competitions };
  const bbNba = bbById.get(NBA_BASKETBALL_LEAGUES.standard!);
  const inNba = bbNba
    ? new Set(
        (
          await db
            .selectDistinct({ id: eventParticipant.participantId })
            .from(eventParticipant)
            .innerJoin(event, eq(event.id, eventParticipant.eventId))
            .where(eq(event.competitionId, bbNba))
        ).map((r) => r.id),
      )
    : new Set<string>();
  const basketball = await db
    .select({ id: participant.id, name: participant.name, logoAssetId: participant.logoAssetId })
    .from(participant)
    .where(and(eq(participant.sport, 'basketball'), isNotNull(participant.logoAssetId)));
  const matches = matchNbaLogos(
    nbaTeams,
    basketball.map((t) => ({ name: t.name, logoAssetId: t.logoAssetId!, inNba: inNba.has(t.id) })),
  );
  let participants = 0;
  for (const [id, logoAssetId] of matches) {
    const done = await db
      .update(participant)
      .set({ logoAssetId, updatedAt: sql`now()` })
      .where(and(eq(participant.id, id), isNull(participant.logoAssetId)))
      .returning({ id: participant.id });
    participants += done.length;
  }
  return { participants, competitions };
}
