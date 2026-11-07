import { normalizeParams, PgRawStore, requestHash, type Envelope } from '@galaxie/apisports-client';
import type { Database } from '@galaxie/db';
import { sql } from 'drizzle-orm';
import type { SportCatalogCompetition } from '../catalog/catalog-config.js';
import { SPORT_PROFILES, type ReferenceResponses } from '../catalog/sport-catalog.js';
import type { OtherSport, SportGame, SportMirrorSource, SportSeason } from './mirror-job.js';

const NUMERIC = /^\d+$/;

/**
 * Fonte do espelho dos outros 11 esportes sobre o Postgres: temporadas pela referência já no raw (a mesma montagem
 * do bootstrap:sports, com a chave da temporada do fornecedor) e jogos/times pelo core (provider_map da api-sports).
 */
export class PgSportMirrorSource implements SportMirrorSource {
  constructor(
    private readonly db: Database,
    private readonly catalogOf: (sport: OtherSport) => Promise<SportCatalogCompetition[]>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async seasons(sport: OtherSport): Promise<SportSeason[]> {
    const profile = SPORT_PROFILES[sport];
    const store = new PgRawStore(this.db);
    const responses: ReferenceResponses = new Map();
    for (const endpoint of profile.reference) {
      const hash = requestHash('api-sports', sport, endpoint, normalizeParams({}));
      const any = await store.findFresh(hash, Number.POSITIVE_INFINITY, this.now(), {
        provider: 'api-sports',
        sport,
        endpoint,
      });
      if (any) responses.set(endpoint, (any.body as Envelope).response);
    }
    // sem a referência no raw (esporte nunca carregado): o grupo de referência do espelho a busca primeiro
    if (!profile.required.every((e) => responses.has(e))) return [];
    const rows = profile.build(responses, { catalog: await this.catalogOf(sport), today: this.now() });
    return rows.competitions.flatMap((c) =>
      c.seasons.map((s) => ({
        league: c.providerId,
        tier: c.tier,
        year: s.year,
        key: s.providerKey ?? String(s.year),
        current: s.current,
        startDate: s.startDate,
        endDate: s.endDate,
      })),
    );
  }

  async games(sport: OtherSport, from: Date, to: Date, maxTier: number): Promise<SportGame[]> {
    const rows = await this.db.execute<{
      id: string;
      league: string;
      year: number;
      tier: number;
      status: string;
      starts_at: string | Date;
    }>(sql`
      select pe.provider_id as id, pc.provider_id as league, s.year, c.tier, e.status::text as status, e.starts_at
      from core.event e
      join core.competition c on c.id = e.competition_id
      join core.season s on s.id = e.season_id
      join core.provider_map pe on pe.entity_type = 'event' and pe.entity_id = e.id
        and pe.provider = 'api-sports' and pe.sport = e.sport
      join core.provider_map pc on pc.entity_type = 'competition' and pc.entity_id = c.id
        and pc.provider = 'api-sports' and pc.sport = e.sport
      where e.sport = ${sport} and e.is_provisional = false and c.tier <= ${maxTier}
        -- encerrado pelo relógio (status_source = temporal) ainda não tem dado do fornecedor para buscar
        and (e.status <> 'finished' or e.status_source = 'provider')
        and e.starts_at >= ${from.toISOString()}::timestamptz and e.starts_at < ${to.toISOString()}::timestamptz
      order by e.starts_at, pe.provider_id`);
    return rows
      .filter((r) => NUMERIC.test(r.id))
      .map((r) => ({
        id: r.id,
        league: r.league,
        year: Number(r.year),
        tier: Number(r.tier),
        status: r.status,
        startsAt: new Date(r.starts_at),
      }));
  }

  async teams(sport: OtherSport, league: string, year: number): Promise<string[]> {
    const rows = await this.db.execute<{ id: string }>(sql`
      select distinct pp.provider_id as id
      from core.event e
      join core.season s on s.id = e.season_id and s.year = ${year}
      join core.provider_map pc on pc.entity_type = 'competition' and pc.entity_id = e.competition_id
        and pc.provider = 'api-sports' and pc.sport = e.sport and pc.provider_id = ${league}
      join core.event_participant ep on ep.event_id = e.id
      join core.provider_map pp on pp.entity_type = 'participant' and pp.entity_id = ep.participant_id
        and pp.provider = 'api-sports' and pp.sport = e.sport
      where e.sport = ${sport}
      order by 1`);
    return rows.map((r) => r.id).filter((id) => /^\d+$/.test(id));
  }

  async participants(sport: OtherSport, from: Date, to: Date, years: readonly number[]): Promise<string[]> {
    if (years.length === 0) return [];
    const rows = await this.db.execute<{ id: string }>(sql`
      select distinct pp.provider_id as id
      from core.event e
      join core.season s on s.id = e.season_id and s.year in (${sql.join(
        years.map((y) => sql`${y}`),
        sql`, `,
      )})
      join core.event_participant ep on ep.event_id = e.id
      join core.provider_map pp on pp.entity_type = 'participant' and pp.entity_id = ep.participant_id
        and pp.provider = 'api-sports' and pp.sport = e.sport
      where e.sport = ${sport}
        and e.starts_at >= ${from.toISOString()}::timestamptz and e.starts_at < ${to.toISOString()}::timestamptz
      order by 1`);
    return rows.map((r) => r.id).filter((id) => /^\d+$/.test(id));
  }
}
