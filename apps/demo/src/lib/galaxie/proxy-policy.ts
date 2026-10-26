/**
 * O que o proxy `/api/galaxie/*` deixa passar. Ele injeta a chave interna do tenant de demonstração, então
 * qualquer convidado logado falaria com a API como esse tenant: só os recursos de leitura que o app usa
 * no navegador (busca, ao vivo, docs "ver código", Builder etc.) passam, e com teto por sessão, para um
 * script não gastar a cota do tenant. Ficam de fora a conta (`/v1/account*`: plano, chaves, uso) e a
 * lista de canais do tenant (`/v1/channel-list*`).
 *
 * Módulo puro: serve à rota e aos testes.
 */

/**
 * Primeiro segmento depois de `/v1` liberado. Levantado nas chamadas do app ao proxy (`/api/galaxie/v1/…`
 * em components/ e lib/, widgets do Builder e o "ver código" das páginas) e nas rotas GET de leitura
 * da API. Recurso novo lido pelo navegador entra aqui.
 */
export const PROXY_RESOURCES: ReadonlySet<string> = new Set([
  'broadcasters',
  'competitions',
  'copy',
  'countries',
  'derbies',
  'equestrian',
  'events',
  'explore',
  'glossary',
  'multisport',
  'navigation',
  'people',
  'platforms',
  'search',
  'sports',
  'stream',
  'teams',
  'venues',
]);

/** Caminho (segmentos depois de `/api/galaxie`) que o proxy repassa. */
export function isProxyPathAllowed(path: readonly string[]): boolean {
  if (path[0] !== 'v1' || path.length < 2) return false;
  if (path.some((p) => p === '' || p === '.' || p === '..' || p.includes('/') || p.includes('\\')))
    return false;
  return PROXY_RESOURCES.has(path[1]!);
}

/** Leituras por sessão por minuto: folga para a navegação (busca a cada tecla, Builder, ao vivo). */
export const PROXY_REQUESTS_PER_MINUTE = 300;

/**
 * Contador por janela fixa, em memória (a demo roda num processo só; reiniciar zera, o que só devolve a
 * folga de um minuto). Devolve quantos segundos esperar quando passou do teto, ou `0`.
 */
export function createRateLimiter(max: number, windowMs = 60_000) {
  const windows = new Map<string, { start: number; count: number }>();
  return function take(key: string, now = Date.now()): number {
    const current = windows.get(key);
    if (!current || now - current.start >= windowMs) {
      // de vez em quando, joga fora as janelas vencidas
      if (windows.size > 1_000) {
        for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
      }
      windows.set(key, { start: now, count: 1 });
      return 0;
    }
    current.count += 1;
    if (current.count <= max) return 0;
    return Math.max(1, Math.ceil((current.start + windowMs - now) / 1000));
  };
}
