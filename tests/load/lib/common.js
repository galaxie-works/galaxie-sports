// Utilitários compartilhados pelos cenários k6 (tests/load/README.md).
import http from 'k6/http';
import { check, fail } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/** URL base da API (no container do k6, o host local é host.docker.internal). */
export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
/** Chave do tenant de carga (crie com rate limit alto; ver README). */
export const API_KEY = __ENV.API_KEY || '';
/** smoke (padrão) | load | peak */
export const PROFILE = __ENV.PROFILE || 'smoke';

/** Latência das respostas servidas do cache (x-galaxie-cache: HIT) e das montadas no banco (MISS). */
export const cachedDuration = new Trend('cached_req_duration', true);
export const uncachedDuration = new Trend('uncached_req_duration', true);
export const cacheHitRate = new Rate('cache_hit_rate');
/** 429 do rate limit do tenant: o tenant de carga está mal configurado. */
export const rateLimited = new Rate('rate_limited');

export function headers(extra = {}) {
  return { 'x-galaxie-key': API_KEY, 'accept-language': 'pt-BR', ...extra };
}

/** GET autenticado com checagens e métricas de cache; `name` agrupa URLs com parâmetros. */
export function get(path, { name, tags = {} } = {}) {
  const res = http.get(`${BASE_URL}${path}`, {
    headers: headers(),
    tags: { name: name || path, ...tags },
  });
  const cache = res.headers['X-Galaxie-Cache'];
  if (cache === 'HIT') cachedDuration.add(res.timings.duration, { route: name || path });
  else if (cache === 'MISS') uncachedDuration.add(res.timings.duration, { route: name || path });
  if (cache) cacheHitRate.add(cache === 'HIT');
  rateLimited.add(res.status === 429);
  check(res, {
    'status 200': (r) => r.status === 200,
    'corpo JSON': (r) => (r.headers['Content-Type'] || '').includes('application/json'),
  });
  return res;
}

/** Falha cedo se a chave não estiver configurada ou não autenticar. */
export function assertKey() {
  if (!API_KEY) fail('Defina API_KEY (chave do tenant de carga). Ver tests/load/README.md.');
  const res = http.get(`${BASE_URL}/v1/account`, { headers: headers(), tags: { name: 'setup' } });
  if (res.status !== 200) fail(`API_KEY não autenticou em ${BASE_URL} (status ${res.status}).`);
  const limit = res.json('tenant.rateLimitPerMinute');
  if (limit < 100000)
    console.warn(
      `rateLimitPerMinute do tenant = ${limit}: o teste vai bater no 429. Use um tenant de carga.`,
    );
}

/**
 * Executor por perfil. smoke: poucos VUs, curto (prova que o script funciona; não é benchmark).
 * load/peak: taxa de chegada constante/rampa até `targetRps` (meta documentada por cenário).
 */
export function scenarioFor(exec, targetRps) {
  const duration = __ENV.DURATION || (PROFILE === 'smoke' ? '30s' : '5m');
  const rps = Number(__ENV.RATE || targetRps);
  if (PROFILE === 'smoke') {
    return { executor: 'constant-vus', exec, vus: Number(__ENV.VUS || 5), duration };
  }
  const maxVUs = Number(__ENV.MAX_VUS || Math.max(100, Math.ceil(rps / 20)));
  if (PROFILE === 'peak') {
    // pico de audiência (gol em clássico/final): sobe em 30 s, segura, desce
    return {
      executor: 'ramping-arrival-rate',
      exec,
      startRate: Math.ceil(rps / 10),
      timeUnit: '1s',
      preAllocatedVUs: Math.ceil(maxVUs / 2),
      maxVUs,
      stages: [
        { target: rps, duration: '30s' },
        { target: rps, duration },
        { target: Math.ceil(rps / 10), duration: '30s' },
      ],
    };
  }
  return {
    executor: 'constant-arrival-rate',
    exec,
    rate: rps,
    timeUnit: '1s',
    duration,
    preAllocatedVUs: Math.ceil(maxVUs / 2),
    maxVUs,
  };
}

/** Limiares comuns: erros < 1%, nenhum 429, checks ≥ 99%. */
export const baseThresholds = {
  http_req_failed: ['rate<0.01'],
  rate_limited: ['rate==0'],
  checks: ['rate>0.99'],
};
