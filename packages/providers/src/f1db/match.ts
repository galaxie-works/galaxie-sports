/**
 * Casamento do F1DB com a F1 que já está no core (vinda da api-sports): o mesmo piloto, construtor, circuito e
 * sessão viram uma entidade só, via `core.provider_map` (provider `f1db`). Puro: recebe as tabelas do release e
 * um retrato do core, devolve os vínculos novos e um relatório.
 *
 * Ordem, do mais seguro ao menos seguro:
 * 1. **Corrida**: a sessão `Race` da outra fonte no mesmo dia (±1, por causa do fuso) do GP do F1DB. Nesse GP as
 *    demais sessões casam pelo tipo (TL1–3, sprint); o GP fica **coberto**: o F1DB não cria sessões nele.
 * 2. **Pilotos e construtores pela classificação**: nas corridas casadas, a mesma posição final é o mesmo piloto
 *    (conferido pelo sobrenome), e a equipe dele nas duas fontes é o mesmo construtor.
 * 3. **Pelo nome**, só para quem sobrou e com candidato único: pilotos (nome ou código + sobrenome), construtores
 *    da era da outra fonte (2010 em diante) e circuitos (nome, nomes antigos ou cidade).
 * Vínculos `f1db` que já existem no core são respeitados e nunca refeitos.
 */
import { raceSessionKey } from '../event/race-session.js';
import {
  F1DB_SESSION_TYPES,
  f1dbDriverId,
  f1dbEventId,
  groupBy,
  int,
  plainName,
  rowsOf,
  str,
  type F1dbRow,
  type F1dbTables,
} from './tables.js';

/** Entidade da outra fonte já no core. */
export interface CoreEntityRef {
  /** ID do provedor de origem (ex.: api-sports `driver-25`, `3`). */
  providerId: string;
  /** UUID no core. */
  entityId: string;
  name: string;
}

export interface CoreParticipantRef extends CoreEntityRef {
  kind: string | null;
  code: string | null;
}

export interface CoreVenueRef extends CoreEntityRef {
  city: string | null;
}

/** Sessão de corrida da outra fonte, com a classificação (para casar pilotos e equipes). */
export interface CoreRaceEvent {
  entityId: string;
  startsAt: Date;
  /** Texto do tipo da sessão no provedor ("Race", "1st Practice"...). */
  sessionType: string | null;
  /** Rótulo da fase (GP) e ano da temporada: as sessões do mesmo GP. */
  stageLabel: string | null;
  seasonYear: number | null;
  venueProviderId: string | null;
  results: { participantProviderId: string; position: number | null; teamProviderId: string | null }[];
}

export interface CoreF1Snapshot {
  participants: CoreParticipantRef[];
  venues: CoreVenueRef[];
  events: CoreRaceEvent[];
  /** Vínculos `f1db` já gravados: ID do F1DB → UUID. */
  linked: {
    participants: Map<string, string>;
    venues: Map<string, string>;
    events: Map<string, string>;
  };
}

export interface F1dbLinks {
  /** ID do F1DB (pilotos com `driver-`) → UUID do core: existentes + novos. */
  participants: Map<string, string>;
  venues: Map<string, string>;
  events: Map<string, string>;
  /** Corridas do F1DB (id) cujo GP já está no core pela outra fonte: o F1DB não cria sessões nelas. */
  coveredRaces: Set<string>;
  /** Fase (GP) da outra fonte por GP do F1DB (`grand_prix_id`): o mesmo GP usa o mesmo rótulo. */
  stageLabels: Map<string, string>;
  /** Só os vínculos novos desta execução (vão para o `provider_map`). */
  created: {
    participants: { providerId: string; entityId: string }[];
    venues: { providerId: string; entityId: string }[];
    events: { providerId: string; entityId: string }[];
  };
  report: MatchReport;
}

