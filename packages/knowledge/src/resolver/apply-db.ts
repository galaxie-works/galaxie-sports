import { sql } from 'drizzle-orm';
import type { Executor } from '../derby.js';
import type { Resolution } from './match.js';

/**
 * Grava no banco as resoluções confiáveis (verified/resolved) cujo participante já existe:
 * - core.provider_map (participant ↔ api-sports team_id), se ainda não houver;
 * - semantic.team_profile.participant_id.
 * Casos ambíguos, conflitos e não encontrados nunca são aplicados.
 */
export async function applyResolutionsToDb(
  db: Executor,
  resolutions: Resolution[],
): Promise<{ providerMap: number; teamProfiles: number }> {
  let providerMap = 0;
  let teamProfiles = 0;
  for (const r of resolutions) {
    if ((r.status !== 'verified' && r.status !== 'resolved') || r.apiId === null) continue;
    let participantId = r.participantId;
    if (!participantId) {
      const rows = await db.execute<{ entity_id: string }>(sql`
        select entity_id from core.provider_map
         where provider = 'api-sports' and sport = 'football' and entity_type = 'participant'
           and provider_id = ${String(r.apiId)}
         limit 1`);
      participantId = rows[0]?.entity_id ?? null;
    }
    if (!participantId) continue;
    const inserted = await db.execute(sql`
      insert into core.provider_map (entity_type, entity_id, provider, sport, provider_id)
      values ('participant', ${participantId}::uuid, 'api-sports', 'football', ${String(r.apiId)})
      on conflict do nothing
      returning provider_id`);
    providerMap += inserted.length;
    const updated = await db.execute(sql`
      update semantic.team_profile
         set participant_id = ${participantId}::uuid, updated_at = now()
       where slug = ${r.slug} and participant_id is distinct from ${participantId}::uuid
      returning slug`);
    teamProfiles += updated.length;
  }
  return { providerMap, teamProfiles };
}
