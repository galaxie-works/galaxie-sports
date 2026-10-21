import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import { problems } from '../errors.js';

export const ADMIN_KEY_HEADER = 'x-galaxie-admin-key';
const ADMIN_KEY_RE = /^gs_admin_[A-Za-z0-9_-]{43}$/;

/** Chave administrativa: `gs_admin_<32 bytes base64url>`. Exibida uma vez; só o hash vai para o ambiente. */
export function generateAdminKey(): string {
  return `gs_admin_${randomBytes(32).toString('base64url')}`;
}

/**
 * Hash da chave administrativa: `sha256$<base64url>`. A chave tem 256 bits de entropia, então um
 * hash rápido basta (hash lento protege segredos de baixa entropia) e evita que chaves inválidas
 * em massa custem CPU (scrypt) em rotas internas.
 */
export function hashAdminKey(key: string): string {
  return `sha256$${createHash('sha256').update(key.trim()).digest('base64url')}`;
}

function digestOf(hash: string): Buffer | null {
  const [alg, value] = hash.trim().split('$');
  if (alg !== 'sha256' || !value) return null;
  const buf = Buffer.from(value, 'base64url');
  return buf.length === 32 ? buf : null;
}

/** Converte a allowlist (`IP` ou `IP/prefixo`, IPv4/IPv6) num BlockList; entrada inválida → erro. */
export function parseIpAllowlist(entries: string[]): BlockList {
  const list = new BlockList();
  for (const raw of entries.map((e) => e.trim()).filter(Boolean)) {
    const [addr, bits] = raw.split('/') as [string, string | undefined];
    const family = isIP(addr);
    if (!family) throw new Error(`ADMIN_IP_ALLOWLIST: endereço inválido "${raw}"`);
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (bits === undefined) list.addAddress(addr, type);
    else {
      const prefix = Number(bits);
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128))
        throw new Error(`ADMIN_IP_ALLOWLIST: prefixo inválido "${raw}"`);
      list.addSubnet(addr, prefix, type);
    }
  }
  return list;
}

/** IPv4 mapeado em IPv6 (`::ffff:10.0.0.1`) → IPv4. */
export function normalizeIp(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m ? m[1]! : ip;
}

export interface AdminGuardOptions {
  /** Hashes (`sha256$...`) das chaves administrativas aceitas — várias permitem rotação sem janela. */
  keyHashes: string[];
  /** IPs/CIDRs autorizados; ausente ou vazio = qualquer IP (use só atrás de VPN/rede privada). */
  ipAllowlist?: string[];
}

/**
 * Protege `/internal/*`: allowlist de IP (fora dela a rota "não existe": 404) e chave administrativa
 * no header `x-galaxie-admin-key` (401). O IP é `request.ip` — atrás de proxy, configure
 * `TRUST_PROXY` para que ele reflita o cliente real.
 */
export class AdminGuard {
  private readonly digests: Buffer[];
  private readonly allow: BlockList | undefined;

  constructor(options: AdminGuardOptions) {
    this.digests = options.keyHashes.map((h) => {
      const d = digestOf(h);
      if (!d) throw new Error('ADMIN_KEY_HASHES: use o formato sha256$<base64url> (pnpm admin:key).');
      return d;
    });
    if (!this.digests.length) throw new Error('AdminGuard exige ao menos um hash de chave administrativa.');
    this.allow = options.ipAllowlist?.length ? parseIpAllowlist(options.ipAllowlist) : undefined;
  }

  ipAllowed(ip: string): boolean {
    if (!this.allow) return true;
    const addr = normalizeIp(ip);
    const family = isIP(addr);
    if (!family) return false;
    return this.allow.check(addr, family === 4 ? 'ipv4' : 'ipv6');
  }

  keyValid(raw: string | undefined): boolean {
    if (!raw || !ADMIN_KEY_RE.test(raw.trim())) return false;
    const digest = createHash('sha256').update(raw.trim()).digest();
    // compara com todos (sem curto-circuito) para não vazar qual hash casou
    let ok = false;
    for (const d of this.digests) ok = timingSafeEqual(d, digest) || ok;
    return ok;
  }

  check(request: FastifyRequest): void {
    if (!this.ipAllowed(request.ip)) throw problems.notFound('Rota');
    const header = request.headers[ADMIN_KEY_HEADER];
    if (!this.keyValid(Array.isArray(header) ? header[0] : header))
      throw problems.invalidKey(`Envie uma chave administrativa válida no header ${ADMIN_KEY_HEADER}.`);
  }
}
