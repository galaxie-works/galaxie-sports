/**
 * Narração do lance a lance por frase pronta (#1167; spike #642). A decisão do Wagner em 12/11 foi não usar IA, e as
 * frases são editáveis em Ajustes. Cada lance da timeline ganha uma frase curta no idioma pedido, montada só com o
 * que o lance traz: tipo, autor, assistência, time, bandeiras do placar, placar depois do gol, gol anulado e
 * veredito do VAR. Nada de "de cabeça", "golaço" ou "livre na área", porque o evento não diz isso.
 *
 * `NARRATION_CATALOG` traz cada frase com uma chave, os marcadores que ela aceita e o texto padrão nos três idiomas.
 * O texto editado em Ajustes (tabela `ops.narration_template`) substitui o padrão daquela chave e idioma. Uma chave
 * pode ter várias variações, e a variação é escolhida pelo `sequence` do lance: a mesma leitura dá sempre a mesma
 * frase (cache, SSE e REST concordam).
 *
 * Lógica pura, sem banco: a API monta as frases; o painel usa o catálogo e a validação (a prévia troca os
 * marcadores por um jogo de exemplo).
 */
import type { TimelineIncident, VarOutcome } from './events.js';

export const NARRATION_LANGS = ['pt', 'es', 'en'] as const;
export type NarrationLang = (typeof NARRATION_LANGS)[number];

/** pt-BR → pt; es-* → es; en-* e o resto → en. */
export function narrationLang(locale: string): NarrationLang {
  const l = locale.toLowerCase();
  if (l.startsWith('pt')) return 'pt';
  if (l.startsWith('es')) return 'es';
  return 'en';
}

export const NARRATION_GROUPS = ['goal', 'score', 'var', 'card', 'penalty', 'substitution', 'other'] as const;
export type NarrationGroup = (typeof NARRATION_GROUPS)[number];

export interface NarrationEntry {
  group: NarrationGroup;
  /** Marcadores aceitos na frase (`{player}`...). */
  placeholders: readonly string[];
  /** Variações padrão por idioma (a escolha entre elas é fixa pelo `sequence` do lance). */
  defaults: Readonly<Record<NarrationLang, readonly string[]>>;
}

const e = (
  group: NarrationGroup,
  placeholders: readonly string[],
  pt: string | string[],
  es: string | string[],
  en: string | string[],
): NarrationEntry => ({
  group,
  placeholders,
  defaults: { pt: [pt].flat(), es: [es].flat(), en: [en].flat() },
});

const P = ['player'] as const;
const W = ['who'] as const;

