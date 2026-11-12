/**
 * Narração do lance a lance por frase pronta (#1167; spike #642, decisão do Wagner de 12/11: sem IA). Cada lance da
 * timeline ganha uma frase curta no idioma pedido, montada só com o que o lance traz: tipo, autor, assistência, time,
 * bandeiras do placar, placar depois do gol, gol anulado e veredito do VAR. Nada de "de cabeça", "golaço" ou "livre na
 * área": o evento não diz isso.
 *
 * A variação entre frases do mesmo tipo é escolhida pelo `sequence`, então a mesma leitura dá sempre a mesma frase
 * (cache, SSE e REST concordam). Lógica pura, testada em narration.test.ts.
 */
import type { TimelineIncident, VarOutcome } from '@galaxie/contracts';

export type NarrationLang = 'pt' | 'es' | 'en';

/** pt-BR → pt; es-* → es; en-* e o resto → en. */
export function narrationLang(locale: string): NarrationLang {
  const l = locale.toLowerCase();
  if (l.startsWith('pt')) return 'pt';
  if (l.startsWith('es')) return 'es';
  return 'en';
}

type Vars = Record<string, string>;
type Phrase = string | ((v: Vars) => string);

interface Texts {
  /** Abertura do gol (uma por variação). `{team}` é o time que somou. */
  goalLead: string[];
  opener: string;
  equalizer: string;
  goAhead: string;
  extends: string;
  reduces: string;
  goalNoContext: string;
  penaltySuffix: string;
  assist: string;
  ownGoal: string;
  disallowed: string;
  score: string;
  scoreNoTeams: string;
  stillScore: string;
  penaltyMissed: string[];
  shootoutScored: string;
  shootoutMissed: string;
  yellow: string[];
  secondYellow: string;
  red: string;
  sub: string;
  subNoTeam: string;
  someone: string;
  var: Record<VarOutcome, string>;
  /** Motivo do gol anulado, quando o veredito traz. */
  varReason: Partial<Record<VarOutcome, string>>;
}

