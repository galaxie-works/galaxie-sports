import type { LeagueRules, PointsRule } from '../config/types.js';
import type { TeamId } from '../standings/types.js';
import type { Stake, StakeFamily, StakeSide } from './codes.js';
import { isBadZone, type LeagueTeamInput } from './league.js';

/**
 * Saliência dos stakes de pontos corridos: dos códigos matemáticos (todos verdadeiros), quais valem a
 * pena mostrar para cada time. Os stakes não mudam; esta camada só escolhe e ordena.
 *
 * 1. **Briga** de cada código: título, rebaixamento, eliminação, uma zona boa (vaga, acesso) ou a tabela
 *    (posição). Mata-mata e demais códigos passam direto, sem corte nem limite.
 * 2. **Corte do improvável**: o código só fica se a distância do time para a briga, em pontos, cabe na
 *    janela `max(SALIENCE_MIN_GAP, SALIENCE_FRACTION × pontos em disputa)`, com pontos em disputa =
 *    jogos restantes do time × pontos da vitória. Distância: título = pontos atrás do líder;
 *    rebaixamento/eliminação = pontos acima do primeiro time dentro da zona (0 se já está nela);
 *    zona boa = pontos atrás do último time dentro dela (0 se já está nela). Com 7 jogos restantes
 *    (21 pontos em disputa), a janela é de 7 pontos: o 2º colocado a 34 pontos do Z4 não "corre risco
 *    de rebaixamento", e o 12º a 15 pontos do G4 não "ainda pode garantir a Libertadores".
 * 3. **Piso superado**: `qualifies_for_zone` ("garante ao menos a Sul-Americana") e `safe_from_relegation`
 *    saem quando o time tem outro código saliente de título ou de zona melhor.
 * 4. **Ordem e limite**: decididos (matematicamente) > decisivos (desta rodada, ou o que o resultado
 *    mudou) > disputas (possibilidades e distâncias, a mais próxima primeiro) > situação (garantias de
 *    piso e posição); dentro de cada faixa, título > rebaixamento/eliminação > zonas (a melhor primeiro) >
 *    tabela. No máximo `MAX_SALIENT_STAKES` por time.
 */

/** Fração dos pontos em disputa que define a janela de distância (ver o cabeçalho). */
export const SALIENCE_FRACTION = 1 / 3;
/** Janela mínima, em pontos (uma vitória): no fim do campeonato a fração fica pequena demais. */
export const SALIENCE_MIN_GAP = 3;
/** Máximo de códigos salientes por time e por fase (pré-jogo e resultado). */
export const MAX_SALIENT_STAKES = 3;

/** Situação do time na tabela, para medir a distância de cada briga. */
export interface SalienceStanding {
  points: number;
  /** Posição (1 = líder). */
  rank: number;
  /** Jogos restantes do time (null se o regulamento não diz quantos jogos há: sem corte). */
  remaining: number | null;
  /** Pontos de uma vitória. */
  pointsPerWin: number;
  /** Pontos do líder (null em tabela sem título). */
  leaderPoints: number | null;
  /** Primeira posição da zona de rebaixamento e os pontos de quem a ocupa (null sem zona). */
  relegation: { from: number; points: number } | null;
  /** Idem para a zona de eliminação (fase de grupos, fase de liga). */
  elimination: { from: number; points: number } | null;
  /** Zonas boas, da melhor para a pior: última posição e pontos de quem a ocupa. */
  zones: { id: string; to: number; points: number }[];
}

/**
 * Situação de `teamId` na tabela (em ordem de classificação: posição = índice + 1). Time fora da
 * tabela → null (sem corte).
 */
export function salienceStanding(
  table: readonly LeagueTeamInput[],
  league: Pick<LeagueRules, 'matchesPerTeam' | 'title' | 'zones'>,
  teamId: TeamId,
  points: Pick<PointsRule, 'win'> = { win: 3 },
): SalienceStanding | null {
  const i = table.findIndex((t) => t.teamId === teamId);
  if (i < 0) return null;
  const team = table[i]!;
  const pointsAt = (rank: number) => table[rank - 1]?.points;
  const firstOf = (kind: 'relegation' | 'elimination') => {
    const from = Math.min(...league.zones.filter((z) => z.kind === kind).map((z) => z.from));
    const p = Number.isFinite(from) ? pointsAt(from) : undefined;
    return p === undefined ? null : { from, points: p };
  };
  const zones = league.zones
    .filter((z) => !isBadZone(z))
    .sort((a, b) => a.to - b.to)
    .flatMap((z) => {
      const p = pointsAt(z.to);
      return p === undefined ? [] : [{ id: z.id, to: z.to, points: p }];
    });
  return {
    points: team.points,
    rank: i + 1,
    remaining: league.matchesPerTeam === null ? null : Math.max(0, league.matchesPerTeam - team.played),
    pointsPerWin: points.win,
    leaderPoints: league.title ? (table[0]?.points ?? null) : null,
    relegation: firstOf('relegation'),
    elimination: firstOf('elimination'),
    zones,
  };
}

