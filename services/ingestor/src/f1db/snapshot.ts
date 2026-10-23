/**
 * Retrato da F1 que já está no core, para o casamento com o F1DB (`matchF1db`): participantes, circuitos e
 * sessões de corrida de **outras fontes** (com a classificação de cada sessão) e os vínculos `f1db` já gravados.
 */
import { sql } from 'drizzle-orm';
import { F1DB_PROVIDER, F1DB_SPORT, type CoreF1Snapshot } from '@galaxie/providers';
import type { Executor } from '../normalize/sql-helpers.js';

export async function loadCoreF1Snapshot(db: Executor): Promise<CoreF1Snapshot> {
  const linked = await db.execute<{ entity_type: string; provider_id: string; entity_id: string }>(sql`
    select entity_type, provider_id, entity_id::text
      from core.provider_map
     where provider = ${F1DB_PROVIDER} and sport = ${F1DB_SPORT}`);
  const byType = (t: string) =>
    new Map(linked.filter((l) => l.entity_type === t).map((l) => [l.provider_id, l.entity_id]));

  const participants = await db.execute<{
    provider_id: string;
    entity_id: string;
    name: string;
    kind: string | null;
    code: string | null;
  }>(sql`
    select pm.provider_id, p.id::text as entity_id, p.name, p.kind, p.code
      from core.provider_map pm
      join core.participant p on p.id = pm.entity_id
     where pm.sport = ${F1DB_SPORT} and pm.entity_type = 'participant' and pm.provider <> ${F1DB_PROVIDER}`);

  const venues = await db.execute<{
    provider_id: string;
    entity_id: string;
    name: string;
    city: string | null;
  }>(sql`
    select pm.provider_id, v.id::text as entity_id, v.name, v.city
      from core.provider_map pm
      join core.venue v on v.id = pm.entity_id
     where pm.sport = ${F1DB_SPORT} and pm.entity_type = 'venue' and pm.provider <> ${F1DB_PROVIDER}`);

  // sessões de corrida de outras fontes, com o GP (fase), o circuito e a classificação
  const events = await db.execute<{
    entity_id: string;
    starts_at: string;
    session_type: string | null;
    stage_label: string | null;
    season_year: number | null;
    venue_provider_id: string | null;
    results:
      { participant_provider_id: string; position: number | null; team_provider_id: string | null }[] | null;
  }>(sql`
    select e.id::text as entity_id, e.starts_at, sd.summary->>'type' as session_type,
           st.provider_label as stage_label, se.year as season_year,
           (select vm.provider_id from core.provider_map vm
             where vm.entity_type = 'venue' and vm.entity_id = e.venue_id and vm.provider = sd.provider
               and vm.sport = e.sport limit 1) as venue_provider_id,
           (select json_agg(json_build_object(
                     'participant_provider_id', pm.provider_id,
                     'position', ep.position,
                     'team_provider_id', ep.result->'team'->>'id'))
              from core.event_participant ep
              join core.provider_map pm on pm.entity_type = 'participant' and pm.entity_id = ep.participant_id
                                       and pm.provider = sd.provider and pm.sport = e.sport
             where ep.event_id = e.id) as results
      from core.event e
      join core.sport_event_detail sd on sd.event_id = e.id and sd.kind = 'race'
      left join core.stage st on st.id = e.stage_id
      left join core.season se on se.id = e.season_id
     where e.sport = ${F1DB_SPORT} and sd.provider <> ${F1DB_PROVIDER}`);

  return {
    participants: participants.map((p) => ({
      providerId: p.provider_id,
      entityId: p.entity_id,
      name: p.name,
      kind: p.kind,
      code: p.code,
    })),
    venues: venues.map((v) => ({
      providerId: v.provider_id,
      entityId: v.entity_id,
      name: v.name,
      city: v.city,
    })),
    events: events.map((e) => ({
      entityId: e.entity_id,
      startsAt: new Date(e.starts_at),
      sessionType: e.session_type,
      stageLabel: e.stage_label,
      seasonYear: e.season_year == null ? null : Number(e.season_year),
      venueProviderId: e.venue_provider_id,
      results: (e.results ?? []).map((r) => ({
        participantProviderId: r.participant_provider_id,
        position: r.position,
        teamProviderId: r.team_provider_id,
      })),
    })),
    linked: { participants: byType('participant'), venues: byType('venue'), events: byType('event') },
  };
}
