/**
 * O jogo dentro do chat (#965), sem banco nem HTTP: quais mensagens de sistema a linha do tempo do jogo pede e o
 * texto delas em pt, es e en. Futebol primeiro; os outros esportes entram pelo início, intervalo e fim.
 *
 * A linha do tempo do fornecedor não tem identidade estável por lance: a posição de cada lance muda quando chega um
 * lance atrasado, e o writer troca a linha (novo id) em vez de avisar. Por isso nada aqui usa o id da linha:
 * `desiredGameMessages` olha a linha do tempo inteira e devolve as mensagens que ela pede, com chave semântica (time,
 * jogador, minuto). O chamador grava só o que mudou. Lance que trocou de posição continua com a mesma chave; gol
 * duplicado no fornecedor vira uma mensagem; VAR inferido e VAR do fornecedor para o mesmo gol viram um só.
 */

export const CHAT_GAME_KIND_LIST = ['kickoff', 'goal', 'red_card', 'var', 'half_time', 'full_time'] as const;
export type GameKind = (typeof CHAT_GAME_KIND_LIST)[number];

export interface TimelineIncident {
  sequence: number;
  minute: number | null;
  extra: number | null;
  /** Tipo normalizado (`goal`, `own_goal`, `penalty_missed`, `card`, `var`, `subst`...). */
  type: string;
  detail: string | null;
  participantId: string | null;
  personId: string | null;
  /** Cobrança da disputa de pênaltis (comentário "Penalty Shootout"). */
  shootout: boolean;
}

/** Gol que já virou mensagem e sumiu da linha do tempo (o fornecedor tirou): o VAR ainda pode anular. */
export interface StoredGoal {
  key: string;
  participantId: string | null;
  minute: number | null;
  extra: number | null;
  cancelled: boolean;
}

export interface DesiredGameMessage {
  key: string;
  kind: 'goal' | 'red_card' | 'var';
  minute: number | null;
  extra: number | null;
  detail: string | null;
  participantId: string | null;
  personId: string | null;
  /** Placar depois do gol, contado pela própria linha do tempo (só gol válido). */
  score: { home: number; away: number } | null;
  cancelled: boolean;
  /** Segundo amarelo (o vermelho veio por acúmulo). */
  secondYellow?: boolean;
}

/** Gol anulado: o VAR casa com o último gol do mesmo time até 5 min antes (como o writer, `retracted-goals.ts`). */
const VAR_WINDOW_MIN = 5;
/** Duas linhas do mesmo time e jogador a até 2 min são o mesmo gol (o fornecedor repete ou corrige o minuto). */
const SAME_GOAL_WINDOW_MIN = 2;

const RED = /red|second yellow|vermelh|roja/i;
const SECOND_YELLOW = /second yellow/i;
export const GOAL_CANCELLED = /goal (cancel|disallow)|no goal|gol anulad/i;

const at = (i: { minute: number | null; extra: number | null }) => (i.minute ?? 0) + (i.extra ?? 0) / 100;
const gap = (a: { minute: number | null; extra: number | null }, b: typeof a) => Math.abs(at(a) - at(b));
const minuteKey = (i: { minute: number | null; extra: number | null }) =>
  i.minute == null ? '-' : `${i.minute}${i.extra ? `+${i.extra}` : ''}`;

/**
 * Mensagens que a linha do tempo pede agora. `sides` = lado de cada time no jogo (para o placar); `stored` = gols já
 * anunciados que saíram da linha do tempo (o VAR pode anulá-los).
 */
