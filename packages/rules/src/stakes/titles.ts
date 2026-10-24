import { makeStake, type Stake, type StakeFamily } from './codes.js';

/**
 * "Busca o tetra": quantos títulos daquela competição o time já tem e qual busca, para cada time de uma
 * final ou de um jogo que pode dar o título. A contagem vem de fora (títulos por edição importados do
 * Wikidata, `core.competition_title`); aqui só a decisão de quando emitir e o código `seeks_title_{n}`,
 * com `n` = número do título buscado (já tem 3 → `seeks_title_4`).
 */

/** Stakes de quem pode ser campeão nesta partida (lado do time). */
const TITLE_CHANCE_FAMILIES = new Set<StakeFamily>([
  'clinches_title_with_draw',
  'clinches_title_with_win',
  'can_clinch_title',
  'needs_win_for_title',
  'needs_win_by_n_for_title',
  'wins_title_with_draw',
  'wins_title_with_loss_by_n',
  'wins_title_with_draw_up_to_n',
  'wins_title_with_draw_from_n',
  'title_depends_on_away_goals',
]);

export type TitleSide = 'home' | 'away';

/**
 * Lados que disputam o título nesta partida: os dois numa final (`decidesTitle` da fase, ida inclusive:
 * os dois times "buscam o tetra" desde a ida) ou quando há `decides_title`; em pontos corridos, só quem
 * pode ser campeão na rodada (`can_clinch_title`, `clinches_title_with_*`).
 */
export function titleChaseSides(
  stakes: readonly Pick<Stake, 'team' | 'family'>[],
  knockout?: { decidesTitle: boolean } | null,
): TitleSide[] {
  if (knockout?.decidesTitle || stakes.some((s) => s.family === 'decides_title')) return ['home', 'away'];
  const sides = new Set<TitleSide>();
  for (const s of stakes) {
    if (s.team !== 'both' && TITLE_CHANCE_FAMILIES.has(s.family)) sides.add(s.team);
  }
  return (['home', 'away'] as const).filter((s) => sides.has(s));
}

/** Títulos já conquistados por lado (só os lados com contagem confiável). */
export type TitleCounts = Partial<Record<TitleSide, { won: number }>>;

/** `seeks_title_{n}` para cada lado em disputa com contagem conhecida (ordem: mandante, visitante). */
export function titleChaseStakes(sides: readonly TitleSide[], counts: TitleCounts): Stake[] {
  const out: Stake[] = [];
  for (const side of ['home', 'away'] as const) {
    const c = counts[side];
    if (!sides.includes(side) || !c || !Number.isInteger(c.won) || c.won < 0) continue;
    out.push(makeStake(side, 'seeks_title_n', { n: c.won + 1 }));
  }
  return out;
}

const PREFIX: Record<number, string> = {
  2: 'bi',
  3: 'tri',
  4: 'tetra',
  5: 'penta',
  6: 'hexa',
  7: 'hepta',
  8: 'octa',
  9: 'enea',
  10: 'deca',
};

/**
 * O título de número `n`, para compor a frase: pt-BR "tetracampeonato" / "11º título"; espanhol
 * "tetracampeonato" / "título número 11". `short` dá a forma curta das tags ("tetra", "11º título").
 * n ≤ 1 cai no "primeiro título" (os rótulos têm variante própria para n = 1).
 */
export function titleOrdinal(n: number, lang: 'pt' | 'es' | 'en', short = false): string {
  const prefix = PREFIX[n];
  if (lang === 'en') return `title No. ${n}`;
  if (n <= 1) return lang === 'pt' ? 'primeiro título' : 'primer título';
  if (prefix) return short ? prefix : `${prefix}campeonato`;
  return lang === 'pt' ? `${n}º título` : short ? `título ${n}` : `título número ${n}`;
}

/**
 * Predicado de quem acaba de ganhar o título de número `n` (resumo pós-jogo): pt-BR "é tetracampeão" /
 * "é campeão pela primeira vez" / "conquista o 11º título"; espanhol "es tetracampeón" /
 * "es campeón por primera vez" / "gana su título número 11".
 */
export function championPhrase(n: number, lang: 'pt' | 'es'): string {
  const prefix = PREFIX[n];
  if (n <= 1) return lang === 'pt' ? 'é campeão pela primeira vez' : 'es campeón por primera vez';
  if (prefix) return lang === 'pt' ? `é ${prefix}campeão` : `es ${prefix}campeón`;
  return lang === 'pt' ? `conquista o ${n}º título` : `gana su título número ${n}`;
}
