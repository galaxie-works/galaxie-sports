import { sql } from 'drizzle-orm';
import {
  decodeEntities,
  nameKey,
  publishChange,
  sameName,
  type Database,
  type ProviderFormerName,
} from '@galaxie/db';

export { sameName };

/**
 * Nomes anteriores derivados do fornecedor. A api-sports não tem campo de nome antigo, mas cada
 * partida guarda o nome do estádio e dos times como estavam no dia (`core.football_fixture.summary`).
 * Por estádio/time, os nomes distintos com a primeira e a última data vistas formam o histórico.
 *
 * Regras (conservadoras — na dúvida, fica de fora e entra na contagem de ambíguos):
 * - variações de grafia não são troca de nome: caixa, acentos e pontuação ("Vasco DA Gama"),
 *   palavras genéricas ("Estádio Nilton Santos" × "Estadio Olimpico Nilton Santos") e letras
 *   adjacentes trocadas ("LSK-Hallen" × "LKS-Hallen");
 * - troca de nome só com períodos sucessivos, sem sobreposição: o mesmo ID não pode alternar entre os
 *   nomes (há IDs reaproveitados para estádios diferentes no fornecedor);
 * - o ID 0 do fornecedor (≈ "estádio não informado") nunca chega ao core (a normalização ignora).
 * A curadoria da base semântica (`core.venue.curated`) sempre vence o que vem daqui.
 */

export interface NameObservation {
  name: string;
  /** Cidade informada na partida (estádios): troca de nome exige a mesma cidade. */
  city?: string | null;
  first: Date;
  last: Date;
  count: number;
}

export interface NamePeriod {
  /** Grafia mais recente do grupo. */
  name: string;
  /** Chave da cidade mais frequente do período (null = não informada). */
  city: string | null;
  first: Date;
  last: Date;
  count: number;
}

export type NameHistory =
  | { status: 'single'; current: NamePeriod }
  | { status: 'renamed'; current: NamePeriod; former: NamePeriod[] }
  | { status: 'ambiguous'; periods: NamePeriod[] };

/** Nome visto em menos jogos que isso é ruído (estádio provisório, erro pontual do fornecedor). */
export const MIN_GAMES_PER_NAME = 2;

const cityKey = (city: string | null | undefined) => (city ? nameKey(city.split(',')[0]!) || null : null);

/** Junta as grafias de um mesmo nome e decide se há troca de nome aceitável. */
export function deriveNameHistory(observations: readonly NameObservation[]): NameHistory | null {
  // nomes com caractere perdido na codificação ("Arena Na?ionala") não são confiáveis
  const obs = observations
    .filter((o) => o.name.trim() && !/[?\uFFFD]/u.test(o.name))
    .map((o) => ({ ...o, name: decodeEntities(o.name).trim() }));
  if (!obs.length) return null;
  // grupos de grafias (união transitiva)
  const parent = obs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < obs.length; i++)
    for (let j = i + 1; j < obs.length; j++)
      if (sameName(obs[i]!.name, obs[j]!.name, obs[i]!.city ?? obs[j]!.city)) parent[find(i)] = find(j);
  const groups = new Map<number, NameObservation[]>();
  obs.forEach((o, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), o]));
  const periods: NamePeriod[] = [...groups.values()]
    .map((list) => {
      const latest = list.reduce((a, b) =>
        b.last > a.last || (+b.last === +a.last && b.count > a.count) ? b : a,
      );
      const cities = new Map<string, number>();
      for (const o of list) {
        const c = cityKey(o.city);
        if (c) cities.set(c, (cities.get(c) ?? 0) + o.count);
      }
      return {
        name: latest.name,
        city: [...cities].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        first: new Date(Math.min(...list.map((o) => +o.first))),
        last: new Date(Math.max(...list.map((o) => +o.last))),
        count: list.reduce((n, o) => n + o.count, 0),
      };
    })
    .sort((a, b) => +a.first - +b.first);
  if (periods.length === 1) return { status: 'single', current: periods[0]! };
  // nomes vistos em poucos jogos são ruído; sem nenhum nome firme, fica de fora
  const solid = periods.filter((p) => p.count >= MIN_GAMES_PER_NAME);
  if (!solid.length) return { status: 'ambiguous', periods };
  if (solid.length === 1) return { status: 'single', current: solid[0]! };
  for (let i = 0; i + 1 < solid.length; i++) {
    const [a, b] = [solid[i]!, solid[i + 1]!];
    // sobreposição/alternância ou outra cidade = ID reaproveitado para outro lugar. A → B → A (casa
    // provisória, nome de torneio, erro pontual) cai aqui: o grupo de A vai do primeiro ao último jogo
    // com A e engloba o período de B, então nunca vira troca de nome.
    if (!(a.last < b.first) || (a.city && b.city && a.city !== b.city))
      return { status: 'ambiguous', periods };
  }
  return { status: 'renamed', current: solid.at(-1)!, former: solid.slice(0, -1) };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function formerNamesOf(history: NameHistory | null): ProviderFormerName[] | null {
  if (history?.status !== 'renamed') return null;
  return history.former
    .map((p) => ({ name: p.name, from: isoDay(p.first), until: isoDay(p.last) }))
    .reverse();
}