export function desiredGameMessages(
  incidents: readonly TimelineIncident[],
  sides: ReadonlyMap<string, 'home' | 'away'>,
  stored: readonly StoredGoal[] = [],
): DesiredGameMessage[] {
  const ordered = [...incidents].sort((a, b) => at(a) - at(b) || a.sequence - b.sequence);
  type Goal = DesiredGameMessage & { ghost: boolean };
  const goals: Goal[] = [];
  for (const i of ordered) {
    if ((i.type !== 'goal' && i.type !== 'own_goal') || i.shootout) continue;
    if (/missed|cancel|disallow/i.test(i.detail ?? '')) continue;
    const twin = goals.find(
      (g) =>
        g.participantId === i.participantId && g.personId === i.personId && gap(g, i) <= SAME_GOAL_WINDOW_MIN,
    );
    if (twin) continue;
    goals.push({
      key: `goal:${i.participantId ?? '-'}:${i.personId ?? '-'}:${minuteKey(i)}`,
      kind: 'goal',
      minute: i.minute,
      extra: i.extra,
      detail: i.type === 'own_goal' ? 'Own Goal' : i.detail,
      participantId: i.participantId,
      personId: i.personId,
      score: null,
      cancelled: false,
      ghost: false,
    });
  }
  // gols anunciados que sumiram da linha do tempo: só entram se um VAR os anular
  const keys = new Set(goals.map((g) => g.key));
  for (const s of stored)
    if (!keys.has(s.key))
      goals.push({
        key: s.key,
        kind: 'goal',
        minute: s.minute,
        extra: s.extra,
        detail: null,
        participantId: s.participantId,
        personId: null,
        score: null,
        cancelled: false,
        ghost: true,
      });
  goals.sort((a, b) => at(a) - at(b));

  const out: DesiredGameMessage[] = [];
  const vars: DesiredGameMessage[] = [];
  const cancelVars = ordered.filter((i) => i.type === 'var' && GOAL_CANCELLED.test(i.detail ?? ''));
  for (const v of cancelVars) {
    const target = [...goals]
      .reverse()
      .find(
        (g) =>
          !g.cancelled &&
          (v.participantId == null || g.participantId === v.participantId) &&
          at(g) <= at(v) + 0.001 &&
          at(v) - at(g) <= VAR_WINDOW_MIN,
      );
    if (target) {
      target.cancelled = true;
      vars.push(varMessage(v, `var:goal:${target.key}`));
      continue;
    }
    // VAR repetido para um gol já anulado (o inferido do writer e depois o do fornecedor): uma mensagem só
    const already = goals.some(
      (g) =>
        g.cancelled &&
        (v.participantId == null || g.participantId === v.participantId) &&
        Math.abs(at(v) - at(g)) <= VAR_WINDOW_MIN,
    );
    if (!already) vars.push(varMessage(v, `var:cancel:${v.participantId ?? '-'}:${minuteKey(v)}`));
  }
  for (const v of ordered) {
    if (v.type !== 'var' || GOAL_CANCELLED.test(v.detail ?? '')) continue;
    const key = `var:${v.participantId ?? '-'}:${minuteKey(v)}:${(v.detail ?? '').toLowerCase()}`;
    if (!vars.some((x) => x.key === key)) vars.push(varMessage(v, key));
  }

  // placar pela própria linha do tempo, só gols válidos; gol contra soma para o time do lance (padrão da timeline)
  const score = { home: 0, away: 0 };
  for (const g of goals) {
    if (g.ghost && !g.cancelled) continue;
    if (!g.cancelled && g.participantId) {
      const side = sides.get(g.participantId);
      if (side) score[side] += 1;
      g.score = sides.size ? { ...score } : null;
    }
    const { ghost: _ghost, ...msg } = g;
    out.push(msg);
  }

  const reds = new Set<string>();
  for (const i of ordered) {
    if (i.type !== 'card' || !RED.test(i.detail ?? '')) continue;
    const key = `red:${i.personId ?? `${i.participantId ?? '-'}:${minuteKey(i)}`}`;
    if (reds.has(key)) continue;
    reds.add(key);
    out.push({
      key,
      kind: 'red_card',
      minute: i.minute,
      extra: i.extra,
      detail: i.detail,
      participantId: i.participantId,
      personId: i.personId,
      score: null,
      cancelled: false,
      ...(SECOND_YELLOW.test(i.detail ?? '') ? { secondYellow: true } : {}),
    });
  }
  return [...out, ...vars];
}

function varMessage(v: TimelineIncident, key: string): DesiredGameMessage {
  return {
    key,
    kind: 'var',
    minute: v.minute,
    extra: v.extra,
    detail: v.detail,
    participantId: v.participantId,
    personId: null,
    score: null,
    cancelled: false,
  };
}

/** Mensagem que vem da mudança de estado do jogo (não está na linha do tempo). */
export type StatusSignal =
  | { kind: 'kickoff'; key: 'status:kickoff' }
  | { kind: 'half_time'; key: 'status:break' }
  | { kind: 'full_time'; key: 'status:finished' };

/** Início, intervalo e fim pela troca de estado (`event.status_changed`). */
export function statusSignal(status: string | null, previous: string | null): StatusSignal | null {
  if (!status || status === previous) return null;
  if (status === 'live' && (previous === 'scheduled' || previous === 'starting' || previous === null))
    return { kind: 'kickoff', key: 'status:kickoff' };
  if (status === 'break' && previous !== 'break') return { kind: 'half_time', key: 'status:break' };
  if (status === 'finished') return { kind: 'full_time', key: 'status:finished' };
  return null;
}

export interface GameText {
  'pt-BR': string;
  es: string;
  en: string;
}

export interface GameTextInput {
  kind: GameKind;
  minute: number | null;
  extra: number | null;
  detail: string | null;
  team: { name: string } | null;
  player: string | null;
  score: { home: number; away: number } | null;
  cancelled?: boolean;
  secondYellow?: boolean;
}

const minuteOf = (m: number | null, extra: number | null) =>
  m == null ? '' : `${m}${extra ? `+${extra}` : ''}' `;
const scoreOf = (s: GameTextInput['score']) => (s ? ` ${s.home}-${s.away}` : '');

