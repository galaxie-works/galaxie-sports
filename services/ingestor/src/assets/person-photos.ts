import { sql, type SQL } from 'drizzle-orm';
import type { MediaAssetKind } from '@galaxie/apisports-client';
import type { Database } from '@galaxie/db';

/** Kinds de core.asset que são foto de pessoa (o placeholder vira "sem foto" e a pessoa é desvinculada). */
export const PERSON_PHOTO_KINDS: ReadonlySet<string> = new Set<MediaAssetKind>(['player', 'coach']);

/**
 * Imagens genéricas que a CDN de mídia devolve com 200 quando a pessoa não tem foto. Medido na CDN em
 * 22/10/2026: cerca de 60% dos escalados sem foto registrada caem na silhueta.
 */
export const PLACEHOLDER_PHOTO_SHA256: ReadonlySet<string> = new Set([
  '2ff7d52a628fce5d954c58480dde4e47396db4bb405b7b7d6a6567134bf86422', // silhueta cinza no círculo (jogadores)
  '575e4487e3942dd820fe682e8b81f9c59b0b0d60265433ce5bd1884db4004035', // silhueta "NO PHOTO YET" (técnicos)
  'b602abdd01273f6dd29855a6aed585747243148768da4a5a54e3cebd9989fd36', // escudo-contorno cinza (técnicos)
]);

export function isPlaceholderPhoto(
  kind: string,
  sha256: string,
  placeholders: ReadonlySet<string> = PLACEHOLDER_PHOTO_SHA256,
): boolean {
  return PERSON_PHOTO_KINDS.has(kind) && placeholders.has(sha256);
}

/** URL da foto de jogador na CDN de mídia: vem do id, não da API de dados (não gasta cota). */
export function playerPhotoUrl(providerId: string): string {
  return `https://media.api-sports.io/football/players/${providerId}.png`;
}

/** URL da foto de técnico na CDN de mídia (id da api-sports, sem o prefixo `coach:`). */
export function coachPhotoUrl(providerId: string): string {
  return `https://media.api-sports.io/football/coachs/${providerId}.png`;
}

/**
 * Prioridade de cada pessoa do futebol (api-sports), para registrar e espelhar as fotos na ordem em que
 * aparecem na demo: 0 = escalada desde `since`; 1 = no elenco de uma temporada atual; 2 = o resto.
 * `last_at` é o último jogo em que entrou em campo (o técnico, o último em que foi o técnico da escalação).
 * Técnicos têm o id `coach:<id>` em core.provider_map (`coachPersonId`); os demais ids numéricos são jogadores.
 */
function personPriority(since: Date): SQL {
  return sql`
    with lineup as materialized (
      select p->'player'->>'id' as provider_id, max(e.starts_at) as last_at
      from core.football_fixture f
      join core.event e on e.id = f.event_id,
        lateral jsonb_array_elements(
          case when jsonb_typeof(f.detail->'lineups') = 'array' then f.detail->'lineups' else '[]'::jsonb end
        ) l,
        lateral jsonb_array_elements(coalesce(l->'startXI', '[]'::jsonb) || coalesce(l->'substitutes', '[]'::jsonb)) p
      where f.detail is not null and p->'player'->>'id' is not null
      group by 1
    ),
    lineup_coach as materialized (
      select 'coach:' || (l->'coach'->>'id') as provider_id, max(e.starts_at) as last_at
      from core.football_fixture f
      join core.event e on e.id = f.event_id,
        lateral jsonb_array_elements(
          case when jsonb_typeof(f.detail->'lineups') = 'array' then f.detail->'lineups' else '[]'::jsonb end
        ) l
      where f.detail is not null and l->'coach'->>'id' is not null
      group by 1
    ),
    current_roster as materialized (
      select distinct r.person_id
      from core.roster r
      join core.season s on s.id = r.season_id
      where s.current
    ),
    priority as (
      select m.entity_id as person_id, m.provider_id, coalesce(lu.last_at, lc.last_at) as last_at,
        case
          when coalesce(lu.last_at, lc.last_at) >= ${since.toISOString()}::timestamptz then 0
          when cr.person_id is not null then 1
          else 2
        end as tier
      from core.provider_map m
      left join lineup lu on lu.provider_id = m.provider_id
      left join lineup_coach lc on lc.provider_id = m.provider_id
      left join current_roster cr on cr.person_id = m.entity_id
      where m.provider = 'api-sports' and m.sport = 'football' and m.entity_type = 'person'
    )`;
}

