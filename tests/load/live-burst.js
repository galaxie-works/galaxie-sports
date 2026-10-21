// Cenário: rajada em /v1/events/live (pico de audiência em clássicos, finais e Pan).
// Meta documentada (issue #85): 10.000 req/s com p95 ≤ 150 ms servido do cache (TTL ao vivo = 10 s).
//
//   PROFILE=peak RATE=10000 k6 run tests/load/live-burst.js
//
// Enquanto /v1/events/live não existir (issue #31), o setup aborta com uma mensagem clara.
// Para exercitar o script mesmo assim, aponte LIVE_PATH para outra rota cacheada
// (ex.: LIVE_PATH=/v1/competitions?country=BR) — e registre isso no relatório.
import http from 'k6/http';
import { fail } from 'k6';
import { assertKey, BASE_URL, baseThresholds, get, headers, scenarioFor } from './lib/common.js';

const LIVE_PATH = __ENV.LIVE_PATH || '/v1/events/live';
const SPORTS = (__ENV.SPORTS || 'football').split(',');

export const options = {
  scenarios: { live: scenarioFor('live', 10000) },
  thresholds: {
    ...baseThresholds,
    'http_req_duration{name:live}': ['p(95)<150', 'p(99)<400'],
    cached_req_duration: ['p(95)<150'],
    // com TTL de 10 s, quase tudo deve sair do cache durante o pico
    cache_hit_rate: ['rate>0.95'],
  },
};

export function setup() {
  assertKey();
  const probe = http.get(`${BASE_URL}${LIVE_PATH}`, { headers: headers(), tags: { name: 'setup' } });
  if (probe.status === 404)
    fail(`${LIVE_PATH} ainda não existe nesta API (issue #31). Use LIVE_PATH para uma rota existente.`);
}

export function live() {
  // a maioria dos clientes pede a mesma lista (cache quente); parte filtra por esporte
  const sep = LIVE_PATH.includes('?') ? '&' : '?';
  const path =
    Math.random() < 0.7
      ? LIVE_PATH
      : `${LIVE_PATH}${sep}sport=${SPORTS[Math.floor(Math.random() * SPORTS.length)]}`;
  get(path, { name: 'live' });
}
