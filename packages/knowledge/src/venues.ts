import { sql } from 'drizzle-orm';
import {
  nameKey,
  publishChange,
  type Database,
  type ProviderFormerName,
  type VenueCuration,
} from '@galaxie/db';
import type { StadiumEntry } from './types.js';
import type { Executor } from './derby.js';

/**
 * Reconciliação dos estádios da base semântica com `core.venue` (nome curado vence o fornecedor).
 *
 * Para cada time de futebol com `stadium` no YAML, procura as linhas de `core.venue`:
 * 1. pelo `api_sports_venue_id` (core.provider_map), quando o YAML traz o ID verificado;
 * 2. senão, entre o estádio-sede do participante e os estádios dos jogos em que ele foi mandante,
 *    por nome (atual, apelidos ou nomes anteriores do YAML × nome do fornecedor e nomes anteriores
 *    derivados dos jogos) e cidade.
 * A linha ligada ganha `curated` (nome atual, cidade, apelidos e nomes anteriores); o nome cru do
 * fornecedor continua em `venue.name`. Linhas que deixaram de casar perdem a curadoria.
 */

export interface VenueLinkResult {
  /** Linhas de core.venue com curadoria após a carga. */
  curated: number;
  /** Linhas cuja curadoria mudou (gravada ou removida) nesta carga. */
  changed: number;
  /** Estádio do fornecedor reivindicado por perfis com nomes diferentes (fica o primeiro por slug). */
  conflicts: string[];
}

type ProfileRow = {
  slug: string;
  participant_id: string | null;
  stadium: StadiumEntry;
};

type VenueRow = {
  id: string;
  name: string;
  city: string | null;
  provider_former_names: ProviderFormerName[] | null;
};

/** Listas como parâmetro único (jsonb), para não expandir um parâmetro por item. */
const textList = (xs: string[]) => sql`(select jsonb_array_elements_text(${JSON.stringify(xs)}::jsonb))`;
const uuidList = (xs: string[]) =>
  sql`(select jsonb_array_elements_text(${JSON.stringify(xs)}::jsonb)::uuid)`;

/** Variantes de um nome do fornecedor: inteiro, sem o trecho entre parênteses e o próprio trecho. */
export function nameVariants(name: string): string[] {
  const out = [name];
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
  if (m) out.push(m[1]!, m[2]!);
  const keys = out.map(nameKey).filter(Boolean);
  // "Estádio X" e "X" são o mesmo estádio
  for (const k of [...keys]) if (/^(estadio|stadium|stadion) /.test(k)) keys.push(k.replace(/^\S+ /, ''));
  return [...new Set(keys)];
}

/** Cidade do fornecedor vem como "São Paulo, São Paulo": vale o primeiro trecho. */
const cityKey = (city: string | null | undefined) => (city ? nameKey(city.split(',')[0]!) : null);

/** O estádio do YAML e a linha do fornecedor são o mesmo lugar (nome + cidade)? */
export function stadiumMatches(stadium: StadiumEntry, venue: Omit<VenueRow, 'id'>): boolean {
  const known = new Set(
    [stadium.name, ...(stadium.nicknames ?? []), ...(stadium.former_names ?? []).map((f) => f.name)].flatMap(
      nameVariants,
    ),
  );
  // nomes anteriores derivados do fornecedor só servem de apelido para casar; nunca viram o nome atual
  const provider = [venue.name, ...(venue.provider_former_names ?? []).map((f) => f.name)].flatMap(
    nameVariants,
  );
  if (!provider.some((k) => known.has(k))) return false;
  const a = cityKey(stadium.city);
  const b = cityKey(venue.city);
  return !a || !b || a === b;
}

export function curationOf(
  stadium: StadiumEntry,
  slugs: string[],
  matchedBy: VenueCuration['matched_by'],
): VenueCuration {
  return {
    name: stadium.name,
    city: stadium.city ?? null,
    nicknames: stadium.nicknames ?? [],
    former_names: [...(stadium.former_names ?? [])].sort((a, b) => b.until.localeCompare(a.until)),
    team_slugs: slugs,
    matched_by: matchedBy,
  };
}