export const NARRATION_CATALOG = {
  'goal.lead': e(
    'goal',
    ['team'],
    ['{team} marca!', 'Gol: {team}!', 'É gol, {team}!'],
    ['¡Gol de {team}!', '¡Es gol de {team}!', '¡Marca {team}!'],
    ['Goal for {team}!', '{team} score!', "It's a goal for {team}!"],
  ),
  'goal.opener': e(
    'goal',
    P,
    '{player} abre o placar',
    '{player} abre el marcador',
    '{player} opens the scoring',
  ),
  'goal.equalizer': e(
    'goal',
    P,
    '{player} empata o jogo',
    '{player} empata el partido',
    '{player} levels the match',
  ),
  'goal.go_ahead': e(
    'goal',
    P,
    '{player} põe o time na frente',
    '{player} pone al equipo adelante',
    '{player} puts them ahead',
  ),
  'goal.extends': e('goal', P, '{player} amplia', '{player} amplía la ventaja', '{player} extends the lead'),
  'goal.reduces': e('goal', P, '{player} diminui', '{player} descuenta', '{player} pulls one back'),
  'goal.plain': e('goal', P, 'Gol de {player}', 'Gol de {player}', 'Goal by {player}'),
  'goal.penalty_suffix': e('goal', [], 'de pênalti', 'de penal', 'from the penalty spot'),
  'goal.assist': e(
    'goal',
    ['assist'],
    'Assistência de {assist}.',
    'Asistencia de {assist}.',
    'Assisted by {assist}.',
  ),
  'goal.own_goal': e(
    'goal',
    ['player', 'team'],
    'Gol contra de {player}, a favor de {team}.',
    'Gol en contra de {player}, a favor de {team}.',
    'Own goal by {player}, credited to {team}.',
  ),
  'goal.own_goal_no_team': e(
    'goal',
    P,
    'Gol contra de {player}.',
    'Gol en contra de {player}.',
    'Own goal by {player}.',
  ),
  'goal.no_player': e('goal', ['team'], 'Gol: {team}.', 'Gol de {team}.', 'Goal for {team}.'),
  'goal.disallowed': e(
    'goal',
    P,
    'Gol de {player} anulado pelo VAR.',
    'Gol de {player} anulado por el VAR.',
    "{player}'s goal ruled out by VAR.",
  ),
  'goal.disallowed_own_goal': e(
    'goal',
    P,
    'Gol contra de {player} anulado pelo VAR.',
    'Gol en contra de {player} anulado por el VAR.',
    "{player}'s own goal ruled out by VAR.",
  ),
  'score.teams': e(
    'score',
    ['home', 'away', 'h', 'a'],
    '{home} {h} x {a} {away}.',
    '{home} {h}-{a} {away}.',
    '{home} {h}-{a} {away}.',
  ),
  'score.no_teams': e('score', ['h', 'a'], 'Placar: {h} x {a}.', 'Marcador: {h}-{a}.', 'Score: {h}-{a}.'),
  'score.still': e('score', ['h', 'a'], 'Segue {h} x {a}.', 'Sigue {h}-{a}.', 'Still {h}-{a}.'),
  'score.shootout_teams': e(
    'score',
    ['home', 'away', 'h', 'a'],
    'Disputa: {home} {h} x {a} {away}.',
    'Tanda: {home} {h}-{a} {away}.',
    'Shootout: {home} {h}-{a} {away}.',
  ),
  'score.shootout': e('score', ['h', 'a'], 'Disputa: {h} x {a}.', 'Tanda: {h}-{a}.', 'Shootout: {h}-{a}.'),
  'var.goal_cancelled': e(
    'var',
    W,
    'VAR anula o gol de {who}.',
    'El VAR anula el gol de {who}.',
    "VAR rules out {who}'s goal.",
  ),
  'var.goal_disallowed_offside': e(
    'var',
    W,
    'VAR anula o gol de {who} por impedimento.',
    'El VAR anula el gol de {who} por fuera de juego.',
    "VAR rules out {who}'s goal for offside.",
  ),
  'var.goal_disallowed_foul': e(
    'var',
    W,
    'VAR anula o gol de {who} por falta.',
    'El VAR anula el gol de {who} por falta.',
    "VAR rules out {who}'s goal for a foul.",
  ),
  'var.goal_disallowed_handball': e(
    'var',
    W,
    'VAR anula o gol de {who} por mão na bola.',
    'El VAR anula el gol de {who} por mano.',
    "VAR rules out {who}'s goal for handball.",
  ),
  'var.goal_confirmed': e(
    'var',
    W,
    'VAR confirma o gol de {who}.',
    'El VAR confirma el gol de {who}.',
    "VAR confirms {who}'s goal.",
  ),
  'var.goal_under_review': e(
    'var',
    W,
    'VAR revisa o gol de {who}.',
    'El VAR revisa el gol de {who}.',
    "VAR is reviewing {who}'s goal.",
  ),
  'var.penalty_awarded': e(
    'var',
    [],
    'VAR marca pênalti.',
    'El VAR sanciona penal.',
    'VAR awards a penalty.',
  ),
  'var.penalty_confirmed': e(
    'var',
    [],
    'VAR confirma o pênalti.',
    'El VAR confirma el penal.',
    'VAR confirms the penalty.',
  ),
  'var.penalty_cancelled': e(
    'var',
    [],
    'VAR anula o pênalti.',
    'El VAR anula el penal.',
    'VAR overturns the penalty.',
  ),
  'var.card_upgrade': e(
    'var',
    W,
    'VAR revisa o lance e o cartão de {who} vira vermelho.',
    'El VAR revisa la jugada y la tarjeta de {who} pasa a roja.',
    "VAR review: {who}'s card is upgraded to red.",
  ),
  'var.card_upgrade_confirmed': e(
    'var',
    W,
    'VAR confirma o vermelho para {who}.',
    'El VAR confirma la roja para {who}.',
    'VAR confirms the red card for {who}.',
  ),
  'var.card_upgrade_cancelled': e(
    'var',
    W,
    'VAR revisa o lance e mantém o cartão de {who}.',
    'El VAR revisa la jugada y mantiene la tarjeta de {who}.',
    "VAR review: {who}'s card stands.",
  ),
  'var.card_reviewed': e(
    'var',
    W,
    'VAR revisa o cartão de {who}.',
    'El VAR revisa la tarjeta de {who}.',
    "VAR reviews {who}'s card.",
  ),
  'var.red_card_confirmed': e(
    'var',
    W,
    'VAR confirma o vermelho para {who}.',
    'El VAR confirma la roja para {who}.',
    'VAR confirms the red card for {who}.',
  ),
  'var.red_card_cancelled': e(
    'var',
    W,
    'VAR anula o vermelho de {who}.',
    'El VAR anula la roja de {who}.',
    "VAR overturns {who}'s red card.",
  ),
  'var.decision_changed': e(
    'var',
    [],
    'VAR muda a decisão do árbitro.',
    'El VAR cambia la decisión del árbitro.',
    "VAR overturns the referee's decision.",
  ),
  'var.other': e('var', [], 'Revisão do VAR.', 'Revisión del VAR.', 'VAR review.'),
  'card.yellow': e(
    'card',
    ['player', 'team'],
    ['Cartão amarelo para {player} ({team}).', 'Amarelo para {player} ({team}).'],
    ['Tarjeta amarilla para {player} ({team}).', 'Amarilla para {player} ({team}).'],
    ['Yellow card for {player} ({team}).', '{player} ({team}) is booked.'],
  ),
  'card.yellow_no_team': e(
    'card',
    P,
    ['Cartão amarelo para {player}.', 'Amarelo para {player}.'],
    ['Tarjeta amarilla para {player}.', 'Amarilla para {player}.'],
    ['Yellow card for {player}.', '{player} is booked.'],
  ),
  'card.second_yellow': e(
    'card',
    ['player', 'team'],
    'Segundo amarelo para {player} ({team}): expulsão.',
    'Segunda amarilla para {player} ({team}): expulsión.',
    'Second yellow for {player} ({team}): sent off.',
  ),
  'card.second_yellow_no_team': e(
    'card',
    P,
    'Segundo amarelo para {player}: expulsão.',
    'Segunda amarilla para {player}: expulsión.',
    'Second yellow for {player}: sent off.',
  ),
  'card.red': e(
    'card',
    ['player', 'team'],
    'Cartão vermelho para {player} ({team}).',
    'Tarjeta roja para {player} ({team}).',
    'Red card for {player} ({team}).',
  ),
  'card.red_no_team': e(
    'card',
    P,
    'Cartão vermelho para {player}.',
    'Tarjeta roja para {player}.',
    'Red card for {player}.',
  ),
  'penalty.missed': e(
    'penalty',
    P,
    ['{player} perde o pênalti.', 'Pênalti desperdiçado por {player}.'],
    ['{player} falla el penal.', 'Penal desperdiciado por {player}.'],
    ['{player} misses the penalty.', 'Penalty missed by {player}.'],
  ),
  'penalty.shootout_scored': e(
    'penalty',
    P,
    '{player} converte na disputa de pênaltis.',
    '{player} convierte en la tanda de penales.',
    '{player} scores in the shootout.',
  ),
  'penalty.shootout_missed': e(
    'penalty',
    P,
    '{player} perde a cobrança na disputa de pênaltis.',
    '{player} falla en la tanda de penales.',
    '{player} misses in the shootout.',
  ),
  'substitution.team': e(
    'substitution',
    ['team', 'in', 'out'],
    'Substituição ({team}): entra {in}, sai {out}.',
    'Cambio ({team}): entra {in}, sale {out}.',
    '{team} substitution: {in} on, {out} off.',
  ),
  'substitution.no_team': e(
    'substitution',
    ['in', 'out'],
    'Substituição: entra {in}, sai {out}.',
    'Cambio: entra {in}, sale {out}.',
    'Substitution: {in} on, {out} off.',
  ),
  'other.unknown_player': e(
    'other',
    [],
    'atleta sem nome informado',
    'deportista sin nombre informado',
    'unnamed player',
  ),
} as const satisfies Record<string, NarrationEntry>;

