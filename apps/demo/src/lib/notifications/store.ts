/**
 * Caixa de entrada no banco (só no servidor): leitura e marcação do usuário, gravação dos avisos pelo job do andamento
 * e o registro issue → quem enviou. Toda leitura e escrita do usuário filtra pelo `user_id` da sessão.
 */
import { pool } from '@/lib/auth/db';
import { statusKey, type FeedbackStatus, type IssueProgressState } from '@/lib/feedback/progress';

export const INBOX_LIMIT = 30;

export interface InboxItem {
  id: string;
  status: FeedbackStatus | null;
  /** Trecho da sugestão (título da issue sem o assunto). */
  snippet: string | null;
  /** Resposta da equipe. */
  body: string | null;
  createdAt: string;
  read: boolean;
  /** Pede mais informações e ainda espera a resposta de quem enviou. */
  canAnswer: boolean;
  answered: boolean;
}

export interface Inbox {
  items: InboxItem[];
  unread: number;
}

interface Row {
  id: string;
  status: string | null;
  issue_title: string | null;
  body: string | null;
  created_at: Date;
  read_at: Date | null;
  answered_at: Date | null;
  issue_status: string | null;
  latest: boolean;
}

/**
 * O aviso pede resposta? A issue segue em "Necessita mais informações", o aviso é o mais recente dela e ainda não foi
 * respondido. Vale tanto o aviso da coluna quanto o de só resposta (`/responder` com a issue já parada lá).
 */
export function answerable(n: {
  status: FeedbackStatus | null;
  answered: boolean;
  issueStatus: string | null;
  latest: boolean;
}): boolean {
  return (
    n.latest &&
    !n.answered &&
    n.issueStatus === 'needsInfo' &&
    (n.status === 'needsInfo' || n.status === null)
  );
}

export async function readInbox(userId: string, limit = INBOX_LIMIT): Promise<Inbox> {
  const [{ rows }, unread] = await Promise.all([
    pool.query<Row>(
      `select n.id::text, n.status, n.issue_title, n.body, n.created_at, n.read_at, n.answered_at,
              f.status as issue_status,
              row_number() over (partition by n.repo, n.issue_number order by n.created_at desc, n.id desc) = 1
                as latest
         from notification n
         left join feedback_issue f on f.repo = n.repo and f.issue_number = n.issue_number
        where n.user_id = $1
        order by n.created_at desc, n.id desc
        limit $2`,
      [userId, limit],
    ),
    pool.query<{ n: number }>(
      'select count(*)::int as n from notification where user_id = $1 and read_at is null',
      [userId],
    ),
  ]);
  return {
    unread: unread.rows[0]?.n ?? 0,
    items: rows.map((r) => {
      const status = statusKey(r.status) ?? (r.status as FeedbackStatus | null);
      return {
        id: r.id,
        status,
        snippet: r.issue_title,
        body: r.body,
        createdAt: r.created_at.toISOString(),
        read: r.read_at !== null,
        answered: r.answered_at !== null,
        canAnswer: answerable({
          status,
          answered: r.answered_at !== null,
          issueStatus: r.issue_status,
          latest: r.latest,
        }),
      };
    }),
  };
}

/** Marca como lidos os avisos do usuário (todos, ou só os ids dados). */
export async function markInboxRead(userId: string, ids?: readonly string[]): Promise<void> {
  if (ids)
    await pool.query(
      `update notification set read_at = now()
        where user_id = $1 and read_at is null and id = any($2::bigint[])`,
      [userId, ids.filter((id) => /^\d{1,18}$/.test(id))],
    );
  else
    await pool.query('update notification set read_at = now() where user_id = $1 and read_at is null', [
      userId,
    ]);
}

/** Aviso do usuário que ainda pode ser respondido (mesma regra de `answerable`, conferida no banco). */
export async function answerableNotice(
  userId: string,
  id: string,
): Promise<{ repo: string; issue: number } | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  const { rows } = await pool.query<{ repo: string; issue_number: number }>(
    `select n.repo, n.issue_number
       from notification n
       join feedback_issue f on f.repo = n.repo and f.issue_number = n.issue_number
      where n.id = $1 and n.user_id = $2 and (n.status = 'needsInfo' or n.status is null)
        and n.answered_at is null and f.status = 'needsInfo' and f.user_id = $2
        and not exists (
          select 1 from notification m
           where m.repo = n.repo and m.issue_number = n.issue_number
             and (m.created_at, m.id) > (n.created_at, n.id))`,
    [id, userId],
  );
  const row = rows[0];
  return row ? { repo: row.repo, issue: row.issue_number } : null;
}

