/**
 * Quem entra no acervo de fotos da F1, a partir das tabelas do F1DB (raw): pilotos e carros (construtor numa
 * temporada, com o nome do chassi). Puro.
 *
 * Escopos, na ordem de prioridade pedida:
 * - `senna`: Ayrton Senna, os companheiros de equipe dele (1984–1994) e os carros que ele pilotou;
 * - `campeoes`: os campeões mundiais e os carros dos títulos;
 * - `mais-corridas`: os N pilotos com mais largadas;
 * - `lendas`: todos os campeões mundiais e os N pilotos com mais vitórias e com mais GPs, cada um com o carro de
 *   destaque (`highlightSeason`): a temporada de título com mais vitórias ou, sem título, a de mais vitórias.
 */
import { int, rowsOf, str, type F1dbTables } from '@galaxie/providers';

export type CommonsScope = 'senna' | 'campeoes' | 'mais-corridas' | 'lendas';
export const COMMONS_SCOPES: readonly CommonsScope[] = ['senna', 'campeoes', 'mais-corridas', 'lendas'];

/** Temporada mais marcante do piloto: o carro dela é o "carro de destaque" (heading da página do piloto). */
export interface Highlight {
  /** Alvo do carro no manifesto (`car/<construtor>/<ano>`). */
  target: string;
  year: number;
  reason: string;
  /** Equipe inscrita do piloto naquele ano (o chassi do carro de destaque é o dela, não o de uma privada). */
  entrant: string | null;
}

export interface DriverTarget {
  kind: 'driver';
  /** Id do piloto no F1DB. */
  f1dbId: string;
  name: string;
  dateOfBirth: string | null;
  /** Temporadas de F1 (para as categorias "<piloto> in <ano>" e a época certa das fotos). */
  seasons: number[];
  /** Carro de destaque (temporada mais marcante). */
  highlight: Highlight | null;
}

