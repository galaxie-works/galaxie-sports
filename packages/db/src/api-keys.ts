/**
 * Chave secreta da API (`api.api_key`): formato, geração, hash e emissão. Mora aqui porque a API (autenticação,
 * rotas internas de admin, CLI) e o console (cadastro em autoatendimento e a criação assistida de clientes, F2) emitem
 * a chave pelo mesmo caminho; nenhum dos dois importa o outro.
 *
 * Formato da chave (2, atual): `gs_<ambiente>_<prefixo>_<segredo>_<checksum>`.
 * - ambiente: `live` (produção) ou `test` (testes; limite próprio e uso contado à parte) — precisa bater
 *   com o ambiente gravado da chave;
 * - prefixo: 12 caracteres hex, guardado em claro para localizar a chave;
 * - segredo: 32 bytes aleatórios em base64url (43 caracteres), guardado só como hash scrypt;
 * - checksum: CRC32 em 8 hex de tudo o que vem antes, como nos tokens do GitHub. Erro de digitação ou
 *   chave inventada é recusado sem consulta ao banco, e um scanner de segredos (gitleaks, secret
 *   scanning do GitHub) acha a chave sem falso positivo (docs/politica-de-chaves.md §5).
 *
 * Formato 1 (legado, sem checksum) ainda é lido para as chaves emitidas antes, até a migração
 * (`keys:migrate`) revogá-las e reemiti-las.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { crc32 } from 'node:zlib';
import type { Database } from './client.js';
import { apiKey, type ApiModule } from './schema/index.js';

const KEY_RE = /^gs_(live|test)_([0-9a-f]{12})_([A-Za-z0-9_-]{43})(?:_([0-9a-f]{8}))?$/;

/** Regex sem âncoras para scanners de segredos (`.gitleaks.toml`, padrão customizado do GitHub). */
export const API_KEY_SCAN_PATTERN = 'gs_(live|test)_[0-9a-f]{12}_[A-Za-z0-9_-]{43}_[0-9a-f]{8}';

export type KeyEnv = 'live' | 'test';

export interface ParsedKey {
  env: KeyEnv;
  prefix: string;
  secret: string;
  /** 2 = com checksum (válido); 1 = legado, sem checksum. */
  format: 1 | 2;
}

const checksum = (body: string) => crc32(body).toString(16).padStart(8, '0');

/** null = formato inválido ou checksum que não confere. */
export function parseApiKey(key: string): ParsedKey | null {
  const m = KEY_RE.exec(key.trim());
  if (!m) return null;
  const [, env, prefix, secret, sum] = m;
  if (sum !== undefined && sum !== checksum(`gs_${env}_${prefix}_${secret}`)) return null;
  return { env: env as KeyEnv, prefix: prefix!, secret: secret!, format: sum === undefined ? 1 : 2 };
}

/** Monta a chave no formato 2 (com checksum). */
export function formatApiKey(env: KeyEnv, prefix: string, secret: string): string {
  const body = `gs_${env}_${prefix}_${secret}`;
  return `${body}_${checksum(body)}`;
}

export function generateApiKey(env: KeyEnv = 'live'): ParsedKey & { key: string } {
  const prefix = randomBytes(6).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return { env, prefix, secret, format: 2, key: formatApiKey(env, prefix, secret) };
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

/** Banco ou transação (a emissão pode rodar dentro de `db.transaction`). */
export type ApiKeyDbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export interface CreatedKey {
  id: string;
  prefix: string;
  /** Chave completa — exibida uma única vez. */
  key: string;
}

/** Grava uma chave secreta nova do tenant (só o hash) e devolve o texto puro, que não é guardado. */
export async function createApiKey(
  db: ApiKeyDbOrTx,
  tenantId: string,
  options: {
    label?: string | undefined;
    scopes?: ApiModule[] | undefined;
    env?: KeyEnv | undefined;
    expiresAt?: Date | undefined;
  } = {},
): Promise<CreatedKey> {
  const generated = generateApiKey(options.env ?? 'live');
  const [row] = await db
    .insert(apiKey)
    .values({
      tenantId,
      prefix: generated.prefix,
      env: generated.env,
      keyFormat: generated.format,
      secretHash: await hashSecret(generated.secret),
      label: options.label ?? null,
      scopes: options.scopes ?? null,
      expiresAt: options.expiresAt ?? null,
    })
    .returning({ id: apiKey.id });
  return { id: row!.id, prefix: generated.prefix, key: generated.key };
}
