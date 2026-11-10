/**
 * Andamento das sugestões (puro, testado): de uma issue da repo de sugestões e do que mudou desde a última conferência,
 * o aviso que vai para a caixa de entrada de quem enviou.
 *
 * - Coluna: o histórico da issue (`ProjectV2ItemStatusChangedEvent`) diz para onde o card foi. Várias mudanças no mesmo
 *   intervalo viram um aviso só, com a coluna mais recente. Backlog não avisa (é onde toda sugestão cai ao chegar).
 * - Resposta: só comentário que começa com `/responder` vai para o usuário; o resto é conversa da equipe.
 * - Dono: quem enviou fica registrado no envio; para issue antiga, a referência opaca da ficha (`u_…`), procurada só na
 *   tabela de detalhes (a mensagem do usuário vem antes, num bloco cercado, e poderia trazer outra referência).
 */
import {
  FEEDBACK_ISSUE_TEXT,
  FEEDBACK_REPLY_COMMAND,
  FEEDBACK_STATUS_COLUMNS,
} from '@/lib/i18n/messages/feedback-issue';

export type FeedbackStatus = (typeof FEEDBACK_STATUS_COLUMNS)[keyof typeof FEEDBACK_STATUS_COLUMNS];

/** Colunas que avisam o usuário. */
export const NOTIFIED_STATUSES: readonly FeedbackStatus[] = [
  'review',
  'selected',
  'needsInfo',
  'inProgress',
  'delivered',
];

/** Teto da resposta da equipe na inbox. */
export const FEEDBACK_REPLY_MAX = 4000;

/** Marca no corpo das issues abertas pelo app: o job ignora as outras. */
export const APP_ISSUE_MARKER = '<!-- sugestao-app v=';

const strip = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

const COLUMN_BY_NAME = new Map(
  Object.entries(FEEDBACK_STATUS_COLUMNS).map(([name, key]) => [strip(name), key as FeedbackStatus]),
);

/** Chave da coluna pelo nome no GitHub (sem diferença de maiúscula ou acento); null se não for uma das seis. */
export function statusKey(name: string | null | undefined): FeedbackStatus | null {
  return name ? (COLUMN_BY_NAME.get(strip(name)) ?? null) : null;
}

/** Texto depois de `/responder`, ou null se o comentário não é para o usuário. */
export function replyText(body: string | null | undefined): string | null {
  const text = (body ?? '').replace(/\r\n?/g, '\n').trimStart();
  const cmd = FEEDBACK_REPLY_COMMAND;
  if (text.slice(0, cmd.length).toLowerCase() !== cmd) return null;
  // `/responderX` não é o comando
  if (text.length > cmd.length && !/\s/.test(text[cmd.length]!)) return null;
  const rest = text.slice(cmd.length).trim();
  return rest ? rest.slice(0, FEEDBACK_REPLY_MAX) : null;
}

/** Referência opaca de quem enviou, lida só na tabela de detalhes da ficha. */
export function issueUserRef(body: string | null | undefined): string | null {
  if (!body?.includes(APP_ISSUE_MARKER)) return null;
  // a issue editada no site do GitHub volta com \r\n
  body = body.replace(/\r\n?/g, '\n');
  const at = body.lastIndexOf(`\n### ${FEEDBACK_ISSUE_TEXT.details}\n`);
  if (at < 0) return null;
  const row = new RegExp(`^\\| ${FEEDBACK_ISSUE_TEXT.user} \\| \`(u_[0-9a-f]{12})\` \\|$`, 'm');
  return row.exec(body.slice(at))?.[1] ?? null;
}

export interface TimelineItem {
  id: string;
  kind: 'status' | 'comment';
  /** ISO 8601. */
  at: string;
  /** Nome da coluna de destino (`status`) ou corpo do comentário (`comment`). */
  value: string;
}

export interface IssueProgressState {
  /** Última coluna avisada (ou vista) desta issue. */
  status: FeedbackStatus | null;
  /** Instante do último item já processado (ISO). Sem estado, só o que é mais novo que `since` conta. */
  cursor: string | null;
}

export interface ProgressNotice {
  /** Coluna nova a avisar (null = só resposta). */
  status: FeedbackStatus | null;
  /** Respostas da equipe (`/responder`), na ordem, juntas. */
  body: string | null;
  /** Id do item mais recente que gerou o aviso: chave de idempotência. */
  source: string;
  at: string;
}

export interface ProgressResult {
  notice: ProgressNotice | null;
  next: IssueProgressState;
  /** Colunas com nome que o app não conhece (para o log). */
  unknown: string[];
}

/**
 * O que mudou numa issue desde `state.cursor` (ou desde `since`, na primeira vez): no máximo um aviso, com a coluna mais
 * recente (se mudou e avisa) e as respostas novas.
 */
export function issueProgress(
  items: readonly TimelineItem[],
  state: IssueProgressState,
  since: string,
): ProgressResult {
  const from = state.cursor ?? since;
  // por instante, não por texto: o GitHub manda `…30Z` e o banco devolve `…30.000Z` (e `Z` > `.` no texto)
  const t = (iso: string) => Date.parse(iso);
  const fromT = t(from);
  const sorted = [...items].sort((a, b) => t(a.at) - t(b.at));
  const fresh = sorted.filter((i) => t(i.at) > fromT);
  const unknown: string[] = [];
  // primeira vez: a coluna de partida é a última conhecida antes de `since` (o que é velho não avisa)
  const baseline =
    state.cursor === null
      ? (sorted
          .filter((i) => i.kind === 'status' && t(i.at) <= fromT)
          .map((i) => statusKey(i.value))
          .filter((k): k is FeedbackStatus => k !== null)
          .at(-1) ?? state.status)
      : state.status;
  state = { ...state, status: baseline };
  let status = state.status;
  let statusItem: TimelineItem | null = null;
  const replies: TimelineItem[] = [];
  for (const item of fresh) {
    if (item.kind === 'status') {
      const key = statusKey(item.value);
      if (!key) {
        // sem nome = o GitHub escondeu a coluna (permissão do token): também vai para o log
        unknown.push(item.value || '(coluna sem nome)');
        continue;
      }
      if (key !== status) statusItem = item;
      status = key;
    } else if (replyText(item.value)) {
      replies.push(item);
    }
  }
  // a coluna final é a que vale: ida e volta no mesmo dia não avisa
  const changed = statusItem !== null && status !== state.status && NOTIFIED_STATUSES.includes(status!);
  const last = fresh.at(-1);
  const next: IssueProgressState = { status, cursor: last?.at ?? from };
  if (!changed && !replies.length) return { notice: null, next, unknown };
  const sources = [...replies, ...(changed ? [statusItem!] : [])].sort((a, b) => t(a.at) - t(b.at));
  const newest = sources.at(-1)!;
  const body = replies.length
    ? replies
        .map((r) => replyText(r.value)!)
        .join('\n\n')
        .slice(0, FEEDBACK_REPLY_MAX)
    : null;
  return {
    notice: { status: changed ? status : null, body, source: newest.id, at: newest.at },
    next,
    unknown,
  };
}

/** Título da issue sem o rótulo do assunto (o trecho da mensagem de quem enviou). */
export function issueSnippet(title: string): string {
  const i = title.indexOf(': ');
  return (i >= 0 ? title.slice(i + 2) : title).slice(0, 140);
}