export type NarrationKey = keyof typeof NARRATION_CATALOG;
export const NARRATION_KEYS = Object.keys(NARRATION_CATALOG) as NarrationKey[];

export function isNarrationKey(key: string): key is NarrationKey {
  return Object.hasOwn(NARRATION_CATALOG, key);
}

/** Textos editados em Ajustes: chave → idioma → variações. O que faltar usa o padrão do catálogo. */
export type NarrationOverrides = Partial<Record<string, Partial<Record<NarrationLang, readonly string[]>>>>;

/** Limites da edição em Ajustes. */
export const NARRATION_MAX_VARIANTS = 8;
export const NARRATION_MAX_LENGTH = 240;

export type NarrationProblem =
  | { code: 'empty' }
  | { code: 'too_many' }
  | { code: 'too_long'; variant: number }
  | { code: 'unknown_placeholder'; variant: number; placeholder: string }
  | { code: 'broken_placeholder'; variant: number };

/**
 * Confere as variações de uma chave: ao menos uma e no máximo 8, cada uma com até 240 caracteres e só com os
 * marcadores que a chave aceita. Chave em branco é rejeitada, e "voltar ao padrão" é apagar o texto editado.
 */
export function validateNarration(key: NarrationKey, variants: readonly string[]): NarrationProblem[] {
  const list = variants.map((v) => v.trim()).filter(Boolean);
  if (!list.length) return [{ code: 'empty' }];
  if (list.length > NARRATION_MAX_VARIANTS) return [{ code: 'too_many' }];
  const allowed = new Set<string>(NARRATION_CATALOG[key].placeholders);
  const problems: NarrationProblem[] = [];
  list.forEach((v, variant) => {
    if (v.length > NARRATION_MAX_LENGTH) problems.push({ code: 'too_long', variant });
    for (const m of v.matchAll(/\{(\w*)\}/g))
      if (!allowed.has(m[1]!)) problems.push({ code: 'unknown_placeholder', variant, placeholder: m[1]! });
    // chave sem par ("{player" ou "player}") quase sempre é erro de digitação
    if ((v.match(/[{}]/g) ?? []).length !== 2 * [...v.matchAll(/\{\w*\}/g)].length)
      problems.push({ code: 'broken_placeholder', variant });
  });
  return problems;
}

