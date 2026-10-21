// Cenário: mesmo endpoint servido do cache (HIT) × montado no banco (MISS), em paralelo.
// O MISS usa um parâmetro descartável (`cb`) que muda a chave do cache a cada requisição —
// mede o custo real de Postgres + serialização. Atenção: cada MISS grava uma entrada no Valkey
// (TTL do recurso); rode contra um ambiente descartável.
//
//   PROFILE=load RATE=1000 k6 run tests/load/cache-hit-vs-miss.js
import { assertKey, baseThresholds, get, scenarioFor } from './lib/common.js';

const PATH = __ENV.CACHE_PATH || '/v1/competitions?country=BR&limit=20';
const sep = PATH.includes('?') ? '&' : '?';

export const options = {
  scenarios: {
    hit: scenarioFor('hit', 1000),
    miss: { ...scenarioFor('miss', 200), startTime: '0s' },
  },
  thresholds: {
    ...baseThresholds,
    'http_req_duration{scenario:hit}': ['p(95)<150'],
    'http_req_duration{scenario:miss}': ['p(95)<400'],
    cached_req_duration: ['p(95)<150'],
    uncached_req_duration: ['p(95)<400'],
  },
};

export function setup() {
  assertKey();
  get(PATH, { name: 'warmup' }); // aquece a entrada do cenário HIT
}

export function hit() {
  get(PATH, { name: 'hit' });
}

export function miss() {
  get(`${PATH}${sep}cb=${__VU}-${__ITER}-${Date.now()}`, { name: 'miss' });
}
