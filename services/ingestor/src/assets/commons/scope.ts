/**
 * Quem entra no acervo de fotos da F1, a partir das tabelas do F1DB (raw): pilotos e carros (construtor numa
 * temporada, com o nome do chassi). Puro.
 *
 * Escopos, na ordem de prioridade pedida:
 * - `senna`: Ayrton Senna, os companheiros de equipe dele (1984–1994) e os carros que ele pilotou;
 * - `campeoes`: os campeões mundiais e os carros dos títulos;
 * - `mais-corridas`: os N pilotos com mais largadas;
 * - `lendas`: todos os campeões mundiais e os N pilotos com mais vitórias e com mais GPs, cada um com o carro de
 *   destaque (`highlightSeason`): a temporada de título com mais vitórias ou, sem título, a de mais vitórias;
 * - `grid-atual`: todo piloto que largou na temporada atual (a última do F1DB, ou `year`), com o carro da equipe
 *   atual (`car/<construtor>/<ano>`, o de fundo do heading de quem está no grid) e o carro de destaque;
 * - `antigos`: quem correu entre 1950 e 1989 — campeões, vencedores de GP e quem fez 3 temporadas ou mais, nessa
 *   ordem —, cada um com os carros de destaque candidatos.
 */
import { int, rowsOf, str, type F1dbRow, type F1dbTables } from '@galaxie/providers';

export type CommonsScope = 'senna' | 'campeoes' | 'mais-corridas' | 'lendas' | 'grid-atual' | 'antigos';
export const COMMONS_SCOPES: readonly CommonsScope[] = [
  'senna',
  'campeoes',
  'mais-corridas',
  'lendas',
  'grid-atual',
  'antigos',
];

/** Última temporada do escopo `antigos` (pilotos dos anos 1950 a 1980). */
export const ANTIGOS_UNTIL = 1989;

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
  /** Os outros candidatos, em ordem (`highlightCandidates`): valem se o primeiro não tiver foto para o fundo. */
  fallbacks?: Highlight[];
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

/**
 * Alvos do escopo. `limit`: quantos pilotos por lista (`mais-corridas`, `lendas`); `year`: a temporada do
 * `grid-atual` (padrão: a última do F1DB).
 */