export interface MatchReport {
  racesMatched: number;
  sessionsMatched: number;
  drivers: { byResults: number; byName: number };
  constructors: { byResults: number; byName: number };
  venues: { byRaces: number; byName: number };
  /** Entidades da outra fonte que ficaram sem par (o F1DB cria a sua). */
  unmatched: { drivers: string[]; constructors: string[]; venues: string[] };
  /** Pares recusados (sobrenome diferente, votos divididos, candidato ambíguo). */
  conflicts: string[];
  /** Pares feitos pelo nome (para conferência: `piloto "Sergio Perez" → driver-sergio-perez`). */
  named: string[];
}

const DAY_MS = 86_400_000;
const STOP = new Set([
  'circuit',
  'circuito',
  'international',
  'internacional',
  'internazionale',
  'autodromo',
  'grand',
  'prix',
  'racing',
  'race',
  'course',
  'street',
  'park',
  'de',
  'do',
  'da',
  'del',
  'di',
  'the',
  'of',
  'and',
  'e',
  'y',
  'team',
  'f1',
  'formula',
  'one',
  '1',
]);

const tokens = (v: string | null | undefined) =>
  plainName(v)
    .split(' ')
    .filter((t) => t && !STOP.has(t));
/** "Carlos Sainz Jr" → "carlos sainz" (sufixos fora). */
const personName = (v: string | null | undefined) =>
  plainName(v)
    .split(' ')
    .filter((t) => t && t !== 'jr' && t !== 'sr' && t !== 'ii' && t !== 'iii')
    .join(' ');

/** Sobrenome compatível: o último nome de um aparece no outro (cobre "Zhou Guanyu" × "Guanyu Zhou"). */
function sameSurname(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = personName(a).split(' ');
  const pb = personName(b).split(' ');
  return pa.some((t) => t.length > 1 && t === pb[pb.length - 1]) || pb.some((t) => t === pa[pa.length - 1]);
}

/** Vota `a → b`; o par vence se for maioria absoluta dos votos de `a`. */
class Votes {
  private readonly votes = new Map<string, Map<string, number>>();
  add(a: string, b: string) {
    const m = this.votes.get(a) ?? new Map<string, number>();
    m.set(b, (m.get(b) ?? 0) + 1);
    this.votes.set(a, m);
  }
  /** O mais votado de `a` e os demais com pelo menos dois votos, do mais votado ao menos votado. */
  strong(a: string): string[] {
    const m = this.votes.get(a);
    if (!m) return [];
    return [...m.entries()]
      .sort((x, y) => y[1] - x[1])
      .filter(([, n], i) => i === 0 || n >= 2)
      .map(([b]) => b);
  }
  keys(): string[] {
    return [...this.votes.keys()];
  }
  winners(conflicts: string[], label: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const [a, m] of this.votes) {
      const total = [...m.values()].reduce((s, n) => s + n, 0);
      const [best, n] = [...m.entries()].sort((x, y) => y[1] - x[1])[0]!;
      if (n * 2 > total) out.set(a, best);
      else conflicts.push(`${label} ${a}: votos divididos (${[...m.keys()].join(', ')})`);
    }
    return out;
  }
}

