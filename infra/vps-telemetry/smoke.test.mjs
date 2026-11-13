/**
 * Teste do retry do smoke (#533): roda o smoke.mjs de verdade, como o deploy roda, contra um servidor HTTP local que
 * se faz de API, de demo e de página de manutenção. Cada rota escolhe como responde (500 e depois 200, 500 sempre,
 * 404, travada na primeira vez) e o teste confere as linhas PASS/WARN/FAIL que saem.
 *
 *   node --test infra/vps-telemetry/smoke.test.mjs
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SMOKE = fileURLToPath(new URL('./smoke.mjs', import.meta.url));

const hits = new Map();
const hung = [];
let server;
let base;

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

// rota → resposta a cada chamada (n = 1, 2, …)
const routes = {
  // 5xx na primeira, 200 na segunda: o caso do deploy com a VPS saturada
  '/health': (n, res) => (n === 1 ? json(res, 500, {}) : json(res, 200, { ok: true })),
  // 4xx não repete
  '/v1/glossary': (n, res) => json(res, 404, {}),
  // trava na primeira (tempo esgotado) e responde na segunda
  '/v1/events/live': (n, res) => {
    if (n === 1) hung.push(res);
    else json(res, 200, { data: [] });
  },
  // 500 sempre: o resumo da home que estourou o statement_timeout em todas as tentativas
  '/v1/explore/summary': (n, res) => json(res, 500, { code: 'INTERNAL' }),
  '/v1/explore/agenda': (n, res) => json(res, 200, { total: 5, days: [{ count: 5 }] }),
};

before(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const n = (hits.get(path) ?? 0) + 1;
    hits.set(path, n);
    (routes[path] ?? ((_n, r) => json(r, 404, {})))(n, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  for (const res of hung) res.destroy();
  server.closeAllConnections();
  server.close();
});

describe('smoke: retry de 5xx e de tempo esgotado', () => {
  let lines;
  let exitCode;

  before(async () => {
    const result = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [SMOKE],
        {
          env: {
            PATH: process.env.PATH,
            GALAXIE_API_URL: base,
            GALAXIE_DEMO_KEY: 'chave-de-teste',
            SMOKE_DEMO_URL: base,
            SMOKE_MAINTENANCE_SITE_URL: base,
            SMOKE_MAINTENANCE_API_URL: base,
            SMOKE_RETRY_MS: '50',
            SMOKE_RETRIES: '3',
            SMOKE_TIMEOUT_MS: '400',
          },
          timeout: 60_000,
        },
        (err, stdout) => resolve({ code: err ? (err.code ?? 1) : 0, stdout }),
      );
    });
    exitCode = result.code;
    lines = result.stdout.split('\n');
  });

  const line = (name) => lines.find((l) => l.includes(name));

  test('5xx e depois 200: PASS com "(2ª tentativa)" e um WARN apontando a checagem', () => {
    assert.match(line('API /health'), /^PASS {2}API \/health\s+\(2ª tentativa\)/);
    const warn = lines.find(
      (l) => l.startsWith('WARN') && l.includes('Checagem repetida') && l.includes('API /health'),
    );
    assert.ok(warn, 'falta o WARN da checagem repetida');
    assert.match(warn, /status 500 na 1ª tentativa, passou na 2ª/);
    assert.equal(hits.get('/health'), 2);
  });

  test('tempo esgotado e depois resposta: PASS na 2ª tentativa', () => {
    assert.match(
      line('Ao vivo (endpoint)'),
      /^PASS {2}Ao vivo \(endpoint\)\s+0 jogos ao vivo agora \(2ª tentativa\)/,
    );
    assert.match(
      lines.find((l) => l.startsWith('WARN') && l.includes('"Ao vivo (endpoint)"')),
      /tempo esgotado na 1ª tentativa/,
    );
    assert.equal(hits.get('/v1/events/live'), 2);
  });

  test('4xx não repete: uma chamada só e FAIL direto', () => {
    assert.match(line('Glossário'), /^FAIL {2}Glossário.*status 404/);
    assert.doesNotMatch(line('Glossário'), /tentativa/);
    assert.equal(hits.get('/v1/glossary'), 1);
  });

  test('5xx em todas as tentativas: FAIL com o motivo da primeira, depois de 1 + SMOKE_RETRIES chamadas', () => {
    assert.match(
      line('Home Explorar'),
      /^FAIL {2}Home Explorar.*status 500 \(após 4 tentativas; 1ª: status 500\)/,
    );
    assert.equal(hits.get('/v1/explore/summary'), 4);
  });

  test('agenda não reprova por "home 0" quando a home já falhou: WARN dependente', () => {
    const agenda = line('Agenda conta os mesmos jogos que a home');
    assert.match(agenda, /^WARN {2}Agenda/);
    assert.match(agenda, /depende de "Home Explorar/);
    assert.doesNotMatch(agenda, /home 0/);
  });

  test('o relatório e o código de saída seguem o formato que o deploy lê', () => {
    assert.ok(lines.some((l) => /^\d+ ok · \d+ aviso\(s\) · \d+ falha\(s\)$/.test(l)));
    assert.equal(exitCode, 1, 'há FAIL (home, demo): sai com 1');
    for (const l of lines.filter(
      (x) => x.trim() && !x.includes('ok ·') && !x.startsWith('smoke no candidato'),
    ))
      assert.match(l, /^(PASS|FAIL|WARN)\s/, `linha fora do formato: ${l}`);
  });
});
