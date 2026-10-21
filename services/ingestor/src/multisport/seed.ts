import { sql } from 'drizzle-orm';
import { discipline, games, gamesProviderLeague, msSport, noc, sourceRef, type Database } from '@galaxie/db';
import { GAMES_SEED, gamesName, gamesStatus } from './seed/games.js';
import { NOC_SEED } from './seed/nocs.js';
import { PROVIDER_LEAGUE_SEED } from './seed/provider-leagues.js';
import { DISCIPLINE_SEED, SPORT_SEED } from './seed/sports.js';

export interface SeedStats {
  nocs: number;
  games: number;
  sports: number;
  disciplines: number;
  providerLeagues: number;
}

/** Data de hoje (UTC) no formato YYYY-MM-DD — define o status (encerrada, em andamento, futura). */
export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Carrega as tabelas de referência do módulo (CONs, edições, esportes/disciplinas, ligas dos coletivos).
 * Idempotente: pode rodar a cada deploy; atualiza nomes, datas e status.
 */
export async function seedMultisport(db: Database, today = todayUtc()): Promise<SeedStats> {
  return db.transaction(async (tx) => {
    await tx
      .insert(noc)
      .values(
        NOC_SEED.map((n) => ({
          code: n.code,
          iso3: n.iso3,
          iso2: n.iso2,
          name: n.name,
          kind: n.kind,
          iocMember: n.iocMember,
          panamMember: n.panamMember,
          successorCode: n.successorCode ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: noc.code,
        set: {
          iso3: sql`excluded.iso3`,
          iso2: sql`excluded.iso2`,
          // preserva traduções extras já cadastradas (es-AR, es-MX...)
          name: sql`${noc.name} || excluded.name`,
          kind: sql`excluded.kind`,
          iocMember: sql`excluded.ioc_member`,
          panamMember: sql`excluded.panam_member`,
          successorCode: sql`excluded.successor_code`,
          updatedAt: sql`now()`,
        },
      });

    await tx
      .insert(games)
      .values(
        GAMES_SEED.map((g) => ({
          slug: g.slug,
          type: g.type,
          season: g.season,
          year: g.year,
          edition: g.edition,
          name: gamesName(g),
          hostCity: g.hostCity,
          hostNoc: g.hostNoc,
          startDate: g.startDate,
          endDate: g.endDate,
          tz: g.tz,
          status: gamesStatus(g, today),
          wikidataQid: g.wikidataQid,
          notes: g.notes ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: games.slug,
        set: {
          edition: sql`excluded.edition`,
          name: sql`excluded.name`,
          hostCity: sql`excluded.host_city`,
          hostNoc: sql`excluded.host_noc`,
          startDate: sql`excluded.start_date`,
          endDate: sql`excluded.end_date`,
          tz: sql`excluded.tz`,
          status: sql`excluded.status`,
          wikidataQid: sql`excluded.wikidata_qid`,
          notes: sql`excluded.notes`,
          updatedAt: sql`now()`,
        },
      });

    const gamesRows = await tx.select({ id: games.id, qid: games.wikidataQid }).from(games);
    const refs = gamesRows
      .filter((g) => g.qid)
      .map((g) => ({
        entityType: 'games',
        entityId: g.id,
        source: 'wikidata',
        sourceId: g.qid!,
        url: `https://www.wikidata.org/wiki/${g.qid}`,
        license: 'CC0-1.0',
      }));
    if (refs.length) await tx.insert(sourceRef).values(refs).onConflictDoNothing();

    await tx
      .insert(msSport)
      .values(SPORT_SEED)
      .onConflictDoUpdate({ target: msSport.code, set: { name: sql`excluded.name` } });

    await tx
      .insert(discipline)
      .values(
        DISCIPLINE_SEED.map((d) => ({
          code: d.code,
          sportCode: d.sport,
          name: d.name,
          twoBronzes: d.twoBronzes ?? false,
        })),
      )
      .onConflictDoUpdate({
        target: discipline.code,
        set: {
          sportCode: sql`excluded.sport_code`,
          name: sql`excluded.name`,
          twoBronzes: sql`excluded.two_bronzes`,
        },
      });

    await tx
      .insert(gamesProviderLeague)
      .values(
        PROVIDER_LEAGUE_SEED.map((p) => ({
          gamesType: p.gamesType,
          gamesSeason: p.gamesSeason,
          sport: p.sport,
          gender: p.gender,
          provider: 'api-sports',
          providerLeagueId: p.providerLeagueId,
          label: p.label,
          notes: p.notes ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [
          gamesProviderLeague.provider,
          gamesProviderLeague.sport,
          gamesProviderLeague.providerLeagueId,
        ],
        set: {
          gamesType: sql`excluded.games_type`,
          gamesSeason: sql`excluded.games_season`,
          gender: sql`excluded.gender`,
          label: sql`excluded.label`,
          notes: sql`excluded.notes`,
        },
      });

    return {
      nocs: NOC_SEED.length,
      games: GAMES_SEED.length,
      sports: SPORT_SEED.length,
      disciplines: DISCIPLINE_SEED.length,
      providerLeagues: PROVIDER_LEAGUE_SEED.length,
    };
  });
}
