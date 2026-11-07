/**
 * Entrega do "Sugerir ou reportar algo" ao GitHub (só no servidor), pelo mesmo caminho do alerta do Grafana: a
 * demo dispara o workflow `.github/workflows/sugestao-issue.yml` pela API de workflow_dispatch, e é o workflow
 * (com o token do próprio Actions) que cria o rótulo do assunto, se faltar, e abre a issue
 * (infra/ops/sugestao-issue.sh). O token daqui é o mesmo ALERT_GITHUB_TOKEN da VPS (fine-grained PAT só deste
 * repositório, com Actions: read and write e nada mais); ele nunca vai ao navegador.
 *
 *   FEEDBACK_GITHUB_TOKEN  token (vazio = envio desligado; o formulário mostra "indisponível")
 *   FEEDBACK_GITHUB_REPO   dono/repositório (padrão galaxie-works/galaxie-sports)
 *   FEEDBACK_GITHUB_REF    branch do workflow (padrão main)
 */
import type { FeedbackSubject } from './rules';

export const FEEDBACK_WORKFLOW = 'sugestao-issue.yml';

/** O que vai para o workflow (input `payload`, um JSON). Só dados já mascarados: nada de e-mail ou tenant inteiro. */
export interface FeedbackPayload {
  v: 1;
  subject: FeedbackSubject;
  /** Primeiros 50 caracteres da mensagem, numa linha (o título é "<assunto>: <isto>"). */
  snippet: string;
  message: string;
  email: string;
  tenant: string | null;
  role: string;
  /** Caminho da página onde o formulário foi aberto (sem domínio). */
  page: string | null;
  locale: string;
  user_agent: string | null;
  viewport: string | null;
  /** Versão da imagem que atendeu (GALAXIE_IMAGE_HASH). */
  version: string;
  sent_at: string;
  attachments: { url: string; name: string; type: string; bytes: number }[];
}

export interface FeedbackGithubConfig {
  token: string;
  repo: string;
  ref: string;
}

export function feedbackGithubConfig(
  env: Record<string, string | undefined> = process.env,
): FeedbackGithubConfig | null {
  const token = env.FEEDBACK_GITHUB_TOKEN?.trim();
  if (!token) return null;
  const repo = env.FEEDBACK_GITHUB_REPO?.trim() || 'galaxie-works/galaxie-sports';
  if (!/^[A-Za-z0-9-]+\/(?!\.)[\w.-]+$/.test(repo)) return null;
  return { token, repo, ref: env.FEEDBACK_GITHUB_REF?.trim() || 'main' };
}

/** Dispara o workflow; `true` quando o GitHub aceitou (204). */
export async function dispatchFeedback(
  config: FeedbackGithubConfig,
  payload: FeedbackPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const res = await fetchImpl(
    `https://api.github.com/repos/${config.repo}/actions/workflows/${FEEDBACK_WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'galaxie-demo',
      },
      body: JSON.stringify({ ref: config.ref, inputs: { payload: JSON.stringify(payload) } }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    },
  );
  if (res.status !== 204) {
    console.error(
      '[feedback] workflow_dispatch recusado',
      res.status,
      (await res.text().catch(() => '')).slice(0, 300),
    );
    return false;
  }
  return true;
}
