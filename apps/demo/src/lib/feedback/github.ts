/**
 * Entrega do "Sugerir ou reportar algo" ao GitHub (só no servidor): a demo abre a issue direto pela API REST numa
 * repositório PRIVADO só de sugestões, com um token só dele. Nada passa por Actions (o payload não fica em log) nem
 * pelo bucket público: as imagens são gravadas na própria repo privada (`anexos/<aaaa-mm>/<uuid>.<ext>`) e a issue as
 * mostra por link da repo, que só quem tem acesso a ela abre.
 *
 * Antes de cada envio a repo é conferida: se não for privada (ou não der para saber), nada é enviado. O conteúdo é
 * dado de cliente (mensagem livre, e-mail e tenant parcialmente mascarados, prints) e não pode cair numa repo pública.
 *
 *   FEEDBACK_GITHUB_TOKEN  fine-grained PAT só da repo de sugestões: Issues read/write e Contents read/write
 *   FEEDBACK_GITHUB_REPO   dono/repositório (obrigatório; sem ele, envio desligado)
 *
 * Sem token ou sem repo, o formulário responde "indisponível". O token nunca vai ao navegador.
 */
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

const REPO_RE = /^[A-Za-z0-9-]+\/(?!\.)[\w.-]+$/;

export function feedbackGithubConfig(
  env: Record<string, string | undefined> = process.env,
): FeedbackGithubConfig | null {
  const token = env.FEEDBACK_GITHUB_TOKEN?.trim();
  const repo = env.FEEDBACK_GITHUB_REPO?.trim();
  if (!token || !repo || !REPO_RE.test(repo)) return null;
  return { token, repo };
}

export class FeedbackGithubError extends Error {
  constructor(
    readonly code: 'not_private' | 'http',
    message: string,
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
      throw new FeedbackGithubError('http', `${what}: HTTP ${res.status} ${detail}`);
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

  /** Grava a imagem na repo e devolve o link que a issue usa (abre só para quem tem acesso à repo). */
  async uploadAttachment(path: string, body: Uint8Array): Promise<string> {
    const res = await this.call('PUT', `/contents/${path}`, {
      message: `App feedback attachment (${path.split('/').pop()})`,
      content: Buffer.from(body).toString('base64'),
    });
    const out = await this.json<{ content?: { html_url?: string } }>(res, 'attachment');
    const url = out.content?.html_url;
    if (!url) throw new FeedbackGithubError('http', 'attachment without html_url');
    return `${url}?raw=true`;
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
}
