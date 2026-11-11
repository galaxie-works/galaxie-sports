/**
 * Conferência diária do andamento das sugestões (só no servidor). Lê as issues da repo de sugestões com o mesmo token
 * do envio (GraphQL: o histórico de colunas e os comentários de cada issue), compara com o que já foi visto e grava o
 * aviso na caixa de entrada de quem enviou (progress.ts decide o quê).
 *
 * Roda no `site` (ou no processo único do `next dev`): uma vez por dia, a partir de FEEDBACK_PROGRESS_HOUR_UTC, e quando
 * um admin pede "Verificar agora" no painel. A trava do Postgres impede duas conferências juntas (dois contêineres no
 * deploy), e o aviso tem chave única pelo item do GitHub, então repetir não duplica nada.
 */
import { pool } from '@/lib/auth/db';
import {
  allUserIds,
  insertNotice,
  readIssueStates,
  readProgressRun,
  saveIssueState,
  saveProgressRun,
  type StoredIssue,
} from '@/lib/notifications/store';

import { FeedbackGithub } from './github';
import { APP_ISSUE_MARKER, issueProgress, issueSnippet, issueUserRef, type TimelineItem } from './progress';
import { readFeedbackSettings } from './settings-db';
import { feedbackRef } from './signing';

/** Hora (UTC) da conferência diária: 09:00 em Brasília. */
export const FEEDBACK_PROGRESS_HOUR_UTC = 12;
/** De quanto em quanto tempo o processo olha se já é hora. */
const TICK_MS = 30 * 60_000;
/** Depois de uma falha, espera isto antes de tentar de novo no mesmo dia. */
const RETRY_MS = 2 * 60 * 60_000;
/** Issue fechada há mais que isto não é mais lida. */
const CLOSED_WINDOW_MS = 90 * 24 * 60 * 60_000;
/** Teto de páginas por estado (50 issues cada). Passar dele é falha, não conferência completa. */
const MAX_PAGES = 100;
/** Chave da trava (pg_try_advisory_lock): número fixo, só desta rotina. */
const PROGRESS_LOCK = 7_301_202_611;

// abertas: todas; fechadas: da atualizada mais recente para trás, até a janela (a leitura para ali)
const QUERY = `query($owner: String!, $name: String!, $after: String, $states: [IssueState!]) {
  repository(owner: $owner, name: $name) {
    issues(first: 50, after: $after, states: $states, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title body closedAt updatedAt
        timelineItems(last: 100, itemTypes: [PROJECT_V2_ITEM_STATUS_CHANGED_EVENT, ISSUE_COMMENT]) {
          nodes {
            __typename
            ... on ProjectV2ItemStatusChangedEvent { id createdAt status }
            ... on IssueComment { id createdAt body }
          }
        }
      }
    }
  }
}`;

interface IssueNode {
  number: number;
  title: string;
  body: string | null;
  closedAt: string | null;
  updatedAt: string;
  timelineItems: {
    nodes: ({ __typename: string; id: string; createdAt: string; status?: string; body?: string } | null)[];
  };
}

interface IssuesPage {
  repository: {
    issues: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (IssueNode | null)[] };
  } | null;
}

export type ProgressOutcome =
  | { status: 'ok'; issues: number; notices: number }
  | { status: 'busy' | 'off' }
  | { status: 'error'; error: string };

const toItems = (issue: IssueNode): TimelineItem[] =>
  issue.timelineItems.nodes.flatMap((n): TimelineItem[] => {
    if (!n) return [];
    if (n.__typename === 'ProjectV2ItemStatusChangedEvent')
      return [{ id: n.id, kind: 'status' as const, at: n.createdAt, value: n.status ?? '' }];
    if (n.__typename === 'IssueComment')
      return [{ id: n.id, kind: 'comment' as const, at: n.createdAt, value: n.body ?? '' }];
    return [];
  });

/** Uma conferência completa (`scheduled`: a do relógio, que não repete no mesmo dia). */
export async function runFeedbackProgress(
  opts: { scheduled?: boolean } = {},
  now = new Date(),
): Promise<ProgressOutcome> {
  const settings = await readFeedbackSettings();
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!settings.enabled || !settings.config || !secret) return { status: 'off' };

  const lock = await pool.connect();
  let locked = false;
  try {
    locked = (await lock.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [PROGRESS_LOCK]))
      .rows[0]!.ok;
    if (!locked) return { status: 'busy' };
    // rodada do relógio: outro contêiner pode ter acabado de rodar entre a olhada e a trava
    if (opts.scheduled && !progressDue(await readProgressRun(), now)) return { status: 'busy' };
    const startedAt = new Date();
    try {
      const result = await syncAll(new FeedbackGithub(settings.config), secret, now);
      await saveProgressRun({ startedAt, ok: true, error: null, ...result });
      console.info('[feedback] andamento conferido', JSON.stringify(result));
      return { status: 'ok', ...result };
    } catch (err) {
      // o detalhe do GitHub pode trazer o nome da repo, nunca o token
      const error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      console.error('[feedback] falha ao conferir o andamento', error);
      await saveProgressRun({ startedAt, ok: false, error, issues: 0, notices: 0 }).catch(() => {});
      return { status: 'error', error };
    }
  } finally {
    if (locked) await lock.query('select pg_advisory_unlock($1)', [PROGRESS_LOCK]).catch(() => {});
    lock.release();
  }
}