export function matchF1db(tables: F1dbTables, core: CoreF1Snapshot): F1dbLinks {
  const report: MatchReport = {
    racesMatched: 0,
    sessionsMatched: 0,
    drivers: { byResults: 0, byName: 0 },
    constructors: { byResults: 0, byName: 0 },
    venues: { byRaces: 0, byName: 0 },
    unmatched: { drivers: [], constructors: [], venues: [] },
    conflicts: [],
    named: [],
  };
  const links: F1dbLinks = {
    participants: new Map(core.linked.participants),
    venues: new Map(core.linked.venues),
    events: new Map(core.linked.events),
    coveredRaces: new Set(),
    stageLabels: new Map(),
    created: { participants: [], venues: [], events: [] },
    report,
  };
  const taken = {
    participants: new Set(links.participants.values()),
    venues: new Set(links.venues.values()),
    events: new Set(links.events.values()),
  };
  const link = (
    kind: 'participants' | 'venues' | 'events',
    providerId: string,
    entityId: string,
  ): boolean => {
    if (links[kind].has(providerId) || taken[kind].has(entityId)) return false;
    links[kind].set(providerId, entityId);
    taken[kind].add(entityId);
    links.created[kind].push({ providerId, entityId });
    return true;
  };

  const raceData = groupBy(rowsOf(tables, 'race_data'), (r) => str(r.race_id));
  const driversById = new Map(rowsOf(tables, 'driver').map((d) => [str(d.id)!, d]));
  const coreParticipants = new Map(core.participants.map((p) => [p.providerId, p]));

  // ─ 1. corridas: a sessão Race da outra fonte no mesmo dia ─
  const coreRaces = core.events.filter((e) => raceSessionKey(e.sessionType) === 'race');
  const sessionsByStage = groupBy(core.events, (e) =>
    e.stageLabel && e.seasonYear != null ? `${e.seasonYear}|${e.stageLabel}` : null,
  );
  const matchedRaces: { race: F1dbRow; core: CoreRaceEvent }[] = [];
  for (const race of rowsOf(tables, 'race')) {
    const date = str(race.date);
    if (!date) continue;
    const day = new Date(`${date}T12:00:00Z`).getTime();
    const hits = coreRaces.filter((e) => Math.abs(e.startsAt.getTime() - day) <= 1.5 * DAY_MS);
    if (!hits.length) continue;
    if (hits.length > 1) {
      report.conflicts.push(
        `corrida ${str(race.year)}/${str(race.round)}: ${hits.length} corridas no mesmo dia`,
      );
      continue;
    }
    const hit = hits[0]!;
    const raceId = str(race.id)!;
    matchedRaces.push({ race, core: hit });
    links.coveredRaces.add(raceId);
    report.racesMatched += 1;
    const gp = str(race.grand_prix_id);
    if (gp && hit.stageLabel && !links.stageLabels.has(gp)) links.stageLabels.set(gp, hit.stageLabel);
    // demais sessões do GP pelo tipo (a classificação inteira do F1DB não tem par: Q1/Q2/Q3 são sessões à parte)
    const sameGp =
      hit.stageLabel && hit.seasonYear != null
        ? (sessionsByStage.get(`${hit.seasonYear}|${hit.stageLabel}`) ?? [hit])
        : [hit];
    const present = new Set((raceData.get(raceId) ?? []).map((r) => str(r.type)));
    for (const [type, s] of Object.entries(F1DB_SESSION_TYPES)) {
      if (!present.has(type)) continue;
      const same = sameGp.filter((e) => raceSessionKey(e.sessionType) === s.key);
      if (same.length === 1 && link('events', f1dbEventId(raceId, s.key), same[0]!.entityId))
        report.sessionsMatched += 1;
    }
  }

  // ─ 2. pilotos e construtores pela classificação das corridas casadas ─
  const driverVotes = new Votes();
  const teamVotes = new Votes();
  for (const { race, core: hit } of matchedRaces) {
    const byPosition = new Map(
      hit.results.filter((r) => r.position != null).map((r) => [r.position!, r] as const),
    );
    for (const row of raceData.get(str(race.id)!) ?? []) {
      if (str(row.type) !== 'RACE_RESULT') continue;
      const pos = int(row.position_number);
      const driverId = str(row.driver_id);
      const other = pos != null ? byPosition.get(pos) : undefined;
      if (!other || !driverId) continue;
      const theirs = coreParticipants.get(other.participantProviderId);
      const ours = driversById.get(driverId);
      if (!theirs || !ours) continue;
      if (!sameSurname(str(ours.name), theirs.name)) {
        report.conflicts.push(`piloto ${driverId} × ${theirs.name}: sobrenome diferente na mesma posição`);
        continue;
      }
      driverVotes.add(f1dbDriverId(driverId), theirs.providerId);
      const constructorId = str(row.constructor_id);
      if (constructorId && other.teamProviderId && coreParticipants.has(other.teamProviderId))
        teamVotes.add(constructorId, other.teamProviderId);
    }
  }
  for (const [f1dbId, providerId] of driverVotes.winners(report.conflicts, 'piloto'))
    if (link('participants', f1dbId, coreParticipants.get(providerId)!.entityId))
      report.drivers.byResults += 1;
  // a outra fonte às vezes divide a mesma equipe em dois IDs no ano (Kick Sauber 2024: "Sauber F1 Team" e
  // "Stake F1 Team Kick Sauber"): entre os candidatos fortes, vence o de nome mais parecido, depois o mais votado
  const constructorsById = new Map(rowsOf(tables, 'constructor').map((c) => [str(c.id)!, c]));
  const nameScore = (constructorId: string, providerId: string) => {
    const c = constructorsById.get(constructorId);
    const theirs = new Set(tokens(coreParticipants.get(providerId)?.name));
    const ours = new Set([...tokens(str(c?.name)), ...tokens(str(c?.full_name))]);
    return [...ours].filter((t) => theirs.has(t)).length;
  };
  for (const f1dbId of teamVotes.keys()) {
    const candidates = teamVotes
      .strong(f1dbId)
      .filter((pid) => !taken.participants.has(coreParticipants.get(pid)!.entityId));
    const best = candidates
      .map((pid, i) => ({ pid, score: nameScore(f1dbId, pid), i }))
      .sort((a, b) => b.score - a.score || a.i - b.i)[0];
    if (best && link('participants', f1dbId, coreParticipants.get(best.pid)!.entityId))
      report.constructors.byResults += 1;
  }

  // ─ 3. pelo nome, candidato único: primeiro só os nomes exatos, depois as demais regras ─
  const byName = <T extends { entityId: string; name: string }>(spec: {
    what: string;
    kind: 'participants' | 'venues';
    items: T[];
    /** Linhas do F1DB ainda livres. */
    free: () => F1dbRow[];
    providerId: (row: F1dbRow) => string;
    /** Regras em ordem de confiança; a primeira é a do nome exato. */
    tiers: (item: T, free: F1dbRow[]) => F1dbRow[][];
    count: () => void;
    unmatched: string[];
  }) => {
    for (const pass of [0, 1])
      for (const item of spec.items) {
        if (taken[spec.kind].has(item.entityId)) continue;
        const tiers = spec.tiers(item, spec.free());
        const list = pass === 0 ? tiers[0]! : (tiers.find((t) => t.length) ?? []);
        if (list.length !== 1) {
          if (pass === 1 && list.length > 1)
            report.conflicts.push(`${spec.what} ${item.name}: ${list.length} candidatos`);
          if (pass === 1) spec.unmatched.push(item.name);
          continue;
        }
        const id = spec.providerId(list[0]!);
        if (link(spec.kind, id, item.entityId)) {
          spec.count();
          report.named.push(`${spec.what} "${item.name}" → ${id}`);
        }
      }
  };

  byName({
    what: 'piloto',
    kind: 'participants',
    items: core.participants.filter((x) => x.kind === 'driver'),
    free: () => rowsOf(tables, 'driver').filter((d) => !links.participants.has(f1dbDriverId(str(d.id)!))),
    providerId: (d) => f1dbDriverId(str(d.id)!),
    tiers: (p, free) => {
      const name = personName(p.name);
      const code = (p.code ?? '').toUpperCase();
      return [
        free.filter((d) =>
          [str(d.name), str(d.full_name), `${str(d.first_name)} ${str(d.last_name)}`].some(
            (n) => personName(n) === name,
          ),
        ),
        code ? free.filter((d) => str(d.abbreviation) === code && sameSurname(str(d.name), p.name)) : [],
      ];
    },
    count: () => (report.drivers.byName += 1),
    unmatched: report.unmatched.drivers,
  });

  // construtores e circuitos: só os da era da outra fonte (de 2010 em diante; ela começa em 2012)
  const modernConstructors = new Set(
    rowsOf(tables, 'season_constructor')
      .filter((r) => (int(r.year) ?? 0) >= 2010)
      .map((r) => str(r.constructor_id)),
  );
  byName({
    what: 'construtor',
    kind: 'participants',
    items: core.participants.filter((x) => x.kind === 'constructor'),
    free: () =>
      rowsOf(tables, 'constructor').filter(
        (c) => modernConstructors.has(str(c.id)) && !links.participants.has(str(c.id)!),
      ),
    providerId: (c) => str(c.id)!,
    tiers: (p, free) => {
      const plain = plainName(p.name);
      // "Audi Revolut F1 Team" ⊃ "Audi": todas as palavras do nome curto do F1DB estão no nome da outra fonte
      const theirs = new Set(tokens(p.name));
      return [
        free.filter((c) => [str(c.name), str(c.full_name)].some((n) => plainName(n) === plain)),
        free.filter((c) => {
          const t = tokens(str(c.name));
          return t.length > 0 && t.every((x) => theirs.has(x));
        }),
      ];
    },
    count: () => (report.constructors.byName += 1),
    unmatched: report.unmatched.constructors,
  });

  // O F1DB divide em construtores diferentes uma equipe que a outra fonte mantém numa só (RB 2024–25 →
  // Racing Bulls 2026): construtor recente ainda sem par, com o nome exato de um da outra fonte, vira a mesma
  // entidade, mesmo que ela já tenha par.
  for (const c of rowsOf(tables, 'constructor')) {
    const id = str(c.id)!;
    if (!modernConstructors.has(id) || links.participants.has(id)) continue;
    const ours = new Set([plainName(str(c.name)), plainName(str(c.full_name))]);
    const same = core.participants.filter((p) => p.kind === 'constructor' && ours.has(plainName(p.name)));
    if (same.length !== 1) continue;
    links.participants.set(id, same[0]!.entityId);
    links.created.participants.push({ providerId: id, entityId: same[0]!.entityId });
    report.constructors.byName += 1;
    report.named.push(`construtor "${same[0]!.name}" → ${id} (mesma equipe com outro nome no F1DB)`);
  }

  // ─ circuitos: pela corrida casada, depois pelo nome ou cidade ─
  const venuesByProvider = new Map(core.venues.map((v) => [v.providerId, v]));
  for (const { race, core: hit } of matchedRaces) {
    const circuitId = str(race.circuit_id);
    const v = hit.venueProviderId ? venuesByProvider.get(hit.venueProviderId) : undefined;
    if (circuitId && v && link('venues', circuitId, v.entityId)) report.venues.byRaces += 1;
  }
  const modernCircuits = new Set(
    rowsOf(tables, 'race')
      .filter((r) => (int(r.year) ?? 0) >= 2010)
      .map((r) => str(r.circuit_id)),
  );
  const circuitNames = (c: F1dbRow) => [
    str(c.name),
    str(c.full_name),
    ...(str(c.previous_names)?.split(/[;,]/) ?? []),
  ];
  byName({
    what: 'circuito',
    kind: 'venues',
    items: core.venues,
    free: () => rowsOf(tables, 'circuit').filter((c) => !links.venues.has(str(c.id)!)),
    providerId: (c) => str(c.id)!,
    tiers: (v, free) => {
      const plain = plainName(v.name);
      // todas as palavras de um nome cabem no outro ("Intercity Istanbul Park" ⊃ "Istanbul Park")
      const theirs = tokens(v.name);
      const theirSet = new Set(theirs);
      const city = plainName(v.city);
      return [
        free.filter((c) => circuitNames(c).some((n) => plainName(n) === plain)),
        free.filter((c) => {
          const ours = circuitNames(c).map((n) => tokens(n));
          const all = new Set(ours.flat());
          return (
            (theirs.length > 0 && theirs.every((t) => all.has(t))) ||
            ours.some((t) => t.length > 0 && t.every((x) => theirSet.has(x)))
          );
        }),
        // mesma cidade, entre os circuitos da era da outra fonte (Madri: Madring, não Jarama)
        city
          ? free.filter((c) => modernCircuits.has(str(c.id)) && plainName(str(c.place_name)) === city)
          : [],
      ];
    },
    count: () => (report.venues.byName += 1),
    unmatched: report.unmatched.venues,
  });

  return links;
}
