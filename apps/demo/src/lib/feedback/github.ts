/**
 * Entrega do "Sugerir ou reportar algo" ao GitHub (só no servidor): a demo abre a issue direto pela API REST numa
 * repositório PRIVADO só de sugestões (`galaxie-works/galaxie-sports-customer-voice`), com um token só dele. Nada
 * passa por Actions (o payload não fica em log). As imagens ficam no bucket privado e entram na issue por link
 * assinado da demo (lib/feedback/signing.ts).
 *
 * Antes de cada envio a repo é conferida: se não for privada (ou não der para saber), nada é enviado.
 *
 *   FEEDBACK_GITHUB_TOKEN  fine-grained PAT só da repo de sugestões, com Issues: read and write e nada mais
 *   FEEDBACK_GITHUB_REPO   dono/repositório (obrigatório e sem padrão: nunca cai na repo principal)
 *
 * Os dois também podem vir do painel (Ajustes → Sistema → Sugestões), que vale mais que o env (settings.ts). Sem token
 * ou sem repo, o formulário responde "indisponível". O token nunca vai ao navegador.
 */
import { FEEDBACK_REPO_PATTERN } from '@galaxie/runtime-config';

import {
  FEEDBACK_ISSUE_TEXT,
  FEEDBACK_LABEL_COLORS,
  FEEDBACK_LABELS,
} from '@/lib/i18n/messages/feedback-issue';

import type { FeedbackSubject } from './rules';

export interface FeedbackGithubConfig {
  token: string;
  repo: string;
}

export function feedbackGithubConfig(
  env: Record<string, string | undefined> = process.env,
): FeedbackGithubConfig | null {
  const token = env.FEEDBACK_GITHUB_TOKEN?.trim();
  const repo = env.FEEDBACK_GITHUB_REPO?.trim();
  if (!token || !repo || !FEEDBACK_REPO_PATTERN.test(repo)) return null;
  return { token, repo };
}

export class FeedbackGithubError extends Error {
  constructor(
    readonly code: 'not_private' | 'http',
    message: string,
    /** Status HTTP do GitHub (`http`). */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FeedbackGithubError';
  }
}

/** Cliente mínimo da API REST do GitHub para a repo de sugestões. */
export class FeedbackGithub {
  /** Confirmação de que a repo é privada, guardada por alguns minutos (ms do instante da conferência). */
  private privateCheckedAt = 0;

  constructor(
    private readonly config: FeedbackGithubConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(`https://api.github.com/repos/${this.config.repo}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.config.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'galaxie-demo',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
  }

  private async json<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new FeedbackGithubError('http', `${what}: HTTP ${res.status} ${detail}`, res.status);
    }
    return (await res.json()) as T;
  }

  /** Recusa repo pública (ou que não dá para ler): a conferência vale por 10 minutos. */
  async ensurePrivate(): Promise<void> {
    if (this.now() - this.privateCheckedAt < 10 * 60_000) return;
    const repo = await this.json<{ private?: boolean }>(await this.call('GET', ''), 'repo');
    if (repo.private !== true)
      throw new FeedbackGithubError('not_private', `${this.config.repo} is not private`);
    this.privateCheckedAt = this.now();
  }

  /** Cria o rótulo do assunto se faltar (não mexe na cor de um que alguém já ajustou). */
  async ensureLabel(subject: FeedbackSubject): Promise<string> {
    const name = FEEDBACK_LABELS[subject];
    const found = await this.call('GET', `/labels/${encodeURIComponent(name)}`);
    if (found.ok) return name;
    if (found.status !== 404) await this.json(found, 'label');
    const created = await this.call('POST', '/labels', {
      name,
      color: FEEDBACK_LABEL_COLORS[subject],
      description: FEEDBACK_ISSUE_TEXT.labelDescription,
    });
    // 422 = outro envio criou ao mesmo tempo: basta existir
    if (!created.ok && created.status !== 422) await this.json(created, 'label');
    return name;
  }

  async createIssue(title: string, body: string, label: string): Promise<number> {
    const res = await this.call('POST', '/issues', { title, body, labels: [label] });
    return (await this.json<{ number: number }>(res, 'issue')).number;
  }

  /** Comentário na issue (a resposta de quem enviou, pela inbox). */
  async comment(issue: number, body: string): Promise<void> {
    await this.json(await this.call('POST', `/issues/${issue}/comments`, { body }), 'comment');
  }

  /**
   * Consulta GraphQL com o mesmo token. O fine-grained de Issues lê o histórico de colunas da issue
   * (`ProjectV2ItemStatusChangedEvent`), mas não o quadro em si: campo do projeto volta como erro FORBIDDEN.
   */
  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.token}`,
        'content-type': 'application/json',
        'user-agent': 'galaxie-demo',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    });
    const out = await this.json<{ data?: T; errors?: { message?: string }[] }>(res, 'graphql');
    const detail = (out.errors ?? [])
      .map((e) => e.message)
      .join('; ')
      .slice(0, 300);
    if (!out.data) throw new FeedbackGithubError('http', `graphql: ${detail || 'sem dados'}`);
    // resposta parcial (campo negado ao token): segue com o que veio, mas fica no log
    if (detail) console.warn('[feedback] graphql respondeu com erros parciais:', detail);
    return out.data;
  }

  get repo(): string {
    return this.config.repo;
  }
}

export type FeedbackTargetProblem = 'not_private' | 'bad_token' | 'no_access' | 'unreachable';

/**
 * Confere token e repo antes de gravar no painel: a repo tem de responder 200 e ser privada. Devolve o motivo da
 * recusa (sem detalhe do GitHub, que não vai à tela) ou null se está tudo certo.
 */
export async function checkFeedbackTarget(
  config: FeedbackGithubConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<FeedbackTargetProblem | null> {
  try {
    await new FeedbackGithub(config, fetchImpl).ensurePrivate();
    return null;
  } catch (err) {
    if (!(err instanceof FeedbackGithubError)) return 'unreachable';
    if (err.code === 'not_private') return 'not_private';
    if (err.status === 401) return 'bad_token';
    // 404 é o que o GitHub responde para repo inexistente e para repo privada que o token não enxerga
    if (err.status === 403 || err.status === 404) return 'no_access';
    return 'unreachable';
  }
}