const T: Record<NarrationLang, Texts> = {
  pt: {
    goalLead: ['{team} marca!', 'Gol: {team}!', 'É gol, {team}!'],
    opener: '{player} abre o placar',
    equalizer: '{player} empata o jogo',
    goAhead: '{player} põe o time na frente',
    extends: '{player} amplia',
    reduces: '{player} diminui',
    goalNoContext: 'Gol de {player}',
    penaltySuffix: ', de pênalti',
    assist: 'Assistência de {assist}.',
    ownGoal: 'Gol contra de {player}, a favor de {team}.',
    disallowed: 'Gol de {player} anulado pelo VAR.',
    score: '{home} {h} x {a} {away}.',
    scoreNoTeams: 'Placar: {h} x {a}.',
    stillScore: 'Segue {h} x {a}.',
    penaltyMissed: ['{player} perde o pênalti.', 'Pênalti desperdiçado por {player}.'],
    shootoutScored: '{player} converte na disputa de pênaltis.',
    shootoutMissed: '{player} perde a cobrança na disputa de pênaltis.',
    yellow: ['Cartão amarelo para {player} ({team}).', 'Amarelo para {player} ({team}).'],
    secondYellow: 'Segundo amarelo para {player}, que é expulso. {team} fica com um a menos.',
    red: 'Cartão vermelho para {player}. {team} fica com um a menos.',
    sub: 'Substituição em {team}: entra {in}, sai {out}.',
    subNoTeam: 'Substituição: entra {in}, sai {out}.',
    someone: 'jogador sem nome informado',
    var: {
      goal_cancelled: 'VAR anula o gol de {who}.',
      goal_disallowed_offside: 'VAR anula o gol de {who}{reason}.',
      goal_disallowed_foul: 'VAR anula o gol de {who}{reason}.',
      goal_disallowed_handball: 'VAR anula o gol de {who}{reason}.',
      goal_confirmed: 'VAR confirma o gol de {who}.',
      goal_under_review: 'VAR revisa o gol de {who}.',
      penalty_awarded: 'VAR marca pênalti.',
      penalty_confirmed: 'VAR confirma o pênalti.',
      penalty_cancelled: 'VAR anula o pênalti.',
      card_upgrade: 'VAR revisa o lance e o cartão de {who} vira vermelho.',
      card_upgrade_confirmed: 'VAR confirma o vermelho para {who}.',
      card_upgrade_cancelled: 'VAR revisa o lance e mantém o cartão de {who}.',
      card_reviewed: 'VAR revisa o cartão de {who}.',
      red_card_confirmed: 'VAR confirma o vermelho para {who}.',
      red_card_cancelled: 'VAR anula o vermelho de {who}.',
      decision_changed: 'VAR muda a decisão do árbitro.',
      other: 'Revisão do VAR.',
    },
    varReason: {
      goal_disallowed_offside: ' por impedimento',
      goal_disallowed_foul: ' por falta',
      goal_disallowed_handball: ' por mão na bola',
    },
  },
  es: {
    goalLead: ['¡Gol de {team}!', '¡Es gol de {team}!', '¡Marca {team}!'],
    opener: '{player} abre el marcador',
    equalizer: '{player} empata el partido',
    goAhead: '{player} pone al equipo adelante',
    extends: '{player} amplía la ventaja',
    reduces: '{player} descuenta',
    goalNoContext: 'Gol de {player}',
    penaltySuffix: ', de penal',
    assist: 'Asistencia de {assist}.',
    ownGoal: 'Gol en contra de {player}, a favor de {team}.',
    disallowed: 'Gol de {player} anulado por el VAR.',
    score: '{home} {h}-{a} {away}.',
    scoreNoTeams: 'Marcador: {h}-{a}.',
    stillScore: 'Sigue {h}-{a}.',
    penaltyMissed: ['{player} falla el penal.', 'Penal desperdiciado por {player}.'],
    shootoutScored: '{player} convierte en la tanda de penales.',
    shootoutMissed: '{player} falla en la tanda de penales.',
    yellow: ['Tarjeta amarilla para {player} ({team}).', 'Amarilla para {player} ({team}).'],
    secondYellow: 'Segunda amarilla para {player}, que es expulsado. {team} se queda con uno menos.',
    red: 'Tarjeta roja para {player}. {team} se queda con uno menos.',
    sub: 'Cambio en {team}: entra {in}, sale {out}.',
    subNoTeam: 'Cambio: entra {in}, sale {out}.',
    someone: 'jugador sin nombre informado',
    var: {
      goal_cancelled: 'El VAR anula el gol de {who}.',
      goal_disallowed_offside: 'El VAR anula el gol de {who}{reason}.',
      goal_disallowed_foul: 'El VAR anula el gol de {who}{reason}.',
      goal_disallowed_handball: 'El VAR anula el gol de {who}{reason}.',
      goal_confirmed: 'El VAR confirma el gol de {who}.',
      goal_under_review: 'El VAR revisa el gol de {who}.',
      penalty_awarded: 'El VAR sanciona penal.',
      penalty_confirmed: 'El VAR confirma el penal.',
      penalty_cancelled: 'El VAR anula el penal.',
      card_upgrade: 'El VAR revisa la jugada y la tarjeta de {who} pasa a roja.',
      card_upgrade_confirmed: 'El VAR confirma la roja para {who}.',
      card_upgrade_cancelled: 'El VAR revisa la jugada y mantiene la tarjeta de {who}.',
      card_reviewed: 'El VAR revisa la tarjeta de {who}.',
      red_card_confirmed: 'El VAR confirma la roja para {who}.',
      red_card_cancelled: 'El VAR anula la roja de {who}.',
      decision_changed: 'El VAR cambia la decisión del árbitro.',
      other: 'Revisión del VAR.',
    },
    varReason: {
      goal_disallowed_offside: ' por fuera de juego',
      goal_disallowed_foul: ' por falta',
      goal_disallowed_handball: ' por mano',
    },
  },
  en: {
    goalLead: ['Goal for {team}!', '{team} score!', "It's a goal for {team}!"],
    opener: '{player} opens the scoring',
    equalizer: '{player} levels the match',
    goAhead: '{player} puts them ahead',
    extends: '{player} extends the lead',
    reduces: '{player} pulls one back',
    goalNoContext: 'Goal by {player}',
    penaltySuffix: ' from the penalty spot',
    assist: 'Assisted by {assist}.',
    ownGoal: 'Own goal by {player}, credited to {team}.',
    disallowed: "{player}'s goal ruled out by VAR.",
    score: '{home} {h}-{a} {away}.',
    scoreNoTeams: 'Score: {h}-{a}.',
    stillScore: 'Still {h}-{a}.',
    penaltyMissed: ['{player} misses the penalty.', 'Penalty missed by {player}.'],
    shootoutScored: '{player} scores in the shootout.',
    shootoutMissed: '{player} misses in the shootout.',
    yellow: ['Yellow card for {player} ({team}).', '{player} ({team}) is booked.'],
    secondYellow: 'Second yellow for {player}, who is sent off. {team} are down to ten.',
    red: 'Red card for {player}. {team} are a player down.',
    sub: '{team} substitution: {in} on, {out} off.',
    subNoTeam: 'Substitution: {in} on, {out} off.',
    someone: 'unnamed player',
    var: {
      goal_cancelled: "VAR rules out {who}'s goal.",
      goal_disallowed_offside: "VAR rules out {who}'s goal{reason}.",
      goal_disallowed_foul: "VAR rules out {who}'s goal{reason}.",
      goal_disallowed_handball: "VAR rules out {who}'s goal{reason}.",
      goal_confirmed: "VAR confirms {who}'s goal.",
      goal_under_review: "VAR is reviewing {who}'s goal.",
      penalty_awarded: 'VAR awards a penalty.',
      penalty_confirmed: 'VAR confirms the penalty.',
      penalty_cancelled: 'VAR overturns the penalty.',
      card_upgrade: "VAR review: {who}'s card is upgraded to red.",
      card_upgrade_confirmed: 'VAR confirms the red card for {who}.',
      card_upgrade_cancelled: "VAR review: {who}'s card stands.",
      card_reviewed: "VAR reviews {who}'s card.",
      red_card_confirmed: 'VAR confirms the red card for {who}.',
      red_card_cancelled: "VAR overturns {who}'s red card.",
      decision_changed: "VAR overturns the referee's decision.",
      other: 'VAR review.',
    },
    varReason: {
      goal_disallowed_offside: ' for offside',
      goal_disallowed_foul: ' for a foul',
      goal_disallowed_handball: ' for handball',
    },
  },
};