export interface CarTarget {
  kind: 'car';
  /** Construtor no F1DB e temporada do carro. */
  f1dbId: string;
  constructorName: string;
  year: number;
  /** Chassis da temporada ("McLaren MP4/4"); cada um é uma categoria candidata na Commons. */
  chassis: string[];
  /** Piloto de quem este é o carro de destaque: foto do carro com ele vale mais. */
  driver?: { f1dbId: string; name: string; lastName: string } | null;
  /** Sobrenomes dos outros pilotos da temporada: foto que cita outro piloto (e não o do destaque) vale menos. */
  others?: string[];
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
      highlight: highlightSeason(tables, id),
    };
  };
  const carTarget = (
    constructorId: string,
    year: number,
    driver?: CarTarget['driver'],
    entrant?: string | null,
    others?: string[],
  ): CarTarget | null => {
    const c = constructors.get(constructorId);
    const rows = rowsOf(tables, 'season_entrant_chassis').filter(
      (r) => int(r.year) === year && str(r.constructor_id) === constructorId,
    );
    // carro de destaque: só o chassi da equipe do piloto (Ascari 1952: a Scuderia Ferrari, não as privadas)
    const own = entrant ? rows.filter((r) => str(r.entrant_id) === entrant) : [];
    const chassis = [
      ...new Set(
        (own.length ? own : rows)
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
      ...(driver ? { driver } : {}),
      ...(others?.length ? { others } : {}),
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
    // só título decidido: o líder da temporada em andamento não é campeão
    const champions = rowsOf(tables, 'season_driver_standing').filter((r) => int(r.championship_won) === 1);
    for (const r of [...champions].sort((a, b) => (int(a.year) ?? 0) - (int(b.year) ?? 0)))
      push(driverTarget(str(r.driver_id)!));
    for (const r of champions) {
      const year = int(r.year)!;
      const team = entries.find((e) => int(e.year) === year && str(e.driver_id) === str(r.driver_id));
      if (team) push(carTarget(str(team.constructor_id)!, year));
    }
  } else if (scope === 'lendas') {
    const by = (col: string) =>
      [...drivers.values()]
        .filter((d) => (int(d[col]) ?? 0) > 0)
        .sort(
          (a, b) =>
            (int(b[col]) ?? 0) - (int(a[col]) ?? 0) || (str(a.id) ?? '').localeCompare(str(b.id) ?? ''),
        );
    const legends = [
      ...by('total_championship_wins'),
      ...by('total_race_wins').slice(0, limit),
      ...by('total_race_starts').slice(0, limit),
    ];
    const targets = legends.map((d) => driverTarget(str(d.id)!)).filter((t): t is DriverTarget => !!t);
    for (const t of targets) push(t);
    for (const t of targets) {
      if (!t.highlight) continue;
      const d = drivers.get(t.f1dbId)!;
      const [, constructorId] = t.highlight.target.split('/');
      const lastName = surname(str(d.last_name) ?? t.name.split(' ').at(-1)!);
      // os outros pilotos da temporada (o mesmo sobrenome, como os Hill, não conta como outro)
      const others = [
        ...new Set(
          entries
            .filter((e) => int(e.year) === t.highlight!.year && str(e.driver_id) !== t.f1dbId)
            .map((e) => surname(str(drivers.get(str(e.driver_id)!)?.last_name) ?? ''))
            .filter((n) => n && n !== lastName),
        ),
      ];
      push(
        carTarget(
          constructorId!,
          t.highlight.year,
          { f1dbId: t.f1dbId, name: t.name, lastName },
          t.highlight.entrant,
          others,
        ),
      );
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

/**
 * Temporada mais marcante do piloto: entre as temporadas de título (ou, sem título, as com vitória; sem vitória,
 * todas), a de mais vitórias; empate pelo aproveitamento (vitórias por largada), depois pela posição no campeonato
 * e pelo ano mais recente. Senna → McLaren 1988, Schumacher → Ferrari 2004, Hamilton → Mercedes 2020.
 */
export function highlightSeason(tables: F1dbTables, driverId: string): Highlight | null {
  const seasons = rowsOf(tables, 'season_driver').filter((r) => str(r.driver_id) === driverId);
  if (!seasons.length) return null;
  const titles = new Set(
    rowsOf(tables, 'season_driver_standing')
      .filter((r) => str(r.driver_id) === driverId && int(r.championship_won) === 1)
      .map((r) => int(r.year)),
  );
  const wins = (r: (typeof seasons)[number]) => int(r.total_race_wins) ?? 0;
  const starts = (r: (typeof seasons)[number]) => int(r.total_race_starts) ?? 0;
  const pool = titles.size
    ? seasons.filter((r) => titles.has(int(r.year)))
    : seasons.some((r) => wins(r) > 0)
      ? seasons.filter((r) => wins(r) > 0)
      : seasons;
  const best = [...pool].sort(
    (a, b) =>
      wins(b) - wins(a) ||
      wins(b) / Math.max(1, starts(b)) - wins(a) / Math.max(1, starts(a)) ||
      (int(a.position_number) ?? 999) - (int(b.position_number) ?? 999) ||
      (int(b.year) ?? 0) - (int(a.year) ?? 0),
  )[0]!;
  const year = int(best.year)!;
  // a equipe da temporada: a de mais rodadas (Moss 1958: Vanwall, não a Cooper da primeira corrida); sem as
  // inscrições só de teste
  const rounds = new Map<string, number>();
  for (const r of rowsOf(tables, 'season_entrant_driver'))
    if (int(r.year) === year && str(r.driver_id) === driverId && !int(r.test_driver)) {
      const c = str(r.constructor_id)!;
      rounds.set(c, (rounds.get(c) ?? 0) + (str(r.rounds)?.split(';').length ?? 1));
    }
  const team = [...rounds].sort((a, b) => b[1] - a[1])[0]?.[0];
  // a equipe inscrita (entrant) de mais rodadas com esse construtor
  const entrants = new Map<string, number>();
  for (const r of rowsOf(tables, 'season_entrant_driver'))
    if (
      int(r.year) === year &&
      str(r.driver_id) === driverId &&
      !int(r.test_driver) &&
      str(r.constructor_id) === team
    ) {
      const e = str(r.entrant_id);
      if (e) entrants.set(e, (entrants.get(e) ?? 0) + (str(r.rounds)?.split(';').length ?? 1));
    }
  const entrant = [...entrants].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  if (!team) return null;
  const w = wins(best);
  const s = starts(best);
  const reason = titles.has(year)
    ? `título de ${year} · ${w} vitória(s) em ${s} corrida(s)`
    : w > 0
      ? `${w} vitória(s) em ${s} corrida(s) em ${year}`
      : `melhor temporada: ${str(best.position_text) ?? '?'}º em ${year}`;
  return { target: `car/${team}/${year}`, year, reason, entrant };
}

/** Sobrenome para casar com o título da foto: sem "Jr."/"Sr." ("Sainz Jr." → "Sainz"). */
export function surname(lastName: string): string {
  return lastName.replace(/[,\s]+(jr|sr|ii|iii)\.?$/i, '').trim();
}
