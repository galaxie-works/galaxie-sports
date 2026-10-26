/**
 * Tabelas de temporada com mais de uma fase (Apertura/Clausura, 1ª fase + 2ª fase, zonas Norte/Sul, ligas
 * A/B/C/D da Nations League). A fase vem do rótulo da rodada no fornecedor ("Apertura - 7" → "Apertura");
 * rodada sem número ("Apertura - Final", "Round of 16") é mata-mata e não entra em tabela.
 *
 * - Cada fase tem a própria tabela, só com os jogos dela. Grupo do fornecedor ("Apertura - Group A") é
 *   ligado à fase pelo nome; sem o nome da fase, à fase em que os times do grupo jogam (quase) só entre si.
 *   Grupo que não fecha em nenhuma fase (o de rebaixamento antes de começar) fica como está.
 * - Fase sem grupo do fornecedor vira uma tabela com o nome da fase. A 1ª fase de nome genérico
 *   ("Regular Season", "1st Phase") vira `first_phase`, que a demo mostra como "1ª fase".
 * - Duas ou mais fases com (quase) todos os times: soma delas em `annual` ("Tabela anual"), ou no grupo do
 *   fornecedor que já é a tabela anual ("Primera B: Tabla Anual").
 * - Times de uma fase que ficaram sem grupo do fornecedor quando os outros têm (o fornecedor mandou só parte
 *   dos grupos): os grupos são deduzidos dos jogos entre eles e viram `unnamed:1`, `unnamed:2`...
 *
 * - Jogo entre grupos da mesma fase (interzonal da Argentina) conta na tabela do grupo de cada time.
 *
 * Cada conjunto devolvido vai numa chamada própria do motor: o mesmo time aparece em várias tabelas e o
 * desempate por confronto direto só pode ver os jogos daquela tabela.
 */
import type { MatchResult } from '@galaxie/rules';

/** Grupos de nome reservado, traduzidos na demo. */
export const ANNUAL_GROUP = 'annual';
export const FIRST_PHASE_GROUP = 'first_phase';
export const UNNAMED_GROUP_PREFIX = 'unnamed:';

/** Fase com pelo menos esta fração dos times da temporada entra na tabela anual. */
const FULL_PHASE_SHARE = 0.8;
/** Grupo sem o nome da fase: só é ligado à fase em que os times dele jogam (quase) só entre si. */
const CLOSED_GROUP_SHARE = 0.85;
const ANNUAL_NAME = /\b(tabla anual|annual|acumulad[ao]|aggregate|reclasificaci[oó]n)\b/i;
const GENERIC_FIRST_PHASE = /^(regular season|1st phase|first (phase|stage)|fase regular)$/i;

/** "Apertura - 7" → "Apertura"; rodada sem número (mata-mata) → null. */
export function phaseOfRound(label: string | null | undefined): string | null {
  const m = /^(.*\S)\s+-\s+\d+$/.exec(label?.trim() ?? '');
  return m ? m[1]! : null;
}

/** Uma chamada do motor: os jogos e, quando há jogo entre grupos, o grupo de cada time. */
export interface TableSet {
  matches: MatchResult[];
  teams?: { teamId: string; group: string }[];
}

export type PhasePlan =
  { kind: 'single' } | { kind: 'error'; detail: string } | { kind: 'multi'; sets: TableSet[] };

/** Para comparar nome de grupo e de fase: sem caixa nem pontuação ("Apertura - Quadrangular" = "Apertura Quadrangular"). */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Plano das tabelas de uma temporada. `single`: uma fase só (ou nenhuma rodada numerada), o recálculo segue
 * o caminho de sempre. Cada resultado traz `roundLabel`, o rótulo da rodada ("Apertura - 7"). `groupsOfTeam`:
 * grupos com nome de cada time já gravados em core.standing.
 */
