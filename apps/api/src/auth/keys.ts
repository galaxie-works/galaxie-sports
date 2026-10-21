import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Formato da chave: `gs_<ambiente>_<prefixo>_<segredo>`.
 * - prefixo: 12 caracteres hex, guardado em claro para localizar a chave;
 * - segredo: 32 bytes aleatórios em base64url (43 caracteres), guardado só como hash scrypt.
 */
const KEY_RE = /^gs_(live|test)_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

export type KeyEnv = 'live' | 'test';

export interface ParsedKey {
  env: KeyEnv;
  prefix: string;
  secret: string;
}

export function parseApiKey(key: string): ParsedKey | null {
  const m = KEY_RE.exec(key.trim());
  return m ? { env: m[1] as KeyEnv, prefix: m[2]!, secret: m[3]! } : null;
}

export function generateApiKey(env: KeyEnv = 'live'): ParsedKey & { key: string } {
  const prefix = randomBytes(6).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return { env, prefix, secret, key: `gs_${env}_${prefix}_${secret}` };
}

// Parâmetros scrypt (custo ~16 MiB de memória). O resultado verificado fica em cache em memória
// pelo autenticador, então o custo é pago uma vez por chave e por janela de cache.
const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 32 } as const;

function scryptAsync(secret: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(secret, salt, keylen, opts, (err, derived) => (err ? reject(err) : resolve(derived))),
  );
}

/** Hash do segredo no formato `scrypt$N$r$p$sal$hash` (base64url). */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const derived = await scryptAsync(secret, salt, keylen, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const derived = await scryptAsync(secret, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
