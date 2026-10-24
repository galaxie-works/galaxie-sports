/**
 * Verdade do F1DB (release fixado, CC BY 4.0) para as regras da F1: por piloto, a carreira (largadas, vitórias,
 * títulos) e, por temporada, a equipe, o número e os nomes de época (construtor e inscrição). Mesmas contas da
 * auditoria dos perfis de piloto (`apps/api/src/cli/f1-auditoria.ts`).
 */
import { F1DB_RELEASE, ensureRelease, f1dbDir } from '../../f1db/release.js';

export interface F1dbSeasonTruth {
  /** Construtor com mais corridas na temporada (id do F1DB; empate: o menor id). */
  constructorId: string;
  /** Todos os empatados em corridas (qualquer um vale como equipe principal do ano). */
  constructorIds: string[];
  /** Nomes de época aceitos para a equipe: o do construtor e os das inscrições do piloto com ele no ano. */
  names: string[];
  /** Números mais usados nas corridas do ano (empate: todos). */
  numbers: number[];
}

export interface F1dbDriverTruth {
  id: string;
  name: string;
  /** ISO alpha-2 da nacionalidade (GB para o Reino Unido inteiro). */
  nationality: string | null;
  starts: number;
  wins: number;
  /** Anos com título (1º no campeonato, temporada encerrada). */
  titles: number[];
  seasons: Map<number, F1dbSeasonTruth>;
  /** grid <ano>, campeão, top 20 vitórias, top 20 GPs. */
  tags: string[];
}

export interface F1dbTruth {
  release: string;
  currentYear: number;
  racesLeft: number;
  drivers: Map<string, F1dbDriverTruth>;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));

/** Mais frequentes de uma contagem (todos os empatados). */
export function mostUsed<K>(counts: Map<K, number>): K[] {
  const max = Math.max(0, ...counts.values());
  return [...counts].filter(([, n]) => n === max && max > 0).map(([k]) => k);
}

export async function loadF1dbTruth(path: string, today: string): Promise<F1dbTruth> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const all = (q: string, ...p: (string | number)[]) => db.prepare(q).all(...p) as Row[];
    const alpha2 = new Map(
      all('select id, alpha2_code from country').map((c) => [str(c.id)!, str(c.alpha2_code)]),
    );
    const [{ year: currentYear }] = all('select max(year) as year from race') as [{ year: number }];
    const [{ left }] = all(
      'select count(*) as left from race where year = ? and date > ?',
      currentYear,
      today,
    ) as [{ left: number }];
    const finished = (y: number) => y < Number(currentYear) || Number(left) === 0;

    const constructorNames = new Map(
      all('select id, name, full_name from constructor').map((c) => [
        str(c.id)!,
        [str(c.name)!, str(c.full_name)!],
      ]),
    );
    const entrants = new Map<string, string[]>();
    for (const r of all(`
      select sed.driver_id, sed.year, sed.constructor_id, e.name
        from season_entrant_driver sed join entrant e on e.id = sed.entrant_id
       where sed.test_driver = 0`)) {
      const k = `${str(r.driver_id)}|${Number(r.year)}|${str(r.constructor_id)}`;
      entrants.set(k, [...(entrants.get(k) ?? []), str(r.name)!]);
    }

    const results = new Map<string, Row[]>();
    for (const r of all(`
      select d.driver_id, r.year, d.position_number, d.driver_number, d.constructor_id
        from race_data d join race r on r.id = d.race_id where d.type = 'RACE_RESULT'`))
      results.set(str(r.driver_id)!, [...(results.get(str(r.driver_id)!) ?? []), r]);
    const titles = new Map<string, number[]>();
    for (const r of all('select year, driver_id from season_driver_standing where position_number = 1'))
      if (finished(Number(r.year)))
        titles.set(str(r.driver_id)!, [...(titles.get(str(r.driver_id)!) ?? []), Number(r.year)].sort());

    const drivers = new Map<string, F1dbDriverTruth>();
    for (const d of all(
      'select id, name, nationality_country_id, total_race_starts from driver where total_race_starts > 0',
    )) {
      const id = str(d.id)!;
      const rows = results.get(id) ?? [];
      const byYear = new Map<number, { teams: Map<string, number>; numbers: Map<number, number> }>();
      for (const r of rows) {
        const y = Number(r.year);
        const s = byYear.get(y) ?? { teams: new Map(), numbers: new Map() };
        const team = str(r.constructor_id);
        if (team) s.teams.set(team, (s.teams.get(team) ?? 0) + 1);
        if (r.driver_number != null)
          s.numbers.set(Number(r.driver_number), (s.numbers.get(Number(r.driver_number)) ?? 0) + 1);
        byYear.set(y, s);
      }
      const seasons = new Map<number, F1dbSeasonTruth>();
      for (const [year, s] of byYear) {
        const constructorIds = mostUsed(s.teams).sort();
        const constructorId = constructorIds[0];
        if (!constructorId) continue;
        seasons.set(year, {
          constructorId,
          constructorIds,
          names: constructorIds.flatMap((c) => [
            ...(constructorNames.get(c) ?? []),
            ...(entrants.get(`${id}|${year}|${c}`) ?? []),
          ]),
          numbers: mostUsed(s.numbers).sort((a, b) => a - b),
        });
      }
      drivers.set(id, {
        id,
        name: str(d.name)!,
        nationality: alpha2.get(str(d.nationality_country_id) ?? '') ?? null,
        starts: Number(d.total_race_starts),
        wins: rows.filter((r) => Number(r.position_number) === 1).length,
        titles: titles.get(id) ?? [],
        seasons,
        tags: [],
      });
    }

    // prioridade (a mesma da auditoria): grid da temporada atual, campeões e os 20 primeiros em vitórias e em GPs
    const list = [...drivers.values()];
    const top = (pick: (t: F1dbDriverTruth) => number) =>
      new Set(
        [...list]
          .sort((a, b) => pick(b) - pick(a))
          .slice(0, 20)
          .map((t) => t.id),
      );
    const topWins = top((t) => t.wins);
    const topStarts = top((t) => t.starts);
    for (const t of list)
      t.tags = [
        t.seasons.has(Number(currentYear)) ? `grid ${currentYear}` : null,
        t.titles.length ? 'campeão' : null,
        topWins.has(t.id) ? 'top 20 vitórias' : null,
        topStarts.has(t.id) ? 'top 20 GPs' : null,
      ].filter((x): x is string => !!x);
    return {
      release: F1DB_RELEASE.version,
      currentYear: Number(currentYear),
      racesLeft: Number(left),
      drivers,
    };
  } finally {
    db.close();
  }
}

/** Baixa (se faltar) o release fixado e carrega a verdade. */
export async function f1dbTruthFromRelease(now: Date, log: (m: string) => void): Promise<F1dbTruth> {
  const path = await ensureRelease(f1dbDir(), F1DB_RELEASE, log);
  return loadF1dbTruth(path, now.toISOString().slice(0, 10));
}
