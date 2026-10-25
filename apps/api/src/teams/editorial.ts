/**
 * Perfil editorial do piloto de F1 (`formula-1/editorial/<locale>.yaml`): a API lê os arquivos, aplica as edições e
 * as decisões do painel de revisão por cima (como no glossário) e serve o idioma pedido acima do piso editorial,
 * caindo `es-XX → es → pt-BR`. Os momentos ganham o evento da base (pelo ano e a rodada: a ordem da corrida na
 * temporada pela data, que vale para o F1DB e para a api-sports) e os rivais, o participante.
 */
import { sql } from 'drizzle-orm';
import type { DriverEditorial } from '@galaxie/contracts';
import type { Database } from '@galaxie/db';
import type { LocatedEditorial } from '@galaxie/knowledge';
import type { ReviewStatus } from '../context.js';
import { UUID_RE } from '../util.js';

const REVIEW_ORDER: readonly ReviewStatus[] = ['draft', 'reviewed', 'approved'];
const meets = (status: string, min: ReviewStatus) =>
  REVIEW_ORDER.indexOf(status as ReviewStatus) >= REVIEW_ORDER.indexOf(min);

/** O perfil do piloto no idioma pedido (exato, o idioma, e o original pt-BR), só acima do piso. */
export function pickEditorial(
  profiles: LocatedEditorial[],
  f1dbId: string,
  locale: string,
  min: ReviewStatus,
): { found: LocatedEditorial | null; below: boolean } {
  const mine = profiles.filter((p) => p.entry.f1db?.id === f1dbId);
  for (const l of [...new Set([locale, locale.split('-')[0]!, 'pt-BR'])]) {
    const p = mine.find((x) => x.locale === l);
    if (p && meets(p.entry.review_status, min)) return { found: p, below: false };
  }
  return { found: null, below: mine.length > 0 };
}

/** Id do piloto no F1DB a partir do UUID do participante ou do slug do perfil (`f1-<id>`). */
export async function driverF1dbId(
  db: Database,
  key: string,
): Promise<{ participantId: string | null; f1dbId: string } | null> {
  if (!UUID_RE.test(key)) {
    if (!key.startsWith('f1-')) return null;
    const f1dbId = key.slice(3);
    const [row] = await db.execute<{ entity_id: string }>(sql`
      select entity_id::text from core.provider_map
       where provider = 'f1db' and entity_type = 'participant' and provider_id = ${`driver-${f1dbId}`}
       limit 1`);
    return { participantId: row?.entity_id ?? null, f1dbId };
  }
  const [row] = await db.execute<{ provider_id: string }>(sql`
    select provider_id from core.provider_map
     where provider = 'f1db' and entity_type = 'participant' and entity_id = ${key}::uuid
       and provider_id like 'driver-%'
     limit 1`);
  return row ? { participantId: key, f1dbId: row.provider_id.slice('driver-'.length) } : null;
}

/** Monta a resposta: eventos dos momentos e participantes dos rivais vêm da base. */
export async function editorialBody(
  db: Database,
  p: LocatedEditorial,
  participantId: string,
  locale: string,
): Promise<DriverEditorial> {
  const e = p.entry;
  const years = [...new Set((e.moments ?? []).map((m) => m.year))];
  const events = years.length
    ? await db.execute<{ year: number; round: number; id: string }>(sql`
        select year, round, (array_agg(id order by f1db desc, id))[1] as id
          from (select se.year, e.id::text as id, sd.summary->>'source' = 'f1db' as f1db,
                       dense_rank() over (partition by se.year order by e.starts_at::date)::int as round
                  from core.event e
                  join core.season se on se.id = e.season_id
                  join core.sport_event_detail sd on sd.event_id = e.id and sd.kind = 'race'
                 where e.sport = 'formula-1' and e.status = 'finished' and lower(sd.summary->>'type') = 'race'
                   and se.year in (${sql.join(
                     years.map((y) => sql`${y}`),
                     sql`, `,
                   )})) races
         group by year, round`)
    : [];
  const eventOf = new Map(events.map((r) => [`${r.year}|${r.round}`, r.id]));
  const rivalIds = [...new Set((e.rivalries ?? []).map((r) => `driver-${r.driver.f1db_id}`))];
  const rivals = rivalIds.length
    ? await db.execute<{ provider_id: string; id: string }>(sql`
        select provider_id, entity_id::text as id from core.provider_map
         where provider = 'f1db' and entity_type = 'participant'
           and provider_id in (${sql.join(
             rivalIds.map((id) => sql`${id}`),
             sql`, `,
           )})`)
    : [];
  const rivalOf = new Map(rivals.map((r) => [r.provider_id.slice('driver-'.length), r.id]));
  return {
    participant_id: participantId,
    slug: e.slug,
    locale,
    text_locale: p.locale,
    tier: e.tier,
    bio: { text: e.bio.text, sources: e.bio.sources },
    style: e.style
      ? {
          kind: e.style.kind as NonNullable<DriverEditorial['style']>['kind'],
          text: e.style.text,
          sources: e.style.sources,
        }
      : null,
    strengths: (e.strengths ?? []).map((s) => ({
      key: s.key as DriverEditorial['strengths'][number]['key'],
      text: s.text,
      source: s.source,
    })),
    moments: (e.moments ?? [])
      .map((m) => ({
        year: m.year,
        race: m.race,
        event_id: eventOf.get(`${m.year}|${m.round}`) ?? null,
        wet: m.wet ?? false,
        text: m.text,
        source: m.source,
      }))
      .sort((a, b) => a.year - b.year),
    rivalries: (e.rivalries ?? []).map((r) => ({
      driver: { id: rivalOf.get(r.driver.f1db_id) ?? null, f1db_id: r.driver.f1db_id, name: r.driver.name },
      text: r.text,
      source: r.source,
    })),
    review_status: e.review_status,
  };
}
