import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type OutgoingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/**
 * Faixas que um webhook nunca alcança (SSRF): loopback, redes privadas, link-local (inclui o metadata
 * 169.254.169.254 das nuvens), CGNAT, multicast, reservadas e equivalentes IPv6. IPv4 mapeado em IPv6
 * (`::ffff:10.0.0.1`) cai nas faixas IPv4.
 */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv6');

/** O endereço (IP literal) está numa faixa privada/reservada? */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  return BLOCKED.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

export class BlockedTargetError extends Error {
  constructor(host: string, address: string) {
    super(`destino ${host} resolve para ${address}, em rede privada ou reservada`);
    this.name = 'BlockedTargetError';
  }
}

/**
 * `lookup` do socket que recusa endereços bloqueados. A checagem é feita no endereço que o socket vai
 * de fato usar (sem janela entre "resolver para validar" e "resolver para conectar": DNS rebinding).
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, '', 0);
    const blocked = addresses.find((a) => isBlockedAddress(a.address));
    if (blocked) return callback(new BlockedTargetError(hostname, blocked.address), '', 0);
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    const first = addresses[0];
    if (!first) return callback(new Error(`sem endereço para ${hostname}`), '', 0);
    callback(null, first.address, first.family);
  });
};

export interface WebhookPost {
  headers: OutgoingHttpHeaders;
  body: string;
  timeoutMs: number;
  /** Permite destinos em rede privada/loopback (desenvolvimento e testes). Padrão false. */
  allowPrivateTargets?: boolean;
}

/**
 * POST de uma entrega: devolve o status HTTP (sem seguir redirects; corpo da resposta descartado).
 * Sem `allowPrivateTargets`, destinos em rede privada/reservada falham com BlockedTargetError — no IP
 * literal da URL e em cada resolução de DNS do socket.
 */
export function postWebhook(url: string, post: WebhookPost): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const host = target.hostname.replace(/^\[|\]$/g, '');
    if (!post.allowPrivateTargets && isBlockedAddress(host))
      return reject(new BlockedTargetError(host, host));
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(
      target,
      {
        method: 'POST',
        headers: { ...post.headers, 'content-length': Buffer.byteLength(post.body) },
        signal: AbortSignal.timeout(post.timeoutMs),
        ...(post.allowPrivateTargets ? {} : { lookup: guardedLookup }),
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end(post.body);
  });
}