const VAR_DECISIONS: { re: RegExp; t: GameText }[] = [
  { re: GOAL_CANCELLED, t: { 'pt-BR': 'gol anulado', es: 'gol anulado', en: 'goal disallowed' } },
  { re: /goal confirmed/i, t: { 'pt-BR': 'gol confirmado', es: 'gol confirmado', en: 'goal confirmed' } },
  {
    re: /penalty confirmed/i,
    t: { 'pt-BR': 'pênalti confirmado', es: 'penal confirmado', en: 'penalty confirmed' },
  },
  { re: /penalty cancel/i, t: { 'pt-BR': 'pênalti anulado', es: 'penal anulado', en: 'penalty overturned' } },
  { re: /card upgrade/i, t: { 'pt-BR': 'cartão revisto', es: 'tarjeta revisada', en: 'card upgraded' } },
  {
    re: /card (downgrade|cancel)/i,
    t: { 'pt-BR': 'cartão revisto', es: 'tarjeta revisada', en: 'card overturned' },
  },
];
const VAR_REVIEW: GameText = { 'pt-BR': 'lance revisado', es: 'jugada revisada', en: 'play reviewed' };

/**
 * Texto curto da mensagem do jogo nos três idiomas. "Gol: Time (Autor)" em vez de "Gol do Time" (gênero do nome do
 * time); espanhol neutro (sem voseo nem regionalismo).
 */
export function gameText(i: GameTextInput): GameText {
  const at = minuteOf(i.minute, i.extra);
  const team = i.team?.name ? ` ${i.team.name}` : '';
  const who = i.player ? ` (${i.player})` : '';
  const own = /own goal/i.test(i.detail ?? '');
  const pen = /penalty/i.test(i.detail ?? '');
  switch (i.kind) {
    case 'goal': {
      // gol contra: o time do lance não diz de que lado foi (convenção do fornecedor), então só o autor
      const base: GameText = own
        ? {
            'pt-BR': `${at}⚽ Gol contra${who}.${scoreOf(i.score)}`,
            es: `${at}⚽ Gol en contra${who}.${scoreOf(i.score)}`,
            en: `${at}⚽ Own goal${who}.${scoreOf(i.score)}`,
          }
        : {
            'pt-BR': `${at}⚽ Gol${pen ? ' de pênalti' : ''}:${team}${who}.${scoreOf(i.score)}`,
            es: `${at}⚽ Gol${pen ? ' de penal' : ''}:${team}${who}.${scoreOf(i.score)}`,
            en: `${at}⚽ ${pen ? 'Penalty goal' : 'Goal'}:${team}${who}.${scoreOf(i.score)}`,
          };
      if (!i.cancelled) return tidy(base);
      return tidy({
        'pt-BR': `${base['pt-BR']} Anulado pelo VAR.`,
        es: `${base.es} Anulado por el VAR.`,
        en: `${base.en} Disallowed by VAR.`,
      });
    }
    case 'red_card':
      return tidy(
        i.secondYellow
          ? {
              'pt-BR': `${at}🟥 Segundo amarelo, expulso${who || team}.`,
              es: `${at}🟥 Segunda amarilla, expulsado${who || team}.`,
              en: `${at}🟥 Second yellow, sent off${who || team}.`,
            }
          : {
              'pt-BR': `${at}🟥 Cartão vermelho${who || team}.`,
              es: `${at}🟥 Tarjeta roja${who || team}.`,
              en: `${at}🟥 Red card${who || team}.`,
            },
      );
    case 'var': {
      const d = VAR_DECISIONS.find((x) => x.re.test(i.detail ?? ''))?.t ?? VAR_REVIEW;
      const where = team ? ` (${team.trim()})` : '';
      return tidy({
        'pt-BR': `${at}📺 VAR: ${d['pt-BR']}${where}.`,
        es: `${at}📺 VAR: ${d.es}${where}.`,
        en: `${at}📺 VAR: ${d.en}${where}.`,
      });
    }
    case 'kickoff':
      return { 'pt-BR': 'Começa o jogo!', es: '¡Comienza el partido!', en: 'Kickoff!' };
    case 'half_time':
      return tidy({
        'pt-BR': `Intervalo.${scoreOf(i.score)}`,
        es: `Descanso.${scoreOf(i.score)}`,
        en: `Break.${scoreOf(i.score)}`,
      });
    case 'full_time':
      return tidy({
        'pt-BR': `Fim de jogo.${scoreOf(i.score)}`,
        es: `Final del partido.${scoreOf(i.score)}`,
        en: `Full time.${scoreOf(i.score)}`,
      });
  }
}

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/ \./g, '.').replace(/: \./g, '.').trim();
const tidy = (t: GameText): GameText => ({ 'pt-BR': clean(t['pt-BR']), es: clean(t.es), en: clean(t.en) });

/** O cliente quer este tipo na sala? (`null` = todos). */
export const gameKindEnabled = (kinds: readonly string[] | null | undefined, kind: string): boolean =>
  !kinds || kinds.includes(kind);