export async function linkVenues(tx: Executor | Database): Promise<VenueLinkResult> {
  const profiles = await tx.execute<ProfileRow>(sql`
    select slug, participant_id, stadium
      from semantic.team_profile
     where stadium is not null and source_file like 'data/knowledge/football/%'
     order by slug`);
  const venueIds = [
    ...new Set(
      profiles
        .map((p) => p.stadium.api_sports_venue_id)
        .filter((id): id is number => typeof id === 'number')
        .map(String),
    ),
  ];
  const byProviderId = new Map(
    (
      await tx.execute<{ provider_id: string; entity_id: string }>(sql`
        select provider_id, entity_id from core.provider_map
         where provider = 'api-sports' and sport = 'football' and entity_type = 'venue'
           and provider_id in ${textList(venueIds)}`)
    ).map((r) => [r.provider_id, r.entity_id]),
  );
  const participantIds = profiles.map((p) => p.participant_id).filter((id): id is string => !!id);
  // estádio-sede e estádios dos jogos como mandante
  const homeVenues = await tx.execute<{ participant_id: string; venue_id: string }>(sql`
    select id as participant_id, home_venue_id as venue_id from core.participant
     where id in ${uuidList(participantIds)} and home_venue_id is not null
    union
    select ep.participant_id, e.venue_id from core.event e
      join core.event_participant ep on ep.event_id = e.id and ep.side = 'home'
     where ep.participant_id in ${uuidList(participantIds)} and e.venue_id is not null`);
  const candidates = new Map<string, Set<string>>();
  for (const r of homeVenues) {
    const set = candidates.get(r.participant_id) ?? new Set<string>();
    set.add(r.venue_id);
    candidates.set(r.participant_id, set);
  }
  const allIds = [...new Set([...byProviderId.values(), ...homeVenues.map((r) => r.venue_id)])];
  const venues = new Map(
    (
      await tx.execute<VenueRow>(sql`
        select id, name, city, provider_former_names from core.venue where id in ${uuidList(allIds)}`)
    ).map((v) => [v.id, v]),
  );

  const desired = new Map<string, VenueCuration>();
  const conflicts: string[] = [];
  const claim = (venueId: string, p: ProfileRow, by: VenueCuration['matched_by']) => {
    const prev = desired.get(venueId);
    if (!prev) {
      desired.set(venueId, curationOf(p.stadium, [p.slug], by));
      return;
    }
    if (nameKey(prev.name) !== nameKey(p.stadium.name)) {
      conflicts.push(
        `${venues.get(venueId)?.name ?? venueId}: ${prev.team_slugs.join('/')} (${prev.name}) × ${p.slug} (${p.stadium.name})`,
      );
      return;
    }
    if (!prev.team_slugs.includes(p.slug)) prev.team_slugs.push(p.slug);
    if (by === 'provider_id') prev.matched_by = 'provider_id';
  };
  for (const p of profiles) {
    const id = p.stadium.api_sports_venue_id;
    const viaId = typeof id === 'number' ? byProviderId.get(String(id)) : undefined;
    if (viaId) claim(viaId, p, 'provider_id');
    for (const venueId of p.participant_id ? (candidates.get(p.participant_id) ?? []) : []) {
      if (venueId === viaId) continue;
      const v = venues.get(venueId);
      if (v && stadiumMatches(p.stadium, v)) claim(venueId, p, 'name');
    }
  }

  const rows = [...desired].map(([id, curated]) => ({ id, curated }));
  const written = await tx.execute<{ id: string }>(sql`
    update core.venue v set curated = d.curated, updated_at = now()
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as d(id uuid, curated jsonb)
     where v.id = d.id and v.curated is distinct from d.curated
    returning v.id`);
  const cleared = await tx.execute<{ id: string }>(sql`
    update core.venue set curated = null, updated_at = now()
     where curated is not null and id not in ${uuidList([...desired.keys()])}
    returning id`);
  // purga o cache do estádio e das respostas com eventos/times (o nome aparece nelas)
  for (const { id } of [...written, ...cleared])
    await publishChange(tx, {
      topic: 'catalog',
      entityType: 'venue',
      entityId: id,
      payload: { reason: 'venue_curation', tags: ['event', 'participant', 'team_profile'] },
    });
  return { curated: desired.size, changed: written.length + cleared.length, conflicts };
}
