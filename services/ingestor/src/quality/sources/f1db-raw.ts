/**
 * Pilotos prioritários do F1DB lidos do release já importado no raw (`f1db:import`, provider `f1db`), sem baixar o
 * arquivo: o job agendado roda no container do ingestor, sem volume para o F1DB e com pouca memória. Só as tabelas
 * pequenas (`driver`, `season_driver`, `season_driver_standing`, `race`) e só os campos usados, lidos do JSONB.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';
import { F1DB_PROVIDER, F1DB_SPORT } from '@galaxie/providers';
import { priorityTags } from './f1db.js';

export interface F1dbPriorityDriver {
  id: string;
  name: string;
  tags: string[];
}

export interface F1dbRawPriority {
  release: string | null;
  drivers: F1dbPriorityDriver[];
}

/** Prioridade do release importado mais recente; null sem F1DB no raw. `today` é YYYY-MM-DD. */
export async function f1dbPriorityFromRaw(db: Database, today: string): Promise<F1dbRawPriority | null> {
  const [pkg] = await db.execute<{ sha: string; release: string | null }>(sql`
    select params->>'package_sha256' as sha, api_version as release from raw.api_response
     where provider = ${F1DB_PROVIDER} and sport = ${F1DB_SPORT} and endpoint = 'sqlite/driver'
     order by fetched_at desc, id desc limit 1`);
  if (!pkg) return null;
  // na ordem das páginas e das linhas (a do rowid no SQLite): é o desempate do top 20, como no release
  const rows = async (table: string, fields: readonly string[]) =>
    db.execute<Record<string, string | null>>(sql`
      select ${sql.join(
        fields.map((f) => sql`x.row->>${f} as ${sql.identifier(f)}`),
        sql`, `,
      )}
        from raw.api_response r
       cross join lateral jsonb_array_elements(r.body->'rows') with ordinality as x(row, ord)
       where r.provider = ${F1DB_PROVIDER} and r.sport = ${F1DB_SPORT} and r.endpoint = ${`sqlite/${table}`}
         and r.params->>'package_sha256' = ${pkg.sha}
       order by r.page, x.ord`);

  const drivers = (await rows('driver', ['id', 'name', 'total_race_starts', 'total_race_wins'])).filter(
    (d) => Number(d.total_race_starts) > 0,
  );
  if (!drivers.length) return null;
  const races = await rows('race', ['year', 'date']);
  const currentYear = Math.max(...races.map((r) => Number(r.year)));
  const racesLeft = races.filter((r) => Number(r.year) === currentYear && (r.date ?? '') > today).length;
  // título só de temporada encerrada (com o release no meio do ano, a liderança não é título)
  const finished = (year: number) => year < currentYear || racesLeft === 0;
  const champions = new Set(
    (await rows('season_driver_standing', ['year', 'driver_id', 'position_number']))
      .filter((r) => Number(r.position_number) === 1 && finished(Number(r.year)))
      .map((r) => r.driver_id),
  );
  const grid = new Set(
    (await rows('season_driver', ['year', 'driver_id', 'total_race_starts']))
      .filter((r) => Number(r.year) === currentYear && Number(r.total_race_starts) > 0)
      .map((r) => r.driver_id),
  );
  const tags = priorityTags(
    drivers.map((d) => ({
      id: d.id!,
      wins: Number(d.total_race_wins ?? 0),
      starts: Number(d.total_race_starts),
      champion: champions.has(d.id),
      grid: grid.has(d.id),
    })),
    currentYear,
  );
  return {
    release: pkg.release,
    drivers: drivers.flatMap((d) => {
      const t = tags.get(d.id!);
      return t ? [{ id: d.id!, name: d.name ?? d.id!, tags: t }] : [];
    }),
  };
}
