/**
 * Fatos estruturais da importância (docs/06 §3) comuns ao upsert da normalização e ao recálculo
 * periódico: perna do confronto (ida/volta), total de rodadas, regulamento em cache e a montagem do
 * score + detalhamento gravado em `core.event.importance_breakdown`. Os sinais da tabela (stakes) só vêm
 * do recálculo (`stake_flags`); o upsert os preserva.
 */
import type { EventImportanceBreakdown } from '@galaxie/db';
import {
  DECISIVE_FLAGS,
  importance,
  knockoutDecisive,
  LEAGUE_PROGRESS_KINDS,
  parseRound,
  roundProgress,
  type DecisiveFlag,
  type DerbyMatch,
  type StageKind,
} from '@galaxie/providers';
import { knockoutStageRules, rulesStageKey, type CompetitionRules } from '@galaxie/rules';
import { loadCompetitionRules, RulesConfigError } from '@galaxie/rules/config';

export interface ImportanceFacts {
  tier: number | null;
  /** Prestígio da competição (0–10, do catálogo). */
  prestige: number;
  stageKind: StageKind | null;
  stageLabel: string | null;
  /** Total de rodadas da fase de pontos corridos (regulamento ou maior rodada conhecida). */
  totalRounds: number | null;
  /** Formato do confronto, só em fase de mata-mata. */
  knockout: { legs: 1 | 2; leg: 1 | 2 | null } | null;
  derby: DerbyMatch | null;
  /** Sinais da tabela calculados pelo motor de regras (recálculo); o upsert repassa os já gravados. */
  stakeFlags: readonly string[];
}

const FLAG_SET = new Set<string>(DECISIVE_FLAGS);

/** Score e detalhamento gravável a partir dos fatos. */
export function importanceFromFacts(f: ImportanceFacts): {
  score: number;
  breakdown: EventImportanceBreakdown;
} {
  const stakeFlags = [...new Set(f.stakeFlags)].filter((x): x is DecisiveFlag => FLAG_SET.has(x));
  const structural = f.knockout ? knockoutDecisive(f.stageKind, f.knockout) : [];
  const flags = DECISIVE_FLAGS.filter((x) => structural.includes(x) || stakeFlags.includes(x));
  const round = f.stageLabel ? parseRound(f.stageLabel).number : null;
  const progress =
    f.stageKind && LEAGUE_PROGRESS_KINDS.has(f.stageKind) ? roundProgress(round, f.totalRounds) : null;
  const leg = f.knockout?.legs === 2 ? f.knockout.leg : null;
  const r = importance({
    tier: f.tier,
    stageKind: f.stageKind,
    roundProgress: progress,
    leg,
    derby: f.derby,
    decisive: flags,
    prestige: f.prestige,
  });
  return {
    score: r.score,
    breakdown: { ...r.breakdown, leg, flags: [...flags], stake_flags: stakeFlags },
  };
}

/** Mesmo detalhamento? (evita reescrever a linha quando nada mudou). */
export function sameBreakdown(
  a: EventImportanceBreakdown | null | undefined,
  b: EventImportanceBreakdown | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.tier === b.tier &&
    a.phase === b.phase &&
    a.derby === b.derby &&
    a.decisive === b.decisive &&
    a.prestige === b.prestige &&
    (a.leg ?? null) === (b.leg ?? null) &&
    (a.flags ?? []).join() === (b.flags ?? []).join() &&
    (a.stake_flags ?? []).join() === (b.stake_flags ?? []).join()
  );
}

/** Intensidade do clássico gravada no detalhamento (6 pontos por nível). */
export function derbyIntensityOf(b: EventImportanceBreakdown | null | undefined): number | null {
  return b && b.derby > 0 ? Math.round(b.derby / 6) : null;
}

// ─── mata-mata: ida e volta ──────────────────────────────────────────────────────────────────────

/** Partida da mesma fase com o mesmo par (qualquer mando), para achar a outra perna. */
export interface TieMatch {
  /** Chave estável no lote (UUID do core ou ID do provedor ainda não gravado). */
  key: string;
  stageId: string;
  startsAt: Date;
  participants: readonly string[];
}

export function pairKey(stageId: string, participants: readonly string[]): string | null {
  if (participants.length !== 2) return null;
  return `${stageId}|${[...participants].sort().join('|')}`;
}

