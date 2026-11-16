import { describe, expect, it } from 'vitest';
import { EDGE_MAX_TTL_SEC, edgeTtl, guardEdgeTtl, isEdgeEligible, type EdgeResponse } from './edge.js';
import { cacheControl } from './policy.js';

const ok: EdgeResponse = {
  method: 'GET',
  url: '/v1/competitions/1?locale=es-AR',
  status: 200,
  cacheControl: cacheControl(3600),
};

describe('isEdgeEligible', () => {
  it('GET 200 público de /v1 vai à borda', () => {
    expect(isEdgeEligible(ok)).toBe(true);
  });

  it.each([
    ['POST', { method: 'POST' }],
    ['HEAD', { method: 'HEAD' }],
    ['304', { status: 304 }],
    ['401', { status: 401 }],
    ['403', { status: 403 }],
    ['404', { status: 404 }],
    ['429', { status: 429 }],
    ['500', { status: 500 }],
    ['503', { status: 503 }],
    ['no-store', { cacheControl: 'no-store' }],
    ['no-cache', { cacheControl: 'no-cache' }],
    ['private', { cacheControl: 'private, max-age=60' }],
    ['público com no-store', { cacheControl: 'public, no-store' }],
    ['sem Cache-Control', { cacheControl: undefined }],
    ['token do torcedor', { hasAuthorization: true }],
    ['rota do torcedor', { route: { fan: true } }],
    ['rota administrativa', { route: { admin: true } }],
    ['SSE com chave na query', { route: { allowQueryKey: true } }],
    ['presença ao vivo', { url: '/v1/events/1/presence' }],
    ['/internal', { url: '/internal/where-to-watch/review' }],
    ['admin', { url: '/internal/admin/tenants' }],
    ['espelho', { url: '/mirror/football-v3/fixtures?id=1' }],
    ['SSE de dados', { url: '/v1/stream?token=x' }],
    ['SSE do chat', { url: '/v1/chat/rooms/123/stream' }],
    ['ao vivo', { url: '/v1/events/live' }],
    ['onde assistir', { url: '/v1/events/9/where-to-watch' }],
    ['guia de canais', { url: '/v1/widgets/abc/channel-guide' }],
    ['lista de canais', { url: '/v1/channel-list' }],
    ['grade das plataformas', { url: '/v1/platforms/3/lineup' }],
    ['agenda do dia do multiesporte', { url: '/v1/multisport/games/paris-2024/today/BRA' }],
    ['conta', { url: '/v1/account/usage' }],
    ['torcedor', { url: '/v1/fans/me' }],
    ['loja', { url: '/v1/shop/offers' }],
  ] as Array<[string, Partial<EdgeResponse>]>)('%s nunca vai à borda', (_name, change) => {
    expect(isEdgeEligible({ ...ok, ...change })).toBe(false);
  });
});

describe('edgeTtl', () => {
  it('limita ao teto de 15 min mesmo com s-maxage de 24 h', () => {
    expect(edgeTtl({ ...ok, resourceTtl: 24 * 3600, remainingTtl: 24 * 3600 })).toBe(EDGE_MAX_TTL_SEC);
  });

  it('nunca passa do que resta do TTL da entrada', () => {
    expect(edgeTtl({ ...ok, resourceTtl: 3600, remainingTtl: 120 })).toBe(120);
  });

  it('recurso com TTL < 1 h (agenda, ao vivo, onde assistir) não vai à borda', () => {
    expect(edgeTtl({ ...ok, resourceTtl: 300, remainingTtl: 300 })).toBeUndefined();
    expect(edgeTtl({ ...ok, resourceTtl: 10, remainingTtl: 10 })).toBeUndefined();
    expect(edgeTtl({ ...ok, resourceTtl: 60, remainingTtl: 60 })).toBeUndefined();
  });

  it('entrada antiga sem TTL, vencida ou recusada pelo purge não vai à borda', () => {
    expect(edgeTtl({ ...ok, resourceTtl: undefined, remainingTtl: 10 })).toBeUndefined();
    expect(
      edgeTtl({ ...ok, resourceTtl: 3600, remainingTtl: 0, cacheControl: cacheControl(0) }),
    ).toBeUndefined();
  });

  it('erro não vai à borda, com qualquer TTL', () => {
    expect(edgeTtl({ ...ok, status: 403, resourceTtl: 86400, remainingTtl: 86400 })).toBeUndefined();
  });
});

describe('guardEdgeTtl', () => {
  it('mantém a marca válida e aplica o teto', () => {
    expect(guardEdgeTtl({ ...ok, value: '600' })).toBe(600);
    expect(guardEdgeTtl({ ...ok, value: '86400' })).toBe(EDGE_MAX_TTL_SEC);
  });

  it('tira a marca fora da regra ou com valor inválido', () => {
    expect(guardEdgeTtl({ ...ok, status: 429, value: '600' })).toBeUndefined();
    expect(guardEdgeTtl({ ...ok, cacheControl: 'no-store', value: '600' })).toBeUndefined();
    expect(guardEdgeTtl({ ...ok, value: 'abc' })).toBeUndefined();
    expect(guardEdgeTtl({ ...ok, value: '0' })).toBeUndefined();
    expect(guardEdgeTtl({ ...ok, value: '1.5' })).toBeUndefined();
    expect(guardEdgeTtl({ ...ok, value: undefined })).toBeUndefined();
  });
});