export interface PhotoRegistrationReport {
  /** Pessoas sem foto que receberam a URL do id (jogador ou técnico), por prioridade (0, 1, 2). */
  linked: [number, number, number];
  /** Assets novos em core.asset. */
  registered: number;
  /** Pessoas cuja URL já tinha sido baixada e deu placeholder ou 404: continuam sem foto. */
  skippedMissing: number;
}

/**
 * Registra a foto das pessoas do futebol que ainda não têm uma, a partir do id da api-sports, e liga a pessoa
 * ao asset: `football/players/{id}.png` para jogadores (inclusive quem só aparece em transferências) e
 * `football/coachs/{id}.png` para técnicos (`coach:<id>`). Não liga asset já marcado como ausente (404 ou
 * foto genérica). Idempotente: a segunda execução não registra nem liga nada.
 */
export async function registerPlayerPhotos(
  db: Database,
  options: { since: Date },
): Promise<PhotoRegistrationReport> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      create temp table photo_candidate on commit drop as
      ${personPriority(options.since)}
      select pr.person_id, pr.tier,
        case when pr.provider_id like 'coach:%' then 'coach' else 'player' end::core.asset_kind as kind,
        case when pr.provider_id like 'coach:%'
          then 'https://media.api-sports.io/football/coachs/' || substr(pr.provider_id, 7) || '.png'
          else 'https://media.api-sports.io/football/players/' || pr.provider_id || '.png'
        end as url
      from priority pr
      join core.person p on p.id = pr.person_id
      where p.photo_asset_id is null and pr.provider_id ~ '^(coach:)?[0-9]+$'
    `);
    const registered = await tx.execute<{ id: string }>(sql`
      insert into core.asset (kind, source_url)
      select distinct kind, url from photo_candidate
      on conflict (source_url) do nothing
      returning id
    `);
    const linked = await tx.execute<{ tier: number; n: number }>(sql`
      with done as (
        update core.person p set photo_asset_id = a.id, updated_at = now()
        from photo_candidate c
        join core.asset a on a.source_url = c.url
        where p.id = c.person_id and not (a.storage_key is null and a.fetched_at is not null)
        returning c.tier
      )
      select tier, count(*)::int as n from done group by 1
    `);
    const [skipped] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n
      from photo_candidate c
      join core.asset a on a.source_url = c.url
      where a.storage_key is null and a.fetched_at is not null
    `);
    const byTier: [number, number, number] = [0, 0, 0];
    for (const r of linked) byTier[r.tier as 0 | 1 | 2] = r.n;
    return { linked: byTier, registered: registered.length, skippedMissing: skipped?.n ?? 0 };
  });
}

/**
 * Ids das fotos de pessoas pendentes de espelho, na ordem de prioridade das pessoas ligadas a elas
 * (escalados recentes primeiro, do jogo mais recente para o mais antigo; depois elencos atuais; depois o resto).
 */
export async function pendingPersonPhotoIds(
  db: Database,
  options: { since: Date; includeMissing?: boolean | undefined; limit?: number | undefined },
): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    ${personPriority(options.since)}
    select a.id
    from core.asset a
    left join core.person p on p.photo_asset_id = a.id
    left join priority pr on pr.person_id = p.id
    where a.kind in ('player', 'coach') and a.storage_key is null
      ${options.includeMissing ? sql`` : sql`and a.fetched_at is null`}
    group by a.id, a.created_at
    order by min(coalesce(pr.tier, 3)), max(pr.last_at) desc nulls last, a.created_at, a.id
    ${options.limit ? sql`limit ${options.limit}` : sql``}
  `);
  return rows.map((r) => r.id);
}
