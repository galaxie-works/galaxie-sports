/**
 * O que cada jogador da escalação fez no jogo, cruzando `GET /v1/events/{id}/lineups` com o minuto a
 * minuto (`/timeline`): gols, gols contra, assistências, cartões e substituição, com o minuto de cada um.
 * Alimenta os ícones do campo, do banco e da lista. A disputa de pênaltis não conta (não é gol do jogo).
 */
import type { EventTimeline, TimelinePerson } from '@galaxie/contracts';

export interface PlayerMarks {
  /** Minutos dos gols (pênalti incluído). */
  goals: string[];
  ownGoals: string[];
  assists: string[];
  yellow: string | null;
  secondYellow: string | null;
  red: string | null;
  /** Minuto em que saiu (titular substituído). */
  subOut: string | null;
  /** Minuto em que entrou (reserva que jogou). */
  subIn: string | null;
}

const empty = (): PlayerMarks => ({
  goals: [],
  ownGoals: [],
  assists: [],
  yellow: null,
  secondYellow: null,
  red: null,
  subOut: null,
  subIn: null,
});

type PersonLike = { id: string | null; name: string };

/** Pelo ID do core; sem ID (pessoa fora do core), pelo nome. */
const keyOf = (p: PersonLike) => (p.id ? `id:${p.id}` : `name:${p.name.trim().toLowerCase()}`);

export type MarksLookup = (person: PersonLike) => PlayerMarks | null;

export function lineupMarks(timeline: EventTimeline | null | undefined): MarksLookup {
  const byKey = new Map<string, PlayerMarks>();
  const at = (p: TimelinePerson | null) => {
    if (!p || (!p.id && !p.name)) return null;
    const k = keyOf(p);
    let m = byKey.get(k);
    if (!m) byKey.set(k, (m = empty()));
    return m;
  };
  for (const i of timeline?.incidents ?? []) {
    if (i.clock.period === 'penalty_shootout') continue;
    const minute = i.clock.display ?? (i.minute != null ? `${i.minute}'` : '');
    switch (i.kind) {
      case 'goal':
      case 'penalty_goal': {
        at(i.player)?.goals.push(minute);
        at(i.assist)?.assists.push(minute);
        break;
      }
      case 'own_goal':
        at(i.player)?.ownGoals.push(minute);
        break;
      case 'yellow_card': {
        const m = at(i.player);
        if (m) m.yellow ??= minute;
        break;
      }
      case 'second_yellow': {
        const m = at(i.player);
        if (m) m.secondYellow = minute;
        break;
      }
      case 'red_card': {
        const m = at(i.player);
        if (m) m.red = minute;
        break;
      }
      case 'substitution': {
        const out = at(i.player_out);
        if (out) out.subOut = minute;
        const inn = at(i.player_in);
        if (inn) inn.subIn = minute;
        break;
      }
      default:
        break;
    }
  }
  return (person) => byKey.get(keyOf(person)) ?? null;
}

/**
 * Nome curto para o campo: até duas palavras fica como está ("Thiago Silva", "J. López"); nomes de
 * registro longos ("Hércules Pereira do Nascimento") ficam com a primeira palavra. O nome completo
 * continua no `title` e na lista.
 */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length <= 2 ? parts.join(' ') : parts[0]!;
}

/** Linhas do campo a partir do `grid` "linha:coluna" (goleiro `1:1`); sem grid, fica de fora. */
export function pitchRows<T extends { grid: string | null }>(players: readonly T[]): T[][] {
  const rows = new Map<number, { col: number; p: T }[]>();
  for (const p of players) {
    const m = /^(\d+):(\d+)$/.exec(p.grid ?? '');
    if (!m) continue;
    const row = Number(m[1]);
    rows.set(row, [...(rows.get(row) ?? []), { col: Number(m[2]), p }]);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, list]) => list.sort((a, b) => a.col - b.col).map((x) => x.p));
}
