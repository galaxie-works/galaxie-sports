/**
 * O jogo dentro do chat (#965), sem banco nem HTTP: qual lance vira mensagem de sistema e o texto dela em pt, es e
 * en. Futebol primeiro; os outros esportes entram pelo início, intervalo e fim (os lances deles chegam depois).
 */

export const CHAT_GAME_KIND_LIST = ['kickoff', 'goal', 'red_card', 'var', 'half_time', 'full_time'] as const;
export type GameKind = (typeof CHAT_GAME_KIND_LIST)[number];

/** O que sai de uma mudança do tempo real (`event.incident_added` ou `event.status_changed`). */
export type GameSignal =
  | {
      kind: 'goal' | 'red_card' | 'var';
      /** `incident:<id>`: o mesmo lance nunca vira duas mensagens. */
      sourceKey: string;
      incident: {
        id: string;
        minute: number | null;
        extra: number | null;
        detail: string | null;
        participantId: string | null;
        personId: string | null;
      };
      /** VAR que anulou um gol: a mensagem do gol é marcada como anulada. */
      cancelsGoal: boolean;
    }
  | { kind: 'kickoff' | 'half_time' | 'full_time'; sourceKey: string };

interface ChangeLike {
  topic: string;
  data: Record<string, unknown>;
  previous?: Record<string, unknown> | undefined;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const MISSED = /missed|cancel|disallow|anulad/i;
const RED = /red|second yellow|vermelh|roja/i;
const GOAL_CANCELLED = /goal (cancel|disallow)|no goal|gol anulad|gol anulado|gol anulada/i;

/** Lances da mudança que viram mensagem (uma mudança de lances pode trazer vários). */
export function gameSignals(change: ChangeLike): GameSignal[] {
  if (change.topic === 'event.incident_added') {
    const list = Array.isArray(change.data.incidents)
      ? (change.data.incidents as Record<string, unknown>[])
      : [];
    const out: GameSignal[] = [];
    for (const i of list) {
      const id = str(i.id);
      const type = str(i.type)?.toLowerCase();
      if (!id || !type) continue;
      const detail = str(i.detail);
      const incident = {
        id,
        minute: num(i.minute),
        extra: num(i.extra),
        detail,
        participantId: str(i.participant_id),
        personId: str(i.person_id),
      };
      if (type === 'goal' && !MISSED.test(detail ?? ''))
        out.push({ kind: 'goal', sourceKey: `incident:${id}`, incident, cancelsGoal: false });
      else if (type === 'card' && RED.test(detail ?? ''))
        out.push({ kind: 'red_card', sourceKey: `incident:${id}`, incident, cancelsGoal: false });
      else if (type === 'var')
        out.push({
          kind: 'var',
          sourceKey: `incident:${id}`,
          incident,
          cancelsGoal: GOAL_CANCELLED.test(detail ?? ''),
        });
    }
    return out;
  }
  if (change.topic === 'event.status_changed') {
    const status = str(change.data.status);
    const before = str(change.previous?.status);
    const detail = str(change.data.status_detail);
    if (status === before) return [];
    if (status === 'live' && (before === 'scheduled' || before === 'starting' || before === null))
      return [{ kind: 'kickoff', sourceKey: 'status:kickoff' }];
    if (status === 'break') return [{ kind: 'half_time', sourceKey: `status:break:${detail ?? 'HT'}` }];
    if (status === 'finished') return [{ kind: 'full_time', sourceKey: 'status:finished' }];
  }
  return [];
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
}

const minuteOf = (m: number | null, extra: number | null) =>
  m == null ? '' : `${m}${extra ? `+${extra}` : ''}' `;
const scoreOf = (s: GameTextInput['score']) => (s ? ` ${s.home}-${s.away}` : '');

/** Texto curto da mensagem do jogo nos três idiomas. */
export function gameText(i: GameTextInput): GameText {
  const at = minuteOf(i.minute, i.extra);
  const team = i.team?.name ?? '';
  const who = i.player ? ` (${i.player})` : '';
  const own = /own goal/i.test(i.detail ?? '');
  const pen = /penalty/i.test(i.detail ?? '');
  switch (i.kind) {
    case 'goal': {
      const base = {
        'pt-BR': `${at}⚽ Gol${own ? ' contra' : pen ? ' de pênalti' : ''} ${team ? `do ${team}` : ''}${who}.${scoreOf(i.score)}`,
        es: `${at}⚽ Gol${own ? ' en contra' : pen ? ' de penal' : ''} ${team ? `de ${team}` : ''}${who}.${scoreOf(i.score)}`,
        en: `${at}⚽ ${own ? 'Own goal' : pen ? 'Penalty goal' : 'Goal'}${team ? ` for ${team}` : ''}${who}.${scoreOf(i.score)}`,
      };
      if (!i.cancelled) return tidy(base);
      return tidy({
        'pt-BR': `${base['pt-BR']} Anulado pelo VAR.`,
        es: `${base.es} Anulado por el VAR.`,
        en: `${base.en} Disallowed by VAR.`,
      });
    }
    case 'red_card':
      return tidy({
        'pt-BR': `${at}🟥 Cartão vermelho${who || (team ? ` (${team})` : '')}.`,
        es: `${at}🟥 Tarjeta roja${who || (team ? ` (${team})` : '')}.`,
        en: `${at}🟥 Red card${who || (team ? ` (${team})` : '')}.`,
      });
    case 'var': {
      const cancelled = GOAL_CANCELLED.test(i.detail ?? '');
      return tidy({
        'pt-BR': `${at}📺 VAR: ${cancelled ? 'gol anulado' : 'revisão do lance'}${team ? ` (${team})` : ''}.`,
        es: `${at}📺 VAR: ${cancelled ? 'gol anulado' : 'revisión de la jugada'}${team ? ` (${team})` : ''}.`,
        en: `${at}📺 VAR: ${cancelled ? 'goal disallowed' : 'reviewing the play'}${team ? ` (${team})` : ''}.`,
      });
    }
    case 'kickoff':
      return { 'pt-BR': 'Começa o jogo!', es: '¡Empieza el partido!', en: 'Kickoff!' };
    case 'half_time':
      return tidy({
        'pt-BR': `Intervalo.${scoreOf(i.score)}`,
        es: `Entretiempo.${scoreOf(i.score)}`,
        en: `Half-time.${scoreOf(i.score)}`,
      });
    case 'full_time':
      return tidy({
        'pt-BR': `Fim de jogo.${scoreOf(i.score)}`,
        es: `Final del partido.${scoreOf(i.score)}`,
        en: `Full time.${scoreOf(i.score)}`,
      });
  }
}

const tidy = (t: GameText): GameText => ({
  'pt-BR': t['pt-BR'].replace(/\s+/g, ' ').replace(' .', '.').trim(),
  es: t.es.replace(/\s+/g, ' ').replace(' .', '.').trim(),
  en: t.en.replace(/\s+/g, ' ').replace(' .', '.').trim(),
});

/** O cliente quer este tipo na sala? (`null` = todos). */
export const gameKindEnabled = (kinds: readonly string[] | null | undefined, kind: GameKind): boolean =>
  !kinds || kinds.includes(kind);