export interface NameDerivationStats {
  entities: number;
  single: number;
  renamed: number;
  /** Períodos sobrepostos ou nomes alternando: ficaram de fora. */
  ambiguous: number;
  /** Linhas cujos nomes anteriores mudaram nesta execução. */
  changed: number;
  /** Estádios cujo nome atual passou a ser o do jogo mais recente. */
  currentNameUpdated?: number;
  /** Até 20 exemplos de ambíguos (para o relatório). */
  ambiguousSamples: string[];
}

interface ObservationRow extends Record<string, unknown> {
  id: string;
  name: string;
  city?: string | null;
  first: string | Date;
  last: string | Date;
  count: number;
}

async function observations(
  db: Database,
  kind: 'venue' | 'participant',
): Promise<Map<string, NameObservation[]>> {
  const rows =
    kind === 'venue'
      ? await db.execute<ObservationRow>(sql`
          select e.venue_id as id, ff.summary #>> '{fixture,venue,name}' as name,
                 ff.summary #>> '{fixture,venue,city}' as city,
                 min(e.starts_at) as first, max(e.starts_at) as last, count(*)::int as count
            from core.football_fixture ff
            join core.event e on e.id = ff.event_id
           where e.venue_id is not null and coalesce(ff.summary #>> '{fixture,venue,name}', '') <> ''
           group by 1, 2, 3`)
      : await db.execute<ObservationRow>(sql`
          select ep.participant_id as id, ff.summary #>> array['teams', ep.side::text, 'name'] as name,
                 min(e.starts_at) as first, max(e.starts_at) as last, count(*)::int as count
            from core.football_fixture ff
            join core.event e on e.id = ff.event_id
            join core.event_participant ep on ep.event_id = e.id and ep.side::text in ('home', 'away')
           where coalesce(ff.summary #>> array['teams', ep.side::text, 'name'], '') <> ''
           group by 1, 2`);
  const out = new Map<string, NameObservation[]>();
  for (const r of rows) {
    const list = out.get(r.id) ?? [];
    list.push({
      name: r.name,
      city: r.city ?? null,
      first: new Date(r.first),
      last: new Date(r.last),
      count: Number(r.count),
    });
    out.set(r.id, list);
  }
  return out;
}

const CHUNK = 500;

async function writeFormerNames(
  db: Database,
  table: 'venue' | 'participant',
  rows: { id: string; former: ProviderFormerName[] | null }[],
): Promise<string[]> {
  const changed: string[] = [];
  const target = table === 'venue' ? sql`core.venue` : sql`core.participant`;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const updated = await db.execute<{ id: string }>(sql`
      update ${target} t set provider_former_names = d.former, updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) as d(id uuid, former jsonb)
       where t.id = d.id and t.provider_former_names is distinct from d.former
      returning t.id`);
    changed.push(...updated.map((r) => r.id));
  }
  return changed;
}

