/**
 * Cache de borda da API (#1257): o Worker da Cloudflare (`infra/cloudflare/api-edge-cache`) só guarda a resposta
 * que a origem marcou com `x-galaxie-edge-ttl`, e por no máximo esse tempo. A regra de quem recebe a marca mora
 * aqui, numa função pura; o `sendCached` a aplica e um hook do servidor a confere de novo em toda resposta (nenhuma
 * resposta fora da regra sai com a marca, mesmo que uma rota a ponha por engano).
 *
 * Por que um header próprio: a Cloudflare não repassa o `Cloudflare-CDN-Cache-Control` adiante (nem ao Worker,
 * pela documentação) e a Cache API dos Workers só lê `Cache-Control`. O Worker lê esta marca, grava a cópia com o
 * `Cache-Control` da borda e tira a marca antes de responder ao cliente.
 */
export const EDGE_TTL_HEADER = 'x-galaxie-edge-ttl';

/** TTL mínimo do recurso para ir à borda: catálogo, jogos encerrados, tabelas, histórico (≥ 1 h). */
export const EDGE_MIN_RESOURCE_TTL_SEC = 3600;

/**
 * Teto da cópia na borda. Toda cópia guardada é de uma chave (sem chave o Worker não guarda): uma chave revogada,
 * ou um plano que perdeu um módulo, para de receber cópias em no máximo 15 min, mesmo com `s-maxage` de 24 h.
 */
export const EDGE_MAX_TTL_SEC = 15 * 60;

/**
 * Caminhos que nunca vão à borda, mesmo com TTL longo: ao vivo e SSE, agenda do dia, onde assistir e a grade de
 * canais que o alimenta, e o que é da conta, do torcedor ou de escrita.
 */
const EDGE_EXCLUDED_PATHS: readonly RegExp[] = [
  /(^|\/)stream(\/|$)/,
  /^\/v1\/events\/live(\/|$)/,
  /\/today(\/|$)/,
  /\/presence(\/|$)/,
  /\/where-to-watch(\/|$)/,
  /\/channel-(guide|list)(\/|$)/,
  /^\/v1\/platforms(\/|$)/,
  /^\/v1\/(account|fans|chat|moderation|shop)(\/|$)/,
];

export interface EdgeResponse {
  method: string;
  /** Caminho e query da requisição (`request.url`). */
  url: string;
  status: number;
  /** `Cache-Control` que a resposta leva. */
  cacheControl?: string | number | string[] | undefined;
  /** A requisição veio com `Authorization` (token do torcedor): resposta por pessoa, nunca na borda. */
  hasAuthorization?: boolean;
  /** Configuração da rota: torcedor (`fan`), administrativa (`admin`) ou SSE com chave na query (`allowQueryKey`). */
  route?: { fan?: boolean | undefined; admin?: boolean | undefined; allowQueryKey?: boolean | undefined };
}

/**
 * A resposta pode ser guardada na borda? Só GET 200 de `/v1/*`, com `Cache-Control: public` sem `no-store`,
 * `no-cache` nem `private`, sem `Authorization` e fora dos caminhos excluídos. Erros (401, 403, 429, 5xx), 304,
 * `/internal`, admin, espelho e SSE nunca passam.
 */
export function isEdgeEligible(res: EdgeResponse): boolean {
  if (res.method.toUpperCase() !== 'GET' || res.status !== 200 || res.hasAuthorization) return false;
  if (res.route?.fan || res.route?.admin || res.route?.allowQueryKey) return false;
  const path = res.url.split('?')[0] ?? '';
  if (!path.startsWith('/v1/') || EDGE_EXCLUDED_PATHS.some((re) => re.test(path))) return false;
  const cc = [res.cacheControl ?? ''].flat().join(',').toLowerCase();
  const directives = cc.split(',').map((d) => d.trim().split('=')[0]);
  return (
    directives.includes('public') &&
    !directives.includes('no-store') &&
    !directives.includes('no-cache') &&
    !directives.includes('private')
  );
}

/**
 * TTL da cópia na borda (s), ou `undefined` quando a resposta não vai à borda. `resourceTtl` é o TTL com que a
 * entrada foi gravada (o do load: um jogo ao vivo grava 10 s numa rota de 1 h); `remainingTtl`, o que resta dele
 * (o do `Cache-Control`). O que sai nunca passa do que resta nem de `EDGE_MAX_TTL_SEC`.
 */
export function edgeTtl(
  res: EdgeResponse & { resourceTtl: number | undefined; remainingTtl: number },
): number | undefined {
  if (res.resourceTtl == null || res.resourceTtl < EDGE_MIN_RESOURCE_TTL_SEC) return undefined;
  if (!isEdgeEligible(res)) return undefined;
  const ttl = Math.floor(Math.min(res.remainingTtl, EDGE_MAX_TTL_SEC));
  return ttl >= 1 ? ttl : undefined;
}

/**
 * Guarda de toda resposta (hook `onSend` do servidor): o valor da marca que pode sair, ou `undefined` para tirá-la.
 * Fora da regra, sem número válido ou acima do teto, a marca sai da resposta (o teto é aplicado, não confiado).
 */
export function guardEdgeTtl(
  res: EdgeResponse & { value: string | number | string[] | undefined },
): number | undefined {
  if (res.value === undefined || !isEdgeEligible(res)) return undefined;
  const raw = Array.isArray(res.value) ? res.value[0] : res.value;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return Math.min(n, EDGE_MAX_TTL_SEC);
}
