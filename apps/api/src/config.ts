import type { ServerOptions } from './server.js';

const csv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const positiveInt = (name: string, value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`${name} deve ser um inteiro ≥ 0 (recebido "${value}").`);
  return n;
};

/**
 * Opções de hardening lidas do ambiente (docs/11 §4, SECURITY.md):
 * - `CORS_ORIGINS` — origens separadas por vírgula (`*` = qualquer); vazio = sem CORS;
 * - `ADMIN_KEY_HASHES` — hashes `sha256$...` das chaves administrativas (vazio = /internal desligado);
 * - `ADMIN_IP_ALLOWLIST` — IPs/CIDRs autorizados em /internal;
 * - `TRUST_PROXY` — `true`, `false` ou lista de IPs/CIDRs dos proxies confiáveis;
 * - `API_BODY_LIMIT` (bytes), `HSTS_MAX_AGE` (s), `USAGE_FLUSH_MS`, `USAGE_PERSIST_MS`;
 * - `PUBLISHABLE_RATE_LIMIT_PER_MINUTE` — limite da chave publicável por chave × IP (padrão 60);
 * - `AUTH_ATTEMPTS_PER_MINUTE` — tentativas de autenticação fora do cache por IP e por prefixo (padrão 60).
 */
export function hardeningFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<ServerOptions> {
  const out: Partial<ServerOptions> = {};
  const origins = csv(env.CORS_ORIGINS);
  if (origins.length) out.cors = { origins };

  const keyHashes = csv(env.ADMIN_KEY_HASHES);
  if (keyHashes.length) out.admin = { keyHashes, ipAllowlist: csv(env.ADMIN_IP_ALLOWLIST) };

  const tp = env.TRUST_PROXY?.trim();
  if (tp === 'true') out.trustProxy = true;
  else if (tp && tp !== 'false') out.trustProxy = csv(tp);

  const bodyLimit = positiveInt('API_BODY_LIMIT', env.API_BODY_LIMIT);
  if (bodyLimit) out.bodyLimit = bodyLimit;
  const hsts = positiveInt('HSTS_MAX_AGE', env.HSTS_MAX_AGE);
  if (hsts) out.security = { hstsMaxAgeSec: hsts };
  const flush = positiveInt('USAGE_FLUSH_MS', env.USAGE_FLUSH_MS);
  if (flush) out.usageFlushIntervalMs = flush;
  const persist = positiveInt('USAGE_PERSIST_MS', env.USAGE_PERSIST_MS);
  if (persist) out.usagePersistIntervalMs = persist;
  const pkLimit = positiveInt('PUBLISHABLE_RATE_LIMIT_PER_MINUTE', env.PUBLISHABLE_RATE_LIMIT_PER_MINUTE);
  if (pkLimit) out.publishableRateLimitPerMinute = pkLimit;
  const authAttempts = positiveInt('AUTH_ATTEMPTS_PER_MINUTE', env.AUTH_ATTEMPTS_PER_MINUTE);
  if (authAttempts) out.authThrottle = { attemptsPerMinute: authAttempts };
  return out;
}