export function targetsFor(
  tables: F1dbTables,
  scope: CommonsScope,
  limit = 30,
  year?: number,
): CommonsTarget[] {
  const drivers = new Map(rowsOf(tables, 'driver').map((d) => [str(d.id)!, d]));
  const constructors = new Map(rowsOf(tables, 'constructor').map((c) => [str(c.id)!, c]));
  const chassisById = new Map(rowsOf(tables, 'chassis').map((c) => [str(c.id)!, c]));
  const entries = rowsOf(tables, 'season_entrant_driver').filter((r) => !int(r.test_driver));
  const seasonsOf = (driverId: string) =>
    [...new Set(entries.filter((r) => str(r.driver_id) === driverId).map((r) => int(r.year)!))].sort();

  const driverTarget = (id: string): DriverTarget | null => {
    const d = drivers.get(id);
    if (!d) return null;
    const highlights = highlightCandidates(tables, id);
    return {
      kind: 'driver',
      f1dbId: id,
      name: str(d.name) ?? id,
      dateOfBirth: str(d.date_of_birth),
      seasons: seasonsOf(id),
      highlight: highlights[0] ?? null,
      fallbacks: highlights.slice(1),
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
  /**
   * Carros de destaque candidatos do piloto, com ele (a foto que o cita vale mais) e os outros pilotos da
   * temporada (o mesmo sobrenome, como os Hill, não conta como outro).
   */
  const pushHighlight = (t: DriverTarget) => {
    const d = drivers.get(t.f1dbId)!;
    const lastName = surname(str(d.last_name) ?? t.name.split(' ').at(-1)!);
    for (const h of [t.highlight, ...(t.fallbacks ?? [])]) {
      if (!h) continue;
      const [, constructorId] = h.target.split('/');
      const others = [
        ...new Set(
          entries
            .filter((e) => int(e.year) === h.year && str(e.driver_id) !== t.f1dbId)
            .map((e) => surname(str(drivers.get(str(e.driver_id)!)?.last_name) ?? ''))
            .filter((n) => n && n !== lastName),
        ),
      ];
      push(
        carTarget(constructorId!, h.year, { f1dbId: t.f1dbId, name: t.name, lastName }, h.entrant, others),
      );
    }
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
    for (const t of targets) pushHighlight(t);
  } else if (scope === 'grid-atual') {
    const season = year ?? lastSeason(tables);
    // quem largou (a inscrição sem largada, como a do reserva, fica de fora)
    const raced = rowsOf(tables, 'season_driver')
      .filter((r) => int(r.year) === season && (int(r.total_race_starts) ?? 0) > 0)
      .map((r) => str(r.driver_id)!)
      .sort();
    const targets = raced.map(driverTarget).filter((t): t is DriverTarget => !!t);
    for (const t of targets) push(t);
    // o carro da equipe atual (a de mais rodadas no ano: Lawson 2026, Racing Bulls), sem piloto: vale pelos dois
    for (const id of [...new Set(raced.map((id) => teamOf(tables, id, season)?.constructorId))].sort())
      if (id) push(carTarget(id, season));
    for (const t of targets) pushHighlight(t);
  } else if (scope === 'antigos') {
    const tier = (d: F1dbRow) =>
      (int(d.total_championship_wins) ?? 0) > 0
        ? 0
        : (int(d.total_race_wins) ?? 0) > 0
          ? 1
          : seasonsOf(str(d.id)!).length >= 3
            ? 2
            : null;
    const old = [...drivers.values()]
      .filter((d) => seasonsOf(str(d.id)!).some((y) => y <= ANTIGOS_UNTIL) && tier(d) != null)
      .sort(
        (a, b) =>
          tier(a)! - tier(b)! ||
          (int(b.total_race_wins) ?? 0) - (int(a.total_race_wins) ?? 0) ||
          (int(b.total_race_starts) ?? 0) - (int(a.total_race_starts) ?? 0) ||
          (str(a.id) ?? '').localeCompare(str(b.id) ?? ''),
      );
    const targets = old.map((d) => driverTarget(str(d.id)!)).filter((t): t is DriverTarget => !!t);
    for (const t of targets) push(t);
    for (const t of targets) pushHighlight(t);
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
  return highlightCandidates(tables, driverId)[0] ?? null;
}

/**
 * Carros de destaque candidatos, em ordem: a importação fica com o primeiro que tiver foto que possa ir ao fundo
 * do heading (sem CC BY-SA). Um carro sem foto compatível não deixa o piloto sem fundo.
 *
 * 1. a temporada de título com mais vitórias (`highlightSeason`);
 * 2. as demais temporadas de título, na mesma ordem;
 * 3. a temporada com mais vitórias (sem vitória, a melhor posição no campeonato);
 * 4. a temporada atual (a última da carreira), na equipe atual — para quem está no grid, ela vem primeiro.
 */
export function highlightCandidates(tables: F1dbTables, driverId: string): Highlight[] {
  const seasons = rowsOf(tables, 'season_driver').filter((r) => str(r.driver_id) === driverId);
  if (!seasons.length) return [];
  const titles = new Set(
    rowsOf(tables, 'season_driver_standing')
      .filter((r) => str(r.driver_id) === driverId && int(r.championship_won) === 1)
      .map((r) => int(r.year)),
  );
  const wins = (r: (typeof seasons)[number]) => int(r.total_race_wins) ?? 0;
  const starts = (r: (typeof seasons)[number]) => int(r.total_race_starts) ?? 0;
  const ranked = (pool: typeof seasons) =>
    [...pool].sort(
      (a, b) =>
        wins(b) - wins(a) ||
        wins(b) / Math.max(1, starts(b)) - wins(a) / Math.max(1, starts(a)) ||
        (int(a.position_number) ?? 999) - (int(b.position_number) ?? 999) ||
        (int(b.year) ?? 0) - (int(a.year) ?? 0),
    );
  const latest = [...seasons].sort((a, b) => (int(b.year) ?? 0) - (int(a.year) ?? 0)).slice(0, 1);
  // quem está no grid: a temporada atual primeiro (o heading mostra a equipe de hoje)
  const onGrid = latest.length > 0 && int(latest[0]!.year) === lastSeason(tables);
  const order = [
    ...(onGrid ? latest.map((r) => ({ r, current: true })) : []),
    ...ranked(seasons.filter((r) => titles.has(int(r.year)))).map((r) => ({ r, current: false })),
    ...ranked(seasons.filter((r) => !titles.has(int(r.year))))
      .slice(0, 1)
      .map((r) => ({ r, current: false })),
    ...latest.map((r) => ({ r, current: true })),
  ];
  const out: Highlight[] = [];
  for (const { r, current } of order) {
    const year = int(r.year)!;
    const team = teamOf(tables, driverId, year);
    if (!team || out.some((h) => h.year === year)) continue;
    const w = wins(r);
    const s = starts(r);
    const reason = titles.has(year)
      ? `título de ${year} · ${w} vitória(s) em ${s} corrida(s)`
      : current
        ? `${year === lastSeason(tables) ? 'temporada atual' : 'última temporada'}: ${year}`
        : w > 0
          ? `${w} vitória(s) em ${s} corrida(s) em ${year}`
          : `melhor temporada: ${str(r.position_text) ?? '?'}º em ${year}`;
    out.push({ target: `car/${team.constructorId}/${year}`, year, reason, entrant: team.entrant });
  }
  return out;
}

/** Última temporada do F1DB (a atual). */
export const lastSeason = (tables: F1dbTables) =>
  Math.max(...rowsOf(tables, 'season_entrant_driver').map((r) => int(r.year) ?? 0));

/**
 * Equipe do piloto na temporada: o construtor de mais rodadas (Moss 1958: Vanwall, não a Cooper da primeira
 * corrida; Lawson 2026: Racing Bulls, não a Red Bull de três corridas), sem as inscrições só de teste, e a equipe
 * inscrita (entrant) de mais rodadas com esse construtor.
 */
export function teamOf(
  tables: F1dbTables,
  driverId: string,
  year: number,
): { constructorId: string; entrant: string | null } | null {
  const rows = rowsOf(tables, 'season_entrant_driver').filter(
    (r) => int(r.year) === year && str(r.driver_id) === driverId && !int(r.test_driver),
  );
  const most = (key: (r: (typeof rows)[number]) => string | null, of: typeof rows) => {
    const rounds = new Map<string, number>();
    for (const r of of) {
      const k = key(r);
      if (k) rounds.set(k, (rounds.get(k) ?? 0) + (str(r.rounds)?.split(';').length ?? 1));
    }
    return [...rounds].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const constructorId = most((r) => str(r.constructor_id), rows);
  if (!constructorId) return null;
  const entrant = most(
    (r) => str(r.entrant_id),
    rows.filter((r) => str(r.constructor_id) === constructorId),
  );
  return { constructorId, entrant };
}

/** Sobrenome para casar com o título da foto: sem "Jr."/"Sr." ("Sainz Jr." → "Sainz"). */
export function surname(lastName: string): string {
  return lastName.replace(/[,\s]+(jr|sr|ii|iii)\.?$/i, '').trim();
}
