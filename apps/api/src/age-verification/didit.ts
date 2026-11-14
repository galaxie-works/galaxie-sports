/**
 * Didit, primeiro provedor da verificação de idade da Galaxie (#1109). Cliente HTTP da API de sessões e conferência
 * da assinatura do webhook. A leitura da decisão (o que vira faixa e comprovação) é pura e fica em `@galaxie/engage`
 * (`diditOutcome`).
 *
 * - Sessão: `POST /v3/session/` com o workflow adaptativo (estimativa pelo rosto; documento na zona de dúvida). O
 *   `vendor_data` é uma referência opaca nossa, nunca o id do torcedor nem dado pessoal.
 * - Decisão: `GET /v3/session/{id}/decision/`. O corpo do webhook nunca é usado como decisão: só avisa que mudou.
 * - Apagamento: `DELETE /v3/session/{id}/delete/` assim que a decisão é gravada (o Didit apaga imagens, documento e
 *   embedding facial). 404 = já apagada.
 *
 * Documentação: https://docs.didit.me/sessions-api/create-session.md, …/retrieve-session.md, …/delete-session,
 * https://docs.didit.me/integration/webhooks.md
 */
import { canonicalJson, type DiditDecision } from '@galaxie/engage';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DIDIT_BASE_URL = 'https://verification.didit.me';
/** Janela do `X-Timestamp` do webhook (a documentação pede 300 s). */
export const DIDIT_WEBHOOK_WINDOW_SEC = 300;

export type DiditFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface DiditConfig {
  apiKey: string;
  /** Workflow "Adaptive Age Verification" configurado no console, com idade mínima 18. */
  workflowId: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface DiditSessionInput {
  /** Referência opaca da sessão do nosso lado (volta no webhook como `vendor_data`). */
  ref: string;
  /** Idioma da tela do provedor (ISO 639-1). */
  language: string;
  /** Para onde o torcedor volta ao terminar. */
  returnUrl: string;
  /** Consentimento biométrico que o widget já colheu (a tela do provedor não pergunta de novo). */
  consent: { givenAt: Date; textVersion: string };
  /** Validade da sessão no provedor (3.600 a 2.419.200 s). */
  expiresInSec?: number;
}

export interface DiditSession {
  sessionId: string;
  url: string;
  expiresAt: Date;
}

export class DiditError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'DiditError';
  }
}

const SESSION_ID = /^[A-Za-z0-9-]{1,128}$/;

export class DiditClient {
  private readonly base: string;

  constructor(
    private readonly config: DiditConfig,
    private readonly fetchFn: DiditFetch = fetch,
  ) {
    this.base = (config.baseUrl ?? DIDIT_BASE_URL).replace(/\/+$/, '');
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    try {
      return await this.fetchFn(`${this.base}${path}`, {
        method,
        headers: {
          'x-api-key': this.config.apiKey,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      });
    } catch (err) {
      throw new DiditError(`didit: ${method} ${path}: ${(err as Error).message}`, null);
    }
  }

  async createSession(input: DiditSessionInput, now: Date = new Date()): Promise<DiditSession> {
    const expiresIn = Math.min(Math.max(input.expiresInSec ?? 3_600, 3_600), 2_419_200);
    const res = await this.call('POST', '/v3/session/', {
      workflow_id: this.config.workflowId,
      vendor_data: input.ref,
      callback: input.returnUrl,
      callback_method: 'both',
      language: input.language,
      session_expiration_time: expiresIn,
      biometric_consent: {
        given_at: input.consent.givenAt.toISOString(),
        text_version: input.consent.textVersion,
      },
    });
    if (!res.ok) throw new DiditError(`didit: criar sessão: HTTP ${res.status}`, res.status);
    const body = (await res.json()) as { session_id?: unknown; url?: unknown; expires_at?: unknown };
    if (typeof body.session_id !== 'string' || !SESSION_ID.test(body.session_id))
      throw new DiditError('didit: criar sessão: resposta sem session_id', res.status);
    if (typeof body.url !== 'string' || !body.url.startsWith('https://'))
      throw new DiditError('didit: criar sessão: resposta sem url https', res.status);
    const expiresAt =
      typeof body.expires_at === 'string' && !Number.isNaN(Date.parse(body.expires_at))
        ? new Date(body.expires_at)
        : new Date(now.getTime() + expiresIn * 1000);
    return { sessionId: body.session_id, url: body.url, expiresAt };
  }

  async decision(sessionId: string): Promise<DiditDecision> {
    if (!SESSION_ID.test(sessionId)) throw new DiditError('didit: id de sessão inválido', null);
    const res = await this.call('GET', `/v3/session/${sessionId}/decision/`);
    if (!res.ok) throw new DiditError(`didit: decisão: HTTP ${res.status}`, res.status);
    return (await res.json()) as DiditDecision;
  }

  /** Apaga a sessão no provedor. `true` = apagada agora ou já não existia. */
  async purge(sessionId: string): Promise<boolean> {
    if (!SESSION_ID.test(sessionId)) throw new DiditError('didit: id de sessão inválido', null);
    const res = await this.call('DELETE', `/v3/session/${sessionId}/delete/`);
    if (res.ok || res.status === 404) return true;
    // 503 (armazenamento fora) e 429: tenta de novo depois; 409 (relatório regulatório) não se resolve sozinho
    if (res.status === 503 || res.status === 429) return false;
    throw new DiditError(`didit: apagar sessão: HTTP ${res.status}`, res.status);
  }
}

/** O pedaço do webhook do Didit que a Galaxie usa para achar a sessão; a decisão vem da API. */
export interface DiditWebhookEvent {
  eventId: string;
  sessionId: string;
  vendorData: string | null;
  status: string;
  webhookType: string;
}

const hmacHex = (secret: string, data: string | Buffer) =>
  createHmac('sha256', secret).update(data).digest('hex');

function matches(received: string | undefined, expected: string): boolean {
  if (!received || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

/**
 * Confere o webhook: `X-Timestamp` dentro da janela e `X-Signature-V2` (HMAC-SHA256 do JSON canônico) ou
 * `X-Signature` (HMAC dos bytes crus). Aceita o segredo atual e os anteriores (troca sem janela). A assinatura
 * "Simple" (só o envelope) não é aceita. Devolve o evento ou null.
 */
export function verifyDiditWebhook(
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
  secrets: readonly string[],
  now: Date = new Date(),
): DiditWebhookEvent | null {
  const header = (name: string) => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  const ts = header('x-timestamp');
  if (!ts || !/^\d{1,12}$/.test(ts)) return null;
  if (Math.abs(Math.floor(now.getTime() / 1000) - Number(ts)) > DIDIT_WEBHOOK_WINDOW_SEC) return null;
  const keys = secrets.filter(Boolean);
  if (!keys.length) return null;

  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const canonical = canonicalJson(body);
  const v2 = [header('x-signature-v2'), header('x-signature-v2-previous')];
  const raw = [header('x-signature'), header('x-signature-previous')];
  const ok = keys.some((k) => {
    const c = hmacHex(k, canonical);
    const r = hmacHex(k, rawBody);
    return v2.some((s) => matches(s, c)) || raw.some((s) => matches(s, r));
  });
  if (!ok) return null;

  const b = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= 256 ? v : null);
  const eventId = str(b.event_id);
  const sessionId = str(b.session_id);
  const status = str(b.status);
  const webhookType = str(b.webhook_type);
  if (!eventId || !sessionId || !SESSION_ID.test(sessionId) || !status || !webhookType) return null;
  return { eventId, sessionId, vendorData: str(b.vendor_data), status, webhookType };
}