const fill = (p: Phrase, v: Vars) =>
  (typeof p === 'function' ? p(v) : p).replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');
const pick = <X>(list: readonly X[], seq: number): X => list[Math.abs(seq) % list.length]!;
/** Primeira letra maiúscula (a frase pode começar por um nome em minúscula ou pelo marcador "{who}"). */
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const join = (...parts: (string | null | undefined)[]) =>
  parts
    .filter((p): p is string => !!p && !!p.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

export interface NarrationContext {
  lang: NarrationLang;
  /** Nomes do mandante e do visitante, para o placar ("Palmeiras 1 x 0 Fluminense"). */
  home: string | null;
  away: string | null;
  /** Placar do tempo de jogo antes deste lance (para o "segue 0 x 0" do VAR). */
  scoreBefore: { home: number; away: number };
}

const GOAL_VAR: ReadonlySet<VarOutcome> = new Set([
  'goal_cancelled',
  'goal_disallowed_offside',
  'goal_disallowed_foul',
  'goal_disallowed_handball',
  'goal_confirmed',
  'goal_under_review',
]);

/** Frase do lance; null quando não há nada seguro a dizer (lance `other` do fornecedor). */
export function narrate(i: TimelineIncident, ctx: NarrationContext): string | null {
  const t = T[ctx.lang];
  const player = i.player?.name ?? null;
  const team = (i.scoring_team ?? i.team)?.name ?? null;
  const who = player ?? team ?? t.someone;
  const v: Vars = { player: who, team: team ?? '', assist: i.assist?.name ?? '' };
  const score = (s: { home: number; away: number }) =>
    ctx.home && ctx.away
      ? fill(t.score, { home: ctx.home, away: ctx.away, h: String(s.home), a: String(s.away) })
      : fill(t.scoreNoTeams, { h: String(s.home), a: String(s.away) });

  switch (i.kind) {
    case 'goal':
    case 'penalty_goal':
    case 'own_goal': {
      if (i.disallowed) return cap(fill(t.disallowed, v));
      if (i.kind === 'own_goal')
        return join(team ? fill(t.ownGoal, v) : null, i.score_after ? score(i.score_after) : null) || null;
      const side = i.scoring_team?.side;
      const after = i.score_after;
      let line = t.goalNoContext;
      if (i.flags.includes('opener')) line = t.opener;
      else if (i.flags.includes('equalizer')) line = t.equalizer;
      else if (i.flags.includes('go_ahead')) line = t.goAhead;
      else if (after && (side === 'home' || side === 'away')) {
        const other = side === 'home' ? 'away' : 'home';
        line = after[side] > after[other] ? t.extends : t.reduces;
      }
      const body = fill(line, v) + (i.kind === 'penalty_goal' ? t.penaltySuffix : '') + '.';
      return join(
        team ? fill(pick(t.goalLead, i.sequence), v) : null,
        cap(body),
        i.assist?.name && i.kind === 'goal' ? fill(t.assist, v) : null,
        after ? score(after) : null,
      );
    }
    case 'var': {
      const outcome = i.var_outcome ?? 'other';
      const base = cap(fill(t.var[outcome], { who, reason: t.varReason[outcome] ?? '' }));
      // gol anulado ou confirmado: o placar que vale depois do VAR
      if (GOAL_VAR.has(outcome) && outcome !== 'goal_under_review') {
        const s = ctx.scoreBefore;
        return join(
          base,
          outcome === 'goal_confirmed'
            ? score(s)
            : fill(t.stillScore, { h: String(s.home), a: String(s.away) }),
        );
      }
      return base;
    }
    case 'penalty_missed':
      return cap(fill(pick(t.penaltyMissed, i.sequence), v));
    case 'shootout_scored':
      return join(cap(fill(t.shootoutScored, v)), i.score_after ? score(i.score_after) : null);
    case 'shootout_missed':
      return cap(fill(t.shootoutMissed, v));
    case 'yellow_card':
      return team
        ? cap(fill(pick(t.yellow, i.sequence), v))
        : cap(fill(pick(t.yellow, i.sequence), v).replace(' ()', ''));
    case 'second_yellow':
      return team ? cap(fill(t.secondYellow, v)) : cap(fill(t.secondYellow, v).split('. ')[0]!) + '.';
    case 'red_card':
      return team ? cap(fill(t.red, v)) : cap(fill(t.red, v).split('. ')[0]!) + '.';
    case 'substitution': {
      const inn = i.player_in?.name;
      const out = i.player_out?.name;
      if (!inn || !out) return null;
      return fill(team ? t.sub : t.subNoTeam, { team: team ?? '', in: inn, out });
    }
    default:
      return null;
  }
}