/** Agrupa partidas por confronto (fase + par), em ordem cronológica. */
export function groupTies(matches: readonly TieMatch[]): Map<string, TieMatch[]> {
  const out = new Map<string, TieMatch[]>();
  const seen = new Set<string>();
  for (const m of [...matches].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const key = pairKey(m.stageId, m.participants);
    if (!key || seen.has(m.key)) continue;
    seen.add(m.key);
    const list = out.get(key) ?? [];
    list.push(m);
    out.set(key, list);
  }
  return out;
}

/**
 * Formato do confronto desta partida: duas partidas do mesmo par na fase = ida e volta (a mais cedo é a
 * ida); uma só = o regulamento decide (ida e volta com a outra perna ainda desconhecida → perna `null`);
 * sem regulamento próprio, jogo único.
 */
export function tieShape(
  self: Pick<TieMatch, 'key'>,
  tie: readonly TieMatch[],
  rulesLegs: 1 | 2 | null,
): { legs: 1 | 2; leg: 1 | 2 | null } {
  if (tie.length >= 2) {
    const i = tie.findIndex((m) => m.key === self.key);
    return { legs: 2, leg: i === 0 ? 1 : i === tie.length - 1 ? 2 : null };
  }
  return rulesLegs === 2 ? { legs: 2, leg: null } : { legs: 1, leg: null };
}

/** Pernas da fase pelo regulamento próprio da competição (null sem arquivo em config/rules). */
export function rulesLegs(
  rules: CompetitionRules | null,
  stageKind: StageKind | null,
  stageLabel: string | null,
): 1 | 2 | null {
  if (!rules?.knockout || !stageKind) return null;
  return knockoutStageRules(rules, rulesStageKey(stageKind, stageLabel)).legs;
}

// ─── pontos corridos: total de rodadas ───────────────────────────────────────────────────────────

/** Prefixo do rótulo de rodada ("Regular Season - 32" → "Regular Season"). */
export function roundPrefix(label: string | null): string | null {
  if (!label) return null;
  const m = /^(.*?)\s+-\s+\d+$/.exec(label.trim());
  return m ? m[1]!.trim() : null;
}

/**
 * Maior rodada conhecida por temporada e prefixo (`${seasonId}|${prefix}` → n), a partir dos rótulos das
 * fases de pontos corridos. Serve quando a competição não tem regulamento com `matches_per_team`.
 */
export function maxRounds(
  stages: readonly { seasonId: string; label: string | null }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of stages) {
    const prefix = roundPrefix(s.label);
    const n = s.label ? parseRound(s.label).number : null;
    if (!prefix || n == null) continue;
    const key = `${s.seasonId}|${prefix}`;
    out.set(key, Math.max(out.get(key) ?? 0, n));
  }
  return out;
}

/** Total de rodadas: `matches_per_team` do regulamento; senão a maior rodada conhecida da temporada. */
export function totalRoundsOf(
  rules: CompetitionRules | null,
  seasonId: string | null,
  stageKind: StageKind | null,
  stageLabel: string | null,
  known: Map<string, number>,
): number | null {
  if (!stageKind || !LEAGUE_PROGRESS_KINDS.has(stageKind)) return null;
  if (rules?.league?.matchesPerTeam) return rules.league.matchesPerTeam;
  const prefix = roundPrefix(stageLabel);
  return seasonId && prefix ? (known.get(`${seasonId}|${prefix}`) ?? null) : null;
}

// ─── regulamentos em cache ───────────────────────────────────────────────────────────────────────

const rulesCache = new Map<string, Promise<CompetitionRules | null>>();

/**
 * Regulamento próprio da competição (config/rules/<slug>.yaml) em cache por competição × temporada.
 * Sem arquivo próprio: null (o formato do confronto vem dos dados).
 */
export function competitionRules(
  slug: string | null | undefined,
  seasonYear: number | null | undefined,
): Promise<CompetitionRules | null> {
  if (!slug) return Promise.resolve(null);
  const key = `${slug}|${seasonYear ?? ''}`;
  let hit = rulesCache.get(key);
  if (!hit) {
    hit = loadCompetitionRules(slug, seasonYear ? { season: seasonYear } : {}).catch((err: unknown) => {
      if (err instanceof RulesConfigError) return null;
      throw err;
    });
    rulesCache.set(key, hit);
  }
  return hit;
}
