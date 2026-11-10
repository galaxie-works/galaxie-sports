/**
 * Token do torcedor (`gft_`, #937; arquitetura 01 "APIs e eventos"). O servidor do cliente pede o token com a
 * chave secreta e o entrega ao widget ou app; o torcedor usa o token em `Authorization: Bearer gft_…`.
 *
 * Mesmo desenho do `StreamTokenSigner` (HMAC-SHA256, corpo em base64url), com três diferenças:
 *
 * - o segredo é obrigatório: um segredo aleatório por processo não vale com várias instâncias. Sem
 *   `FAN_TOKEN_SECRET` as rotas do torcedor respondem 503;
 * - leva `kid` (hash curto do segredo): com `FAN_TOKEN_SECRET_PREVIOUS`, quem já está logado continua até o
 *   token vencer depois da troca do segredo;
 * - verificar não consulta o banco (essencial no pico). Punição e exclusão ficam no Valkey, fora do token.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { FAN_AGE_BANDS, FAN_HOLDER_ADULT, type FanAgeBand, type FanHolderAdult } from '@galaxie/db';

export const FAN_TOKEN_PREFIX = 'gft_';
/** Validade padrão (15 min); o painel muda em FAN_TOKEN_TTL_SECONDS. */
export const FAN_TOKEN_TTL_S = 900;

export const FAN_SURFACES = ['web', 'store_app'] as const;
export type FanSurface = (typeof FAN_SURFACES)[number];

export interface FanTokenClaims {
  tenantId: string;
  /** Ids internos (fan.account.id, fan.profile.id), nunca os do cliente. */
  accountId: string;
  profileId: string;
  ageBand: FanAgeBand;
  /** ISO 3166-1 alfa-2. */
  country: string;
  locale: string;
  holderAdult: FanHolderAdult;
  surface: FanSurface;
  /** Expiração (segundos Unix). */
  exp: number;
}

interface Payload {
  v: 1;
  kid: string;
  t: string;
  a: string;
  p: string;
  b: FanAgeBand;
  c: string;
  l: string;
  h: FanHolderAdult;
  s: FanSurface;
  exp: number;
  /** Aleatório: dois tokens do mesmo segundo nunca são iguais. */
  n: string;
}

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');
const MIN_SECRET = 32;

function key(secret: string, name: string): { kid: string; secret: Buffer } {
  if (secret.length < MIN_SECRET) throw new Error(`${name} precisa de pelo menos ${MIN_SECRET} caracteres`);
  return {
    kid: createHash('sha256').update(secret).digest('base64url').slice(0, 8),
    secret: Buffer.from(secret),
  };
}

export interface FanTokenSignerOptions {
  /** FAN_TOKEN_SECRET (mínimo 32 caracteres): assina e verifica. */
  secret: string;
  /** FAN_TOKEN_SECRET_PREVIOUS: só verifica, durante a troca do segredo. */
  previousSecret?: string | undefined;
  now?: () => number;
}

export class FanTokenSigner {
  private readonly current: { kid: string; secret: Buffer };
  private readonly keys: Map<string, Buffer>;
  private readonly now: () => number;

  constructor(options: FanTokenSignerOptions) {
    this.current = key(options.secret.trim(), 'FAN_TOKEN_SECRET');
    this.keys = new Map([[this.current.kid, this.current.secret]]);
    const previous = options.previousSecret?.trim();
    if (previous) {
      const old = key(previous, 'FAN_TOKEN_SECRET_PREVIOUS');
      if (!this.keys.has(old.kid)) this.keys.set(old.kid, old.secret);
    }
    this.now = options.now ?? Date.now;
  }

  /** Signer a partir do env; null sem FAN_TOKEN_SECRET (as rotas do torcedor respondem 503). */
  static fromEnv(env: Record<string, string | undefined>, now?: () => number): FanTokenSigner | null {
    const secret = env.FAN_TOKEN_SECRET?.trim();
    if (!secret) return null;
    try {
      return new FanTokenSigner({
        secret,
        previousSecret: env.FAN_TOKEN_SECRET_PREVIOUS?.trim() || undefined,
        ...(now ? { now } : {}),
      });
    } catch (err) {
      // segredo curto não derruba a API inteira: só as rotas do torcedor ficam em 503, como sem segredo
      console.error(`FAN_TOKEN_SECRET ignorado: ${(err as Error).message}`);
      return null;
    }
  }

  private static mac(secret: Buffer, body: string): string {
    return b64(createHmac('sha256', secret).update(`fan-token:${body}`).digest());
  }

  issue(
    claims: Omit<FanTokenClaims, 'exp'>,
    ttlSeconds = FAN_TOKEN_TTL_S,
  ): { token: string; expiresAt: Date } {
    const exp = Math.floor(this.now() / 1000) + ttlSeconds;
    const payload: Payload = {
      v: 1,
      kid: this.current.kid,
      t: claims.tenantId,
      a: claims.accountId,
      p: claims.profileId,
      b: claims.ageBand,
      c: claims.country,
      l: claims.locale,
      h: claims.holderAdult,
      s: claims.surface,
      exp,
      n: b64(randomBytes(9)),
    };
    const body = b64(JSON.stringify(payload));
    return {
      token: `${FAN_TOKEN_PREFIX}${body}.${FanTokenSigner.mac(this.current.secret, body)}`,
      expiresAt: new Date(exp * 1000),
    };
  }

  /** Claims do token válido e dentro do prazo; null se a assinatura, o formato ou o prazo não conferem. */
  verify(token: string): FanTokenClaims | null {
    if (!token.startsWith(FAN_TOKEN_PREFIX) || token.length > 2_000) return null;
    const [body, sig, extra] = token.slice(FAN_TOKEN_PREFIX.length).split('.');
    if (!body || !sig || extra !== undefined) return null;
    let p: Payload;
    try {
      p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
    } catch {
      return null;
    }
    const secret = typeof p?.kid === 'string' ? this.keys.get(p.kid) : undefined;
    if (!secret) return null;
    const expected = Buffer.from(FanTokenSigner.mac(secret, body));
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    if (
      p.v !== 1 ||
      ![p.t, p.a, p.p, p.c, p.l].every((s) => typeof s === 'string' && s.length > 0) ||
      !(FAN_AGE_BANDS as readonly string[]).includes(p.b) ||
      !(FAN_HOLDER_ADULT as readonly string[]).includes(p.h) ||
      !(FAN_SURFACES as readonly string[]).includes(p.s)
    )
      return null;
    if (typeof p.exp !== 'number' || p.exp * 1000 <= this.now()) return null;
    return {
      tenantId: p.t,
      accountId: p.a,
      profileId: p.p,
      ageBand: p.b,
      country: p.c,
      locale: p.l,
      holderAdult: p.h,
      surface: p.s,
      exp: p.exp,
    };
  }
}