// ─── classificação dos códigos ───────────────────────────────────────────────────────────────────

export type SalienceFight = 'title' | 'relegation' | 'elimination' | 'zone' | 'table' | 'other';
export type SalienceTier = 'decided' | 'decisive' | 'race' | 'standing';

const FIGHT: Partial<Record<StakeFamily, SalienceFight>> = {};
const TIER: Partial<Record<StakeFamily, SalienceTier>> = {};
function classify(fight: SalienceFight, tier: SalienceTier, families: readonly StakeFamily[]) {
  for (const f of families) {
    FIGHT[f] = fight;
    TIER[f] = tier;
  }
}
classify('title', 'decided', ['mathematically_champion', 'clinched_title', 'lost_title_chance']);
classify('title', 'decisive', [
  'clinches_title_with_draw',
  'clinches_title_with_win',
  'can_clinch_title',
  'took_the_lead',
  'lost_the_lead',
]);
classify('title', 'race', [
  'in_title_race',
  'seeks_title_n',
  'points_behind_leader_n',
  'points_ahead_at_top_n',
]);
classify('relegation', 'decided', ['mathematically_relegated', 'relegation_confirmed', 'clinched_safety']);
classify('relegation', 'decisive', [
  'relegated_unless_wins',
  'relegated_if_loses',
  'can_be_relegated',
  'secures_safety_with_draw',
  'secures_safety_with_win',
  'can_secure_safety',
  'dropped_into_relegation',
  'climbed_out_of_relegation',
]);
classify('relegation', 'race', [
  'at_risk_of_relegation',
  'points_above_relegation_n',
  'points_below_safety_n',
]);
classify('relegation', 'standing', ['safe_from_relegation']);
classify('elimination', 'decided', ['mathematically_eliminated', 'elimination_confirmed']);
classify('elimination', 'decisive', [
  'eliminated_unless_wins',
  'eliminated_if_loses',
  'can_be_eliminated',
  'dropped_into_elimination',
  'climbed_out_of_elimination',
]);
classify('elimination', 'race', ['at_risk_of_elimination']);
classify('zone', 'decided', ['clinched_zone', 'lost_zone_chance']);
classify('zone', 'decisive', [
  'clinches_zone_with_draw',
  'clinches_zone_with_win',
  'can_clinch_zone',
  'entered_zone',
  'left_zone',
]);
classify('zone', 'race', ['can_qualify_for_zone', 'points_behind_zone_n']);
classify('zone', 'standing', ['qualifies_for_zone']);
// subir ou cair na tabela é o que o resultado mudou; seguir na mesma posição é só situação
classify('table', 'decisive', ['moved_up_to_n', 'moved_down_to_n']);
classify('table', 'standing', ['stayed_at_n']);

/** Briga a que o código pertence (`other` = fora da saliência: mata-mata e afins). */
export function salienceFight(stake: Pick<Stake, 'family'>): SalienceFight {
  return FIGHT[stake.family] ?? 'other';
}

/** Faixa do código na ordem de saliência (null fora da saliência). */
export function salienceTier(stake: Pick<Stake, 'family'>): SalienceTier | null {
  return TIER[stake.family] ?? null;
}

const TIER_RANK: Record<SalienceTier, number> = { decided: 0, decisive: 1, race: 2, standing: 3 };

/** Janela de distância do time, em pontos (Infinity sem jogos restantes conhecidos). */
export function salienceWindow(standing: SalienceStanding): number {
  if (standing.remaining === null) return Infinity;
  return Math.max(SALIENCE_MIN_GAP, standing.remaining * standing.pointsPerWin * SALIENCE_FRACTION);
}

