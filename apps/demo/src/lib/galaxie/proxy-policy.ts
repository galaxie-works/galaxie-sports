/**
 * O que o proxy `/api/galaxie/*` deixa passar. Ele injeta a chave interna do tenant de demonstração, então
 * qualquer convidado logado falaria com a API como esse tenant: só os recursos de leitura que o app usa
 * no navegador (busca, ao vivo, docs "ver código", Builder etc.) passam, e com teto por sessão, para um
 * script não gastar a cota do tenant. Ficam de fora a conta (`/v1/account*`: plano, chaves, uso) e a
 * lista de canais do tenant (`/v1/channel-list*`).
 *
 * Módulo puro: serve à rota e aos testes.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Primeiro segmento depois de `/v1` liberado. Levantado nas chamadas do app ao proxy (`/api/galaxie/v1/…`
 * em components/ e lib/, widgets do Builder e o "ver código" das páginas) e nas rotas GET de leitura
 * da API. Recurso novo lido pelo navegador entra aqui.
 */
export const PROXY_RESOURCES: ReadonlySet<string> = new Set([
  'broadcasters',
  // chat ao vivo na página do jogo (#977): a sala e o stream dela
  'chat',
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
  // vídeos relacionados: a vitrine lê no servidor; o navegador não alcança a rota pela chave da demo
  if (path[1] === 'events' && path[3] === 'related') return false;
  // chat: só a sala de um jogo e o stream dela (a configuração do tenant não é leitura pública)
  if (path[1] === 'chat') return isChatRoomRead(path);
  return PROXY_RESOURCES.has(path[1]!);
}

const isChatRoomRead = (path: readonly string[]) =>
  path[2] === 'rooms' &&
  UUID.test(path[3] ?? '') &&
  (path.length === 4 || (path.length === 5 && path[4] === 'stream'));

/** O stream da sala do chat: conexão longa, contada à parte (`CHAT_STREAMS_PER_SESSION`). */
export const isChatStream = (path: readonly string[]) =>
  path.length === 5 && path[1] === 'chat' && path[4] === 'stream' && isChatRoomRead(path);

/** Streams do chat abertos ao mesmo tempo por sessão: um script não esgota o pico de conexões do tenant da demo. */
export const CHAT_STREAMS_PER_SESSION = 3;

/**
 * Leitura do torcedor (#977): só `GET /v1/fans/me`, que o widget usa para saber o que a pessoa pode fazer. Vai com o
 * token do torcedor e sem a chave da demo, como a escrita do chat.
 */
export const isProxyFanRead = (path: readonly string[]) =>
  path.length === 3 && path[0] === 'v1' && path[1] === 'fans' && path[2] === 'me';

/** Formato do header do torcedor que o proxy repassa (`Bearer gft_…`). */
export const isFanAuthorization = (value: string) =>
  value.length <= 4096 && /^Bearer gft_[A-Za-z0-9._~+/=-]+$/.test(value);

/** Escritas do torcedor por sessão por minuto (mensagens e reações): balde próprio, sem gastar o da leitura. */
export const PROXY_WRITES_PER_MINUTE = 120;

/** Corpo máximo de uma escrita do chat (bytes). */
export const PROXY_WRITE_MAX_BYTES = 8_192;

/**
 * Escrita que o proxy repassa (#977): só enviar mensagem e reagir no chat de um jogo, com o token do torcedor da
 * pessoa logada. A chave da demo não vai junto: quem autentica é o token (a API não aceita escrita sem ele).
 */
export function isProxyWriteAllowed(path: readonly string[]): boolean {
  return (
    path.length === 5 &&
    path[0] === 'v1' &&
    path[1] === 'chat' &&
    path[2] === 'rooms' &&
    UUID.test(path[3] ?? '') &&
    (path[4] === 'messages' || path[4] === 'reactions')
  );
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
