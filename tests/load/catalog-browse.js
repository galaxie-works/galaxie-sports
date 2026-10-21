// Cenário: navegação de catálogo (apps de clientes abrindo telas de esportes, países, competições,
// detalhe e tabela). Mistura realista de rotas com cursor e IDs reais obtidos no setup.
//
//   PROFILE=load RATE=2000 k6 run tests/load/catalog-browse.js
import { sleep } from 'k6';
import http from 'k6/http';
import { assertKey, BASE_URL, baseThresholds, get, headers, scenarioFor } from './lib/common.js';

const LOCALES = ['pt-BR', 'es-AR', 'es-MX', 'es-CO', 'es-CL'];

export const options = {
  scenarios: { browse: scenarioFor('browse', 2000) },
  thresholds: {
    ...baseThresholds,
    // catálogo tem TTL de 24 h: depois do aquecimento, p95 do cache ≤ 150 ms
    cached_req_duration: ['p(95)<150'],
    http_req_duration: ['p(95)<300'],
  },
};

export function setup() {
  assertKey();
  const res = http.get(`${BASE_URL}/v1/competitions?limit=50`, {
    headers: headers(),
    tags: { name: 'setup' },
  });
  const comps = (res.json('data') || []).map((c) => ({ id: c.id, seasons: [] }));
  // até 10 competições com temporadas para a rota de tabela
  for (const c of comps.slice(0, 10)) {
    const d = http.get(`${BASE_URL}/v1/competitions/${c.id}`, {
      headers: headers(),
      tags: { name: 'setup' },
    });
    if (d.status === 200) c.seasons = (d.json('seasons') || []).map((s) => s.year).filter(Boolean);
  }
  if (!comps.length)
    console.warn('Nenhuma competição no banco: o cenário vai cobrir só /v1/sports e /v1/countries.');
  return { comps };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function browse(data) {
  const locale = pick(LOCALES);
  const r = Math.random();
  if (r < 0.15 || !data.comps.length) get(`/v1/sports?locale=${locale}`, { name: '/v1/sports' });
  else if (r < 0.3) get(`/v1/countries?locale=${locale}`, { name: '/v1/countries' });
  else if (r < 0.6)
    get(`/v1/competitions?country=${pick(['BR', 'AR', 'MX'])}&limit=20`, { name: '/v1/competitions' });
  else if (r < 0.85)
    get(`/v1/competitions/${pick(data.comps).id}?locale=${locale}`, { name: '/v1/competitions/:id' });
  else {
    const withSeasons = data.comps.filter((c) => c.seasons.length);
    if (!withSeasons.length) get(`/v1/competitions/${pick(data.comps).id}`, { name: '/v1/competitions/:id' });
    else {
      const c = pick(withSeasons);
      get(`/v1/competitions/${c.id}/seasons/${pick(c.seasons)}/standings`, { name: 'standings' });
    }
  }
  // no perfil smoke, um respiro simula o tempo de leitura da tela
  if (__ENV.PROFILE !== 'load' && __ENV.PROFILE !== 'peak') sleep(Math.random() * 0.2);
}