/** Purga o cache das entidades alteradas (o nome aparece em eventos e times). */
async function publishNameChanges(db: Database, entityType: 'venue' | 'participant', ids: Iterable<string>) {
  for (const id of new Set(ids))
    await publishChange(db, {
      topic: 'catalog',
      entityType,
      entityId: id,
      payload: { reason: 'provider_names', tags: ['event', 'participant', 'team_profile'] },
    });
}

function tally(histories: Map<string, NameHistory | null>): Omit<NameDerivationStats, 'changed'> {
  const s = {
    entities: histories.size,
    single: 0,
    renamed: 0,
    ambiguous: 0,
    ambiguousSamples: [] as string[],
  };
  for (const h of histories.values()) {
    if (!h) continue;
    s[h.status]++;
    if (h.status === 'ambiguous' && s.ambiguousSamples.length < 20)
      s.ambiguousSamples.push(
        h.periods.map((p) => `${p.name} (${isoDay(p.first)}→${isoDay(p.last)})`).join(' | '),
      );
  }
  return s;
}

/**
 * Deriva os nomes anteriores de estádios e times a partir das partidas já normalizadas e grava em
 * `provider_former_names`. Nos estádios sem ambiguidade, o nome atual passa a ser o do jogo mais
 * recente quando ele é mais novo que o gravado (backfill da regra da normalização).
 */
export async function deriveProviderNames(
  db: Database,
): Promise<{ venues: NameDerivationStats; participants: NameDerivationStats }> {
  const venueHistories = new Map(
    [...(await observations(db, 'venue'))].map(([id, obs]) => [id, deriveNameHistory(obs)]),
  );
  const venueRows = [...venueHistories].map(([id, h]) => ({ id, former: formerNamesOf(h) }));
  const venueChanged = await writeFormerNames(db, 'venue', venueRows);
  const current = [...venueHistories].flatMap(([id, h]) =>
    h && h.status !== 'ambiguous' ? [{ id, name: h.current.name, seen: h.current.last.toISOString() }] : [],
  );
  let currentNameUpdated = 0;
  for (let i = 0; i < current.length; i += CHUNK) {
    const batch = sql`jsonb_to_recordset(${JSON.stringify(current.slice(i, i + CHUNK))}::jsonb)
             as d(id uuid, name text, seen timestamptz)`;
    const renamed = await db.execute<{ id: string }>(sql`
      update core.venue v set name = d.name, name_seen_at = d.seen, updated_at = now()
        from ${batch}
       where v.id = d.id and v.name is distinct from d.name
         and (v.name_seen_at is null or v.name_seen_at < d.seen)
      returning v.id`);
    currentNameUpdated += renamed.length;
    venueChanged.push(...renamed.map((r) => r.id));
    // mesmo nome: só registra a data (o nome sem data de /teams não o substitui mais)
    await db.execute(sql`
      update core.venue v set name_seen_at = d.seen
        from ${batch}
       where v.id = d.id and v.name = d.name and (v.name_seen_at is null or v.name_seen_at < d.seen)`);
  }

  const participantHistories = new Map(
    [...(await observations(db, 'participant'))].map(([id, obs]) => [id, deriveNameHistory(obs)]),
  );
  const participantChanged = await writeFormerNames(
    db,
    'participant',
    [...participantHistories].map(([id, h]) => ({ id, former: formerNamesOf(h) })),
  );
  await publishNameChanges(db, 'venue', venueChanged);
  await publishNameChanges(db, 'participant', participantChanged);
  return {
    venues: { ...tally(venueHistories), changed: new Set(venueChanged).size, currentNameUpdated },
    participants: { ...tally(participantHistories), changed: participantChanged.length },
  };
}
