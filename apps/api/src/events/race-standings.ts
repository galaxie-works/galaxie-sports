/**
 * Classificação do campeonato da F1 com o que a tabela de pontos corridos não tem, calculado do core para
 * qualquer temporada (1950 a hoje):
 *
 * - retrato do piloto no acervo de licenças livres (`participant_photo`, papel `portrait`), com o crédito — o
 *   mesmo de `/v1/teams/{id}/photos`;
 * - equipe da temporada: no campeonato de pilotos, a de mais Grandes Prêmios no ano; o nome é o daquela época
 *   (o do resultado da corrida: McLaren em 1988, não McLaren Racing) e a cor é a pintura curada por época
 *   (`formula-1/liveries.yaml`);
 * - pódios (só Grandes Prêmios; chegada em posição numérica, como na carreira do piloto);
 * - empate em pontos (Nakajima e Martini, 16º em 1988): mesma posição, na ordem da contagem regressiva da FIA
 *   (mais vitórias, depois mais segundos lugares, e assim por diante).
 */
import { sql } from 'drizzle-orm';
import { teamGradient, type Photo, type Standings, type TeamLivery } from '@galaxie/contracts';
import type { Database } from '@galaxie/db';
import { liveryFor, type LiveryEntry } from '@galaxie/knowledge';
import { loadPhotos } from '../teams/photos.js';
import { loadRaceTeams } from './race.js';

type Row = Standings['groups'][number]['rows'][number];

type RaceRow = {
  participant_id: string;
  position: number | null;
  result: { team?: { id?: unknown; name?: unknown }; time?: unknown; position_text?: unknown } | null;
};

/** Chegada em posição numérica (abandono ordenado pela api-sports vem com `time: "DNF"`). */
export function finishedAt(r: Pick<RaceRow, 'position' | 'result'>): number | null {
  const text = r.result?.position_text;
  if (text != null && !/^\d+$/.test(String(text))) return null;
  if (r.result?.time === 'DNF') return null;
  return r.position;
}

/**
 * Contagem regressiva: compara as chegadas de dois participantes (mais 1ºs; empatou, mais 2ºs; …). Negativo
 * quando `a` fica na frente.
 */
export function countback(a: number[], b: number[]): number {
  const count = (list: number[], p: number) => list.filter((x) => x === p).length;
  const last = Math.max(0, ...a, ...b);
  for (let p = 1; p <= last; p++) {
    const diff = count(b, p) - count(a, p);
    if (diff) return diff;
  }
  return 0;
}

/** Pintura curada → contrato (o gradiente sai da primária, como o das cores do escudo). */
function toLivery(era: ReturnType<typeof liveryFor>): TeamLivery | null {
  const [primary, secondary] = era?.colors ?? [];
  if (!era || !primary) return null;
  return { primary, secondary: secondary ?? null, gradient: teamGradient(primary), source: era.sources[0]! };
}

/** O mais frequente de uma lista (empate: o primeiro que apareceu). */
function mostFrequent<T>(items: T[], key: (t: T) => string): T | undefined {
  const counts = new Map<string, { item: T; n: number }>();
  for (const it of items) {
    const k = key(it);
    const c = counts.get(k);
    if (c) c.n += 1;
    else counts.set(k, { item: it, n: 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.item;
}

const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);

/** Acrescenta retrato, equipe da temporada e pódios às linhas e reordena os empates (in place). */
export async function enrichRaceStandings(
  db: Database,
  seasonId: string,
  groups: Standings['groups'],
  options: { assetsBaseUrl: string | undefined; liveries: LiveryEntry[]; year: number },
): Promise<void> {
  const races = await db.execute<RaceRow>(sql`
    select ep.participant_id::text, ep.position, ep.result
      from core.event e
      join core.sport_event_detail sd on sd.event_id = e.id and sd.kind = 'race'
      join core.event_participant ep on ep.event_id = e.id
     where e.season_id = ${seasonId}::uuid and e.status = 'finished'
       and lower(sd.summary->>'type') = 'race'
     order by e.starts_at`);
  const teams = await loadRaceTeams(
    db,
    'formula-1',
    races.map((r) => r.result),
    options.assetsBaseUrl,
  );
  const teamIds = [...new Set([...teams.values()].map((t) => t.id))];
  const f1dbOf = new Map<string, string[]>();
  if (teamIds.length) {
    const rows = await db.execute<{ entity_id: string; provider_id: string }>(sql`
      select entity_id::text, provider_id from core.provider_map
       where entity_type = 'participant' and provider = 'f1db'
         and entity_id in (${sql.join(
           teamIds.map((id) => sql`${id}::uuid`),
           sql`, `,
         )})`);
    for (const r of rows) f1dbOf.set(r.entity_id, [...(f1dbOf.get(r.entity_id) ?? []), r.provider_id]);
  }
  /** Equipe de uma corrida: id no catálogo, nome daquela época e a pintura do ano. */
  const seasonTeam = (raw: RaceRow['result']) => {
    const rawId = text(raw?.team?.id);
    const known = rawId ? teams.get(rawId) : undefined;
    const name = text(raw?.team?.name) ?? known?.name;
    if (!name) return null;
    const keys = [...(rawId ? [rawId] : []), ...(known ? (f1dbOf.get(known.id) ?? []) : [])];
    const era = keys.map((k) => liveryFor(options.liveries, k, options.year)).find(Boolean) ?? null;
    return { id: known?.id ?? null, name, livery: toLivery(era) };
  };

  const byDriver = new Map<string, RaceRow[]>();
  const byTeam = new Map<string, RaceRow[]>();
  for (const r of races) {
    byDriver.set(r.participant_id, [...(byDriver.get(r.participant_id) ?? []), r]);
    const teamId = teams.get(text(r.result?.team?.id) ?? '')?.id;
    if (teamId) byTeam.set(teamId, [...(byTeam.get(teamId) ?? []), r]);
  }
  const finishes = (rows: RaceRow[] | undefined) =>
    (rows ?? []).map(finishedAt).filter((p): p is number => p != null);

  const drivers = groups.find((g) => g.name === 'drivers');
  const photos: Map<string, Photo[]> = drivers
    ? await loadPhotos(
        db,
        drivers.rows.map((r) => r.participant.id),
        options.assetsBaseUrl,
        { role: 'portrait' },
      )
    : new Map();

  for (const g of groups) {
    const isDrivers = g.name === 'drivers';
    if (!isDrivers && g.name !== 'constructors') continue;
    const results = (row: Row) =>
      (isDrivers ? byDriver : byTeam).get(row.participant.id) ?? ([] as RaceRow[]);
    for (const row of g.rows) {
      const own = results(row);
      if (isDrivers) {
        const main = mostFrequent(
          own.filter((r) => seasonTeam(r.result)),
          (r) => seasonTeam(r.result)!.name,
        );
        row.photo = photos.get(row.participant.id)?.[0] ?? null;
        row.season_team = main ? seasonTeam(main.result) : null;
        row.podiums = finishes(own).filter((p) => p <= 3).length;
      } else {
        const main = mostFrequent(
          own.filter((r) => seasonTeam(r.result)),
          (r) => seasonTeam(r.result)!.name,
        );
        row.season_team = main ? { ...seasonTeam(main.result)!, id: row.participant.id } : null;
      }
    }
    // empate em pontos: a mesma posição, na ordem da contagem regressiva
    g.rows.sort((a, b) => a.rank - b.rank || countback(finishes(results(a)), finishes(results(b))));
  }
}
