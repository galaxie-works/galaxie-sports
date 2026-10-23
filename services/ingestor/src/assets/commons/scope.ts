/**
 * Quem entra no acervo de fotos da F1, a partir das tabelas do F1DB (raw): pilotos e carros (construtor numa
 * temporada, com o nome do chassi). Puro.
 *
 * Escopos, na ordem de prioridade pedida:
 * - `senna`: Ayrton Senna, os companheiros de equipe dele (1984–1994) e os carros que ele pilotou;
 * - `campeoes`: os campeões mundiais e os carros dos títulos;
 * - `mais-corridas`: os N pilotos com mais largadas.
 */
import { int, rowsOf, str, type F1dbTables } from '@galaxie/providers';

export type CommonsScope = 'senna' | 'campeoes' | 'mais-corridas';
export const COMMONS_SCOPES: readonly CommonsScope[] = ['senna', 'campeoes', 'mais-corridas'];

export interface DriverTarget {
  kind: 'driver';
  /** Id do piloto no F1DB. */
  f1dbId: string;
  name: string;
  dateOfBirth: string | null;
  /** Temporadas de F1 (para as categorias "<piloto> in <ano>" e a época certa das fotos). */
  seasons: number[];
}

export interface CarTarget {
  kind: 'car';
  /** Construtor no F1DB e temporada do carro. */
  f1dbId: string;
  constructorName: string;
  year: number;
  /** Chassis da temporada ("McLaren MP4/4"); cada um é uma categoria candidata na Commons. */
  chassis: string[];
}

export type CommonsTarget = DriverTarget | CarTarget;

const SENNA = 'ayrton-senna';

export function targetsFor(tables: F1dbTables, scope: CommonsScope, limit = 30): CommonsTarget[] {
  const drivers = new Map(rowsOf(tables, 'driver').map((d) => [str(d.id)!, d]));
  const constructors = new Map(rowsOf(tables, 'constructor').map((c) => [str(c.id)!, c]));
  const chassisById = new Map(rowsOf(tables, 'chassis').map((c) => [str(c.id)!, c]));
  const entries = rowsOf(tables, 'season_entrant_driver').filter((r) => !int(r.test_driver));
  const seasonsOf = (driverId: string) =>
    [...new Set(entries.filter((r) => str(r.driver_id) === driverId).map((r) => int(r.year)!))].sort();

  const driverTarget = (id: string): DriverTarget | null => {
    const d = drivers.get(id);
    if (!d) return null;
    return {
      kind: 'driver',
      f1dbId: id,
      name: str(d.name) ?? id,
      dateOfBirth: str(d.date_of_birth),
      seasons: seasonsOf(id),
    };
  };
  const carTarget = (constructorId: string, year: number): CarTarget | null => {
    const c = constructors.get(constructorId);
    const chassis = [
      ...new Set(
        rowsOf(tables, 'season_entrant_chassis')
          .filter((r) => int(r.year) === year && str(r.constructor_id) === constructorId)
          .map((r) => str(chassisById.get(str(r.chassis_id)!)?.full_name))
          .filter((n): n is string => !!n),
      ),
    ];
    if (!c || !chassis.length) return null;
    return {
      kind: 'car',
      f1dbId: constructorId,
      constructorName: str(c.name) ?? constructorId,
      year,
      chassis,
    };
  };

  const out: CommonsTarget[] = [];
  const seen = new Set<string>();
  const push = (t: CommonsTarget | null) => {
    if (!t) return;
    const key = targetKey(t);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  if (scope === 'senna') {
    push(driverTarget(SENNA));
    const teams = entries.filter((r) => str(r.driver_id) === SENNA);
    for (const t of teams) {
      const year = int(t.year)!;
      const constructorId = str(t.constructor_id)!;
      for (const mate of entries)
        if (
          int(mate.year) === year &&
          str(mate.constructor_id) === constructorId &&
          str(mate.driver_id) !== SENNA
        )
          push(driverTarget(str(mate.driver_id)!));
    }
    for (const t of teams) push(carTarget(str(t.constructor_id)!, int(t.year)!));
  } else if (scope === 'campeoes') {
    const champions = rowsOf(tables, 'season_driver_standing').filter((r) => int(r.position_number) === 1);
    for (const r of [...champions].sort((a, b) => (int(a.year) ?? 0) - (int(b.year) ?? 0)))
      push(driverTarget(str(r.driver_id)!));
    for (const r of champions) {
      const year = int(r.year)!;
      const team = entries.find((e) => int(e.year) === year && str(e.driver_id) === str(r.driver_id));
      if (team) push(carTarget(str(team.constructor_id)!, year));
    }
  } else {
    const ranked = [...drivers.values()]
      .filter((d) => (int(d.total_race_starts) ?? 0) > 0)
      .sort((a, b) => (int(b.total_race_starts) ?? 0) - (int(a.total_race_starts) ?? 0))
      .slice(0, limit);
    for (const d of ranked) push(driverTarget(str(d.id)!));
  }
  return out;
}

/** Chave estável do alvo no manifesto: `driver/ayrton-senna`, `car/mclaren/1988`. */
export const targetKey = (t: CommonsTarget) =>
  t.kind === 'driver' ? `driver/${t.f1dbId}` : `car/${t.f1dbId}/${t.year}`;