/** Limpa as variações como serão gravadas: sem espaço nas pontas e sem linha vazia. */
export function cleanNarrationVariants(variants: readonly string[]): string[] {
  return variants.map((v) => v.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export interface NarrationContext {
  lang: NarrationLang;
  /** Nomes do mandante e do visitante, para o placar ("Palmeiras 1 x 0 Fluminense"). */
  home: string | null;
  away: string | null;
  /** Placar do tempo de jogo antes deste lance (para o "segue 0 x 0" do VAR). */
  scoreBefore: { home: number; away: number };
  /**
   * VAR de gol anulado já refletido no placar (o gol anulado já não conta em `scoreBefore`). No ao vivo o gol só sai
   * da conta na leitura em que o placar cai; antes disso o VAR sai sem placar, para não dizer "segue 1 x 0" errado.
   */
  varSettled?: boolean | undefined;
  overrides?: NarrationOverrides | undefined;
}

type Vars = Record<string, string>;

const fillText = (p: string, v: Vars) => p.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');
/** Primeira letra maiúscula (a frase pode começar por um nome em minúscula ou por um marcador). */
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const join = (...parts: (string | null | undefined)[]) =>
  parts
    .filter((p): p is string => !!p && !!p.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const VAR_SCORE: ReadonlySet<VarOutcome> = new Set([
  'goal_cancelled',
  'goal_disallowed_offside',
  'goal_disallowed_foul',
  'goal_disallowed_handball',
  'goal_confirmed',
]);

/** Frase do lance; null quando não há nada seguro a dizer (lance `other` do fornecedor). */
export function narrate(i: TimelineIncident, ctx: NarrationContext): string | null {
  const variants = (key: NarrationKey): readonly string[] => {
    const edited = ctx.overrides?.[key]?.[ctx.lang];
    return edited?.length ? edited : NARRATION_CATALOG[key].defaults[ctx.lang];
  };
  const say = (key: NarrationKey, v: Vars = {}) => {
    const list = variants(key);
    return fillText(list[Math.abs(i.sequence) % list.length]!, v);
  };

  const player = i.player?.name ?? null;
  // gol contra: o lado só é certo em `scoring_team` (o `team` do fornecedor pode ser o do jogador)
  const team = (i.kind === 'own_goal' ? i.scoring_team : (i.scoring_team ?? i.team))?.name ?? null;
  // VAR sem autor fala do time; o resto não troca o jogador pelo nome do time
  const who = player ?? team ?? say('other.unknown_player');
  const v: Vars = {
    player: player ?? say('other.unknown_player'),
    who,
    team: team ?? '',
    assist: i.assist?.name ?? '',
  };
  /** Complemento ("de pênalti"): vírgula em pt e es, espaço em en. */
  const suffix = (text: string) => (ctx.lang === 'en' ? ` ${text}` : `, ${text}`);
  const score = (s: { home: number; away: number }) =>
    ctx.home && ctx.away
      ? say('score.teams', { home: ctx.home, away: ctx.away, h: String(s.home), a: String(s.away) })
      : say('score.no_teams', { h: String(s.home), a: String(s.away) });

  switch (i.kind) {
    case 'goal':
    case 'penalty_goal':
    case 'own_goal': {
      if (i.disallowed)
        return cap(say(i.kind === 'own_goal' ? 'goal.disallowed_own_goal' : 'goal.disallowed', v));
      if (i.kind === 'own_goal') {
        if (!player)
          return team ? join(say('goal.no_player', v), i.score_after ? score(i.score_after) : null) : null;
        return join(
          say(team ? 'goal.own_goal' : 'goal.own_goal_no_team', v),
          i.score_after ? score(i.score_after) : null,
        );
      }
      if (!player)
        return team ? join(say('goal.no_player', v), i.score_after ? score(i.score_after) : null) : null;
      const side = i.scoring_team?.side;
      const after = i.score_after;
      let line: NarrationKey = 'goal.plain';
      if (i.flags.includes('opener')) line = 'goal.opener';
      else if (i.flags.includes('equalizer')) line = 'goal.equalizer';
      else if (i.flags.includes('go_ahead')) line = 'goal.go_ahead';
      else if (after && (side === 'home' || side === 'away')) {
        const other = side === 'home' ? 'away' : 'home';
        line = after[side] > after[other] ? 'goal.extends' : 'goal.reduces';
      }
      const body = say(line, v) + (i.kind === 'penalty_goal' ? suffix(say('goal.penalty_suffix')) : '') + '.';
      return join(
        team ? say('goal.lead', v) : null,
        cap(body),
        i.assist?.name && i.kind === 'goal' ? say('goal.assist', v) : null,
        after ? score(after) : null,
      );
    }
    case 'var': {
      const outcome = i.var_outcome ?? 'other';
      const base = cap(say(`var.${outcome}` as NarrationKey, v));
      // gol anulado ou confirmado: o placar que vale depois do VAR
      if (!VAR_SCORE.has(outcome)) return base;
      // gol anulado que ainda conta no placar parcial (ao vivo, antes de o placar cair): sem placar
      if (outcome !== 'goal_confirmed' && !ctx.varSettled) return base;
      const s = ctx.scoreBefore;
      return join(
        base,
        outcome === 'goal_confirmed'
          ? score(s)
          : say('score.still', { h: String(s.home), a: String(s.away) }),
      );
    }
    case 'penalty_missed':
      return player ? cap(say('penalty.missed', v)) : null;
    case 'shootout_scored': {
      if (!player) return null;
      const k = i.score_after;
      const tally = k
        ? ctx.home && ctx.away
          ? say('score.shootout_teams', {
              home: ctx.home,
              away: ctx.away,
              h: String(k.home),
              a: String(k.away),
            })
          : say('score.shootout', { h: String(k.home), a: String(k.away) })
        : null;
      return join(cap(say('penalty.shootout_scored', v)), tally);
    }
    case 'shootout_missed':
      return player ? cap(say('penalty.shootout_missed', v)) : null;
    case 'yellow_card':
    case 'second_yellow':
    case 'red_card':
      if (!player) return null;
      break;
    default:
      break;
  }
  switch (i.kind) {
    case 'yellow_card':
      return cap(say(team ? 'card.yellow' : 'card.yellow_no_team', v));
    case 'second_yellow':
      return cap(say(team ? 'card.second_yellow' : 'card.second_yellow_no_team', v));
    case 'red_card':
      return cap(say(team ? 'card.red' : 'card.red_no_team', v));
    case 'substitution': {
      const inn = i.player_in?.name;
      const out = i.player_out?.name;
      if (!inn || !out) return null;
      return say(team ? 'substitution.team' : 'substitution.no_team', { team: team ?? '', in: inn, out });
    }
    default:
      return null;
  }
}