/** Distância do time, em pontos, para a briga do código (null = sem distância: tabela, mata-mata). */
export function salienceGap(
  stake: Pick<Stake, 'family' | 'params'>,
  standing: SalienceStanding,
): number | null {
  const fight = salienceFight(stake);
  const above = (zone: { from: number; points: number } | null) =>
    !zone || standing.rank >= zone.from ? 0 : Math.max(0, standing.points - zone.points);
  switch (fight) {
    case 'title':
      return standing.leaderPoints === null ? 0 : Math.max(0, standing.leaderPoints - standing.points);
    case 'relegation':
      return above(standing.relegation);
    case 'elimination':
      return above(standing.elimination);
    case 'zone': {
      const z = standing.zones.find((x) => x.id === stake.params?.zone);
      return !z || standing.rank <= z.to ? 0 : Math.max(0, z.points - standing.points);
    }
    default:
      return null;
  }
}

/** O código passa no corte do improvável? Sem `standing`, sim. */
export function isSalient(
  stake: Pick<Stake, 'family' | 'params'>,
  standing: SalienceStanding | null | undefined,
): boolean {
  if (!standing) return true;
  const gap = salienceGap(stake, standing);
  return gap === null || gap <= salienceWindow(standing);
}

export interface SalienceOptions {
  /** Máximo por time (padrão `MAX_SALIENT_STAKES`). */
  max?: number;
}

type Side = Exclude<StakeSide, 'both'>;

/**
 * Os códigos mais relevantes de cada time (ver o cabeçalho do módulo), na ordem de saliência: primeiro
 * os do mandante, depois os do visitante; os demais (`both`, mata-mata, histórico fora de briga) seguem
 * na ordem original, sem corte. Os objetos devolvidos são os mesmos da entrada.
 */
export function salientStakes<T extends Pick<Stake, 'team' | 'family' | 'params'>>(
  stakes: readonly T[],
  standings: Partial<Record<Side, SalienceStanding | null>>,
  options: SalienceOptions = {},
): T[] {
  const max = Math.max(0, options.max ?? MAX_SALIENT_STAKES);
  const others: T[] = [];
  const bySide: Record<Side, { s: T; i: number }[]> = { home: [], away: [] };
  stakes.forEach((s, i) => {
    if (s.team === 'both' || salienceFight(s) === 'other') others.push(s);
    else bySide[s.team].push({ s, i });
  });
  const pick = (side: Side): T[] => {
    const standing = standings[side] ?? null;
    const zoneIndex = (zone: string | undefined) => {
      const i = standing?.zones.findIndex((z) => z.id === zone) ?? -1;
      return i < 0 ? 5 : i;
    };
    const fightRank = (s: T) => {
      const fight = salienceFight(s);
      if (fight === 'title') return 0;
      if (fight === 'relegation' || fight === 'elimination') return 1;
      if (fight === 'zone') return 2 + zoneIndex(s.params?.zone);
      return 9;
    };
    const kept = bySide[side].filter(({ s }) => isSalient(s, standing));
    const floorBeaten = (s: T) => {
      const own = s.family === 'qualifies_for_zone' ? zoneIndex(s.params?.zone) : Infinity;
      return kept.some(({ s: o }) => {
        if (o === s) return false;
        const fight = salienceFight(o);
        if (fight === 'title') return true;
        return fight === 'zone' && o.family !== 'qualifies_for_zone' && zoneIndex(o.params?.zone) < own;
      });
    };
    const window = standing ? salienceWindow(standing) : Infinity;
    const key = ({ s, i }: { s: T; i: number }) => {
      const tier = salienceTier(s)!;
      // disputas e situação: a briga mais próxima primeiro (até metade da janela conta como "perto")
      const gap = standing ? salienceGap(s, standing) : null;
      const far = (tier === 'race' || tier === 'standing') && gap !== null && gap > window / 2 ? 1 : 0;
      return [TIER_RANK[tier], far, fightRank(s), i];
    };
    return kept
      .filter(
        ({ s }) =>
          !(s.family === 'qualifies_for_zone' || s.family === 'safe_from_relegation') || !floorBeaten(s),
      )
      .map((x) => ({ x, k: key(x) }))
      .sort((a, b) => {
        for (let j = 0; j < a.k.length; j++) if (a.k[j] !== b.k[j]) return a.k[j]! - b.k[j]!;
        return 0;
      })
      .slice(0, max)
      .map(({ x }) => x.s);
  };
  return [...pick('home'), ...pick('away'), ...others];
}