/** Reserva a resposta (atômico): `false` se outra chamada já respondeu. */
export async function reserveAnswer(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `update notification set answered_at = now(), read_at = coalesce(read_at, now())
      where id = $1 and user_id = $2 and answered_at is null`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

/** Desfaz a reserva quando o comentário não saiu. */
export async function releaseAnswer(userId: string, id: string): Promise<void> {
  await pool.query('update notification set answered_at = null where id = $1 and user_id = $2', [id, userId]);
}

/** No envio: a issue é deste usuário (o job não precisa adivinhar pela referência opaca). */
export async function recordFeedbackIssue(repo: string, issue: number, userId: string): Promise<void> {
  await pool.query(
    `insert into feedback_issue (repo, issue_number, user_id) values ($1, $2, $3)
     on conflict (repo, issue_number) do update set user_id = excluded.user_id, updated_at = now()`,
    [repo, issue, userId],
  );
}

// ── job do andamento ───────────────────────────────────────────────────────────

export interface StoredIssue extends IssueProgressState {
  userId: string | null;
}

export async function readIssueStates(repo: string): Promise<Map<number, StoredIssue>> {
  const { rows } = await pool.query<{
    issue_number: number;
    user_id: string | null;
    status: string | null;
    synced_until: Date | null;
  }>('select issue_number, user_id, status, synced_until from feedback_issue where repo = $1', [repo]);
  return new Map(
    rows.map((r) => [
      r.issue_number,
      {
        userId: r.user_id,
        status: statusKey(r.status) ?? (r.status as FeedbackStatus | null),
        cursor: r.synced_until?.toISOString() ?? null,
      },
    ]),
  );
}

export async function saveIssueState(repo: string, issue: number, state: StoredIssue): Promise<void> {
  await pool.query(
    `insert into feedback_issue (repo, issue_number, user_id, status, synced_until, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (repo, issue_number) do update
       set user_id = coalesce(feedback_issue.user_id, excluded.user_id),
           status = excluded.status, synced_until = excluded.synced_until, updated_at = now()`,
    [repo, issue, state.userId, state.status, state.cursor],
  );
}

export interface NewNotice {
  userId: string;
  source: string;
  repo: string;
  issue: number;
  title: string;
  status: FeedbackStatus | null;
  body: string | null;
  at: string;
}

/** Grava o aviso; `false` se o mesmo item do GitHub já tinha virado aviso. */
export async function insertNotice(n: NewNotice): Promise<boolean> {
  const { rowCount } = await pool.query(
    `insert into notification (user_id, kind, source, repo, issue_number, issue_title, status, body, created_at)
     values ($1, 'feedback', $2, $3, $4, $5, $6, $7, $8)
     on conflict (source) do nothing`,
    [n.userId, n.source, n.repo, n.issue, n.title, n.status, n.body, n.at],
  );
  return (rowCount ?? 0) > 0;
}

export interface ProgressRun {
  startedAt: string | null;
  finishedAt: string | null;
  okAt: string | null;
  error: string | null;
  issues: number;
  notices: number;
}

export async function readProgressRun(): Promise<ProgressRun | null> {
  try {
    const { rows } = await pool.query<{
      started_at: Date | null;
      finished_at: Date | null;
      ok_at: Date | null;
      error: string | null;
      issues: number;
      notices: number;
    }>('select * from feedback_progress_run where id = 1');
    const r = rows[0];
    if (!r) return null;
    const iso = (d: Date | null) => d?.toISOString() ?? null;
    return {
      startedAt: iso(r.started_at),
      finishedAt: iso(r.finished_at),
      okAt: iso(r.ok_at),
      error: r.error,
      issues: r.issues,
      notices: r.notices,
    };
  } catch (err) {
    // tabela ainda não criada (contêiner antigo): sem conferência registrada
    if ((err as { code?: string }).code === '42P01') return null;
    throw err;
  }
}

export async function saveProgressRun(run: {
  startedAt: Date;
  ok: boolean;
  error: string | null;
  issues: number;
  notices: number;
}): Promise<void> {
  await pool.query(
    // ok_at = início da conferência: o que aconteceu durante ela entra na próxima (since de issue nova)
    `insert into feedback_progress_run (id, started_at, finished_at, ok_at, error, issues, notices)
     values (1, $1, now(), case when $2 then $1::timestamptz end, $3, $4, $5)
     on conflict (id) do update set started_at = excluded.started_at, finished_at = now(),
       ok_at = case when $2 then $1::timestamptz else feedback_progress_run.ok_at end,
       error = excluded.error, issues = excluded.issues, notices = excluded.notices`,
    [run.startedAt, run.ok, run.error, run.issues, run.notices],
  );
}

/** Ids de todos os usuários, para achar o dono de uma issue antiga pela referência opaca. */
export async function allUserIds(): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>('select id from "user"');
  return rows.map((r) => r.id);
}
