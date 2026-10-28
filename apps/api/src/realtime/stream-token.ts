/**
 * Token curto do SSE (docs/05 §5.1). O `EventSource` do navegador não envia headers, então a chave secreta
 * ia na URL (`?key=`) e ficava em histórico, logs de proxy e referers. Agora o backend do cliente troca a
 * chave (no header) por um token de 5 minutos em `POST /v1/stream/token` e o navegador abre
 * `/v1/stream?token=…`. O token:
 *
 * - vale só para abrir o `/v1/stream` (as outras rotas não o aceitam);
 * - vale só para o tenant e a chave que o pediram (leva o prefixo público e o id da chave, nunca o segredo);
 * - expira em 5 minutos para ABRIR o stream; o stream aberto continua e é revalidado pela chave a cada
 *   heartbeat (chave revogada encerra em até 60 s, como antes);
 * - é assinado com HMAC-SHA256 (`STREAM_TOKEN_SECRET`; sem ele, um segredo aleatório por processo: o token
 *   não vale depois de reiniciar nem em outra instância — o cliente pede outro, como faz ao expirar).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const STREAM_TOKEN_PREFIX = 'gst_';
export const STREAM_TOKEN_TTL_S = 300;

export interface StreamTokenClaims {
  /** Tenant. */
  tenantId: string;
  /** Prefixo público da chave secreta que pediu o token. */
  keyPrefix: string;
  keyId: string;
  /** Expiração (segundos Unix). */
  exp: number;
}

interface Payload {
  v: 1;
  t: string;
  p: string;
  k: string;
  exp: number;
  /** Aleatório: dois tokens do mesmo segundo nunca são iguais. */
  n: string;
}

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

export interface StreamTokenSignerOptions {
  /** Segredo do HMAC (mínimo 32 caracteres); ausente = aleatório por processo. */
  secret?: string | undefined;
  ttlSeconds?: number;
  now?: () => number;
}

export class StreamTokenSigner {
  private readonly secret: Buffer;
  readonly ttlSeconds: number;
  /** O segredo veio da configuração (vale entre instâncias e reinícios)? */
  readonly configured: boolean;
  private readonly now: () => number;

  constructor(options: StreamTokenSignerOptions = {}) {
    const secret = options.secret?.trim();
    if (secret && secret.length < 32)
      throw new Error('STREAM_TOKEN_SECRET precisa de pelo menos 32 caracteres');
    this.configured = !!secret;
    this.secret = secret ? Buffer.from(secret) : randomBytes(32);
    this.ttlSeconds = options.ttlSeconds ?? STREAM_TOKEN_TTL_S;
    this.now = options.now ?? Date.now;
  }

  private mac(body: string): string {
    return b64(createHmac('sha256', this.secret).update(`stream-token:${body}`).digest());
  }

  issue(claims: Omit<StreamTokenClaims, 'exp'>): { token: string; expiresAt: Date } {
    const exp = Math.floor(this.now() / 1000) + this.ttlSeconds;
    const payload: Payload = {
      v: 1,
      t: claims.tenantId,
      p: claims.keyPrefix,
      k: claims.keyId,
      exp,
      n: b64(randomBytes(9)),
    };
    const body = b64(JSON.stringify(payload));
    return { token: `${STREAM_TOKEN_PREFIX}${body}.${this.mac(body)}`, expiresAt: new Date(exp * 1000) };
  }

  /** Claims do token válido e dentro do prazo; null se a assinatura, o formato ou o prazo não conferem. */
  verify(token: string): StreamTokenClaims | null {
    if (!token.startsWith(STREAM_TOKEN_PREFIX) || token.length > 1_000) return null;
    const [body, sig, extra] = token.slice(STREAM_TOKEN_PREFIX.length).split('.');
    if (!body || !sig || extra !== undefined) return null;
    const expected = Buffer.from(this.mac(body));
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    let p: Payload;
    try {
      p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
    } catch {
      return null;
    }
    if (p?.v !== 1 || typeof p.t !== 'string' || typeof p.p !== 'string' || typeof p.k !== 'string')
      return null;
    if (typeof p.exp !== 'number' || p.exp * 1000 <= this.now()) return null;
    return { tenantId: p.t, keyPrefix: p.p, keyId: p.k, exp: p.exp };
  }
}