export function planPhases(
  results: readonly (MatchResult & { roundLabel: string | null })[],
  groupsOfTeam: ReadonlyMap<string, ReadonlySet<string>>,
): PhasePlan {
  const byPhase = new Map<string, MatchResult[]>();
  for (const r of results) {
    const phase = phaseOfRound(r.roundLabel);
    if (phase === null) continue;
    const list = byPhase.get(phase) ?? [];
    list.push(r);
    byPhase.set(phase, list);
  }
  if (byPhase.size < 2) return { kind: 'single' };

  const firstAt = (ms: MatchResult[]) =>
    ms.reduce((min, m) => (m.playedAt && m.playedAt < min ? m.playedAt : min), '~');
  const phases = [...byPhase.keys()].sort((a, b) =>
    firstAt(byPhase.get(a)!).localeCompare(firstAt(byPhase.get(b)!)),
  );
  const teamsOf = new Map(phases.map((p) => [p, teamsIn(byPhase.get(p)!)]));
  const allTeams = new Set(phases.flatMap((p) => [...teamsOf.get(p)!]));

  // grupos do fornecedor → fase (ou a tabela anual)
  const members = new Map<string, Set<string>>();
  for (const [team, groups] of groupsOfTeam)
    for (const g of groups) {
      if (g === '') continue;
      const set = members.get(g) ?? new Set<string>();
      set.add(team);
      members.set(g, set);
    }
  let annualName: string | null = null;
  // times de grupo do fornecedor que não fechou em nenhuma fase
  const stranded: string[] = [];
  const groupsOfPhase = new Map<string, string[]>(phases.map((p) => [p, []]));
  for (const [group, teams] of members) {
    if (ANNUAL_NAME.test(group)) {
      annualName ??= group;
      continue;
    }
    const byName = phases
      .filter((p) => ` ${norm(group)} `.includes(` ${norm(p)} `))
      .sort((a, b) => b.length - a.length)[0];
    const phase =
      byName ??
      phases
        .map((p) => {
          const involving = byPhase.get(p)!.filter((m) => teams.has(m.homeId) || teams.has(m.awayId));
          const inside = involving.filter((m) => teams.has(m.homeId) && teams.has(m.awayId)).length;
          return { p, share: involving.length ? inside / involving.length : 0, inside };
        })
        .filter((x) => x.share >= CLOSED_GROUP_SHARE)
        .sort((a, b) => b.share - a.share || b.inside - a.inside)[0]?.p;
    if (phase) groupsOfPhase.get(phase)!.push(group);
    else stranded.push(...teams);
  }

  const sets: TableSet[] = [];
  let unnamed = 0;
  for (const [i, phase] of phases.entries()) {
    const matches = byPhase.get(phase)!;
    const groups = groupsOfPhase.get(phase)!;
    if (!groups.length) {
      const label = i === 0 && GENERIC_FIRST_PHASE.test(phase) ? FIRST_PHASE_GROUP : phase;
      sets.push({ matches: matches.map((m) => ({ ...m, group: label })) });
      continue;
    }
    const groupOf = new Map<string, string>();
    for (const g of groups)
      for (const team of members.get(g)!) {
        if (!teamsOf.get(phase)!.has(team)) continue;
        const prev = groupOf.get(team);
        if (prev !== undefined)
          return {
            kind: 'error',
            detail: `time em mais de um grupo da fase ${phase} (${[prev, g].sort().join(', ')})`,
          };
        groupOf.set(team, g);
      }
    // times sem grupo do fornecedor: grupos deduzidos pelos jogos entre eles
    // fase com time de grupo do fornecedor que não fechou: os grupos dela não são confiáveis para deduzir
    const doubtful = stranded.some((t) => teamsOf.get(phase)!.has(t));
    const loose = doubtful ? [] : [...teamsOf.get(phase)!].filter((t) => !groupOf.has(t));
    for (const component of components(loose, matches)) {
      const name = `${UNNAMED_GROUP_PREFIX}${++unnamed}`;
      for (const t of component) groupOf.set(t, name);
    }
    sets.push(groupedSet(matches, groupOf));
  }

  const full = phases.filter((p) => teamsOf.get(p)!.size >= FULL_PHASE_SHARE * allTeams.size);
  if (full.length >= 2) {
    const name = annualName ?? ANNUAL_GROUP;
    sets.push({ matches: full.flatMap((p) => byPhase.get(p)!.map((m) => ({ ...m, group: name }))) });
  }
  return { kind: 'multi', sets: sets.filter((s) => s.matches.length > 0) };
}

/**
 * Jogos de uma fase dividida em grupos: o jogo dentro do grupo vai para ele; o jogo entre dois grupos
 * (interzonal) conta na tabela de cada time (`crossGroup`). Jogo com time sem grupo fica de fora.
 */
export function groupedSet(matches: readonly MatchResult[], groupOf: ReadonlyMap<string, string>): TableSet {
  const out: MatchResult[] = [];
  for (const m of matches) {
    const home = groupOf.get(m.homeId);
    const away = groupOf.get(m.awayId);
    if (home === undefined || away === undefined) continue;
    out.push(home === away ? { ...m, group: home } : { ...m, group: home, crossGroup: true });
  }
  return { matches: out, teams: [...groupOf].map(([teamId, group]) => ({ teamId, group })) };
}

function teamsIn(matches: readonly MatchResult[]): Set<string> {
  const out = new Set<string>();
  for (const m of matches) out.add(m.homeId).add(m.awayId);
  return out;
}

/** Componentes conexos do grafo de jogos entre `teams`, em ordem estável (pelo menor id). */
export function components(teams: readonly string[], matches: readonly MatchResult[]): string[][] {
  const pool = new Set(teams);
  const adj = new Map<string, Set<string>>(teams.map((t) => [t, new Set<string>()]));
  for (const m of matches)
    if (pool.has(m.homeId) && pool.has(m.awayId)) {
      adj.get(m.homeId)!.add(m.awayId);
      adj.get(m.awayId)!.add(m.homeId);
    }
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const start of [...teams].sort()) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const t = stack.pop()!;
      comp.push(t);
      for (const n of adj.get(t)!) {
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    out.push(comp);
  }
  return out;
}