async function syncAll(gh: FeedbackGithub, secret: string, now: Date) {
  await gh.ensurePrivate();
  const [owner, name] = gh.repo.split('/') as [string, string];
  const states = await readIssueStates(gh.repo);
  const lastOk = (await readProgressRun())?.okAt;
  // issue sem estado: só o que aconteceu desde a última conferência boa (ou no último dia) avisa
  const since = lastOk ?? new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  let refs: Map<string, string> | null = null;
  const ownerOf = async (issue: IssueNode, stored: StoredIssue | undefined) => {
    if (stored?.userId) return stored.userId;
    const ref = issueUserRef(issue.body);
    if (!ref) return null;
    refs ??= new Map((await allUserIds()).map((id) => [feedbackRef(secret, 'u', id), id]));
    return refs.get(ref) ?? null;
  };

  let issues = 0;
  let notices = 0;
  const unknown = new Set<string>();
  const closedFloor = now.getTime() - CLOSED_WINDOW_MS;
  for (const state of ['OPEN', 'CLOSED'] as const) {
    let after: string | null = null;
    let done = false;
    for (let page = 0; !done; page++) {
      // leitura cortada não pode virar "conferido": a issue aberta mais antiga sumiria todo dia
      if (page === MAX_PAGES)
        throw new Error(
          `mais de ${MAX_PAGES * 50} issues ${state === 'OPEN' ? 'abertas' : 'fechadas'}: leitura incompleta`,
        );
      const data: IssuesPage = await gh.graphql<IssuesPage>(QUERY, { owner, name, after, states: [state] });
      const conn = data.repository?.issues;
      if (!conn) throw new Error('repo de sugestões não encontrada pelo GraphQL');
      for (const issue of conn.nodes) {
        if (!issue) continue;
        // fechadas vêm da atualizada mais recente: passou da janela, o resto também passou
        if (state === 'CLOSED' && Date.parse(issue.updatedAt) < closedFloor) {
          done = true;
          break;
        }
        await visit(issue);
      }
      if (!conn.pageInfo.hasNextPage) done = true;
      after = conn.pageInfo.endCursor;
    }
  }
  if (unknown.size)
    console.warn('[feedback] colunas que o app não conhece (sem aviso):', JSON.stringify([...unknown]));
  return { issues, notices };

  async function visit(issue: IssueNode) {
    if (!issue.body?.includes(APP_ISSUE_MARKER)) return;
    if (issue.closedAt && Date.parse(issue.closedAt) < closedFloor) return;
    issues++;
    const stored = states.get(issue.number);
    const userId = await ownerOf(issue, stored);
    const result = issueProgress(
      toItems(issue),
      { status: stored?.status ?? null, cursor: stored?.cursor ?? null },
      since,
    );
    result.unknown.forEach((u) => unknown.add(u));
    if (result.notice && userId) {
      const inserted = await insertNotice({
        userId,
        source: `${gh.repo}#${issue.number}@${result.notice.source}`,
        repo: gh.repo,
        issue: issue.number,
        title: issueSnippet(issue.title),
        status: result.notice.status,
        body: result.notice.body,
        at: result.notice.at,
      });
      if (inserted) notices++;
    }
    await saveIssueState(gh.repo, issue.number, { userId, ...result.next, closedAt: issue.closedAt });
  }
}

/** Já passou da hora de hoje e a conferência de hoje ainda não saiu? */
export function progressDue(
  run: { okAt: string | null; finishedAt: string | null; error: string | null } | null,
  now: Date,
): boolean {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), FEEDBACK_PROGRESS_HOUR_UTC),
  );
  if (now < today) return false;
  if (run?.okAt && Date.parse(run.okAt) >= today.getTime()) return false;
  // falhou há pouco: espera antes de tentar de novo
  if (run?.error && run.finishedAt && now.getTime() - Date.parse(run.finishedAt) < RETRY_MS) return false;
  return true;
}

declare global {
  var __galaxieFeedbackProgress: ReturnType<typeof setInterval> | undefined;
}

/** Relógio da conferência diária (instrumentation.ts, só no site). Um por processo. */
export function startFeedbackProgress(): void {
  if (globalThis.__galaxieFeedbackProgress || process.env.FEEDBACK_PROGRESS === 'off') return;
  const tick = async () => {
    try {
      if (progressDue(await readProgressRun(), new Date())) await runFeedbackProgress({ scheduled: true });
    } catch (err) {
      console.error('[feedback] relógio do andamento', err instanceof Error ? err.message : err);
    }
  };
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  globalThis.__galaxieFeedbackProgress = timer;
  // a primeira olhada espera o setup do banco e o resto da subida
  setTimeout(() => void tick(), 2 * 60_000).unref?.();
}
