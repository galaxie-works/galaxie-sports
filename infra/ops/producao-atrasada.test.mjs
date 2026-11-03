// Testes do alerta ProducaoAtrasada: node --test infra/ops/producao-atrasada.test.mjs. Duas camadas: a decisão com fatos
// de faz de conta (igual, atrasada há 1 h, atrasada há 3 h, deploy em andamento, merge só de docs, merges em sequência…)
// e o cálculo de "desde quando" em cima de um repositório git de verdade, com o image-hash.sh de verdade. Sem rede.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  commitsDaImagem,
  decidir,
  desdeQuando,
  duracao,
  FINGERPRINT,
  hashDaImagem,
  ingestorDaRelease,
  LIMITE_S,
  payload,
  tagValida,
  verificar,
} from './producao-atrasada.mjs';

const H = 3600;
const AGORA = 1_800_000_000;
const tag = (n) => `in-${String(n).padStart(2, '0')}${'a'.repeat(38)}`;

/**
 * Fatos de faz de conta. `historico[imagem]` = lista (do mais novo ao mais antigo) de [sha, horas atrás, tag que a imagem
 * tem a partir dali]; a tag esperada é a do primeiro item. `noAr[imagem]` = a tag que a produção responde (ou Error).
 */
function fatos({ historico, noAr, headHoras = 0.1, deployAtivo = false, issueAberta = false }) {
  const tagEm = (imagem, rev) => {
    if (rev === 'HEAD') return historico[imagem][0][2];
    return historico[imagem].find(([sha]) => sha === rev)?.[2] ?? null;
  };
  return {
    hashEm: tagEm,
    commits: (imagem) => historico[imagem].map(([sha, horas]) => ({ sha, ct: AGORA - horas * H })),
    headCt: AGORA - headHoras * H,
    noAr: async (imagem) => {
      const v = noAr[imagem];
      if (v instanceof Error) throw v;
      return v;
    },
    deployAtivo: async () => deployAtivo,
    issueAberta: async () => issueAberta,
  };
}

// api: mudou há 20 h (tag 1), há 10 h (tag 2) e há 3 h (tag 3, a de hoje). demo e ingestor não mudaram há dias.
const HISTORICO = {
  api: [
    ['c5', 3, tag(3)],
    ['c3', 10, tag(2)],
    ['c1', 20, tag(1)],
  ],
  demo: [['c1', 20, tag(10)]],
  ingestor: [['c1', 20, tag(20)]],
};
const EM_DIA = { api: tag(3), demo: tag(10), ingestor: tag(20) };

const rodar = (cenario, opcoes = {}) =>
  verificar(fatos({ historico: HISTORICO, noAr: EM_DIA, ...cenario }), { agora: AGORA, ...opcoes });

describe('a decisão do alerta', () => {
  it('versão igual à da main: nada a alertar, e a issue aberta fecha', async () => {
    const r = await rodar({ issueAberta: true });
    assert.equal(r.acao, 'resolved');
    assert.equal(r.novo, false);
    assert.equal(r.payload.status, 'resolved');
    assert.ok(r.imagens.every((i) => i.estado === 'igual'));
  });

  it('versão diferente há 1 h: ainda dentro do prazo, nada', async () => {
    const historico = { ...HISTORICO, api: [['c5', 1, tag(3)], ...HISTORICO.api.slice(1)] };
    const r = await rodar({ historico, noAr: { ...EM_DIA, api: tag(2) } });
    assert.equal(r.acao, 'nada');
    assert.equal(r.payload, null);
    assert.equal(r.imagens[0].estado, 'atrasada');
  });

  it('versão diferente há 3 h: alerta, com a issue nova e o push', async () => {
    const r = await rodar({ noAr: { ...EM_DIA, api: tag(2) } });
    assert.equal(r.acao, 'firing');
    assert.equal(r.novo, true);
    assert.equal(r.payload.status, 'firing');
    assert.equal(r.payload.detail, 'ProducaoAtrasada');
    assert.match(r.resumo, /api atrás há 3h00 \(no ar in-02aaaaa, esperado in-03aaaaa\)/);
  });

  it('versão diferente há 3 h com a issue já aberta: segue firing, sem push novo', async () => {
    const r = await rodar({ noAr: { ...EM_DIA, api: tag(2) }, issueAberta: true });
    assert.equal(r.acao, 'firing');
    assert.equal(r.novo, false);
  });

  it('deploy em andamento: nada, mesmo atrasada há 3 h', async () => {
    const r = await rodar({ noAr: { ...EM_DIA, api: tag(2) }, deployAtivo: true });
    assert.equal(r.acao, 'nada');
    assert.match(r.motivo, /deploy em andamento/);
  });

  it('merge que só muda docs: os hashes não mudam, não há atraso (HEAD novo, produção na versão da imagem)', async () => {
    // o HEAD é de 5 min atrás e não mexeu em imagem nenhuma: a tag esperada continua a do commit de 3 h
    const r = await rodar({ headHoras: 5 / 60 });
    assert.equal(r.acao, 'resolved');
    assert.ok(r.imagens.every((i) => i.estado === 'igual'));
  });

  it('merges em sequência não reiniciam o relógio: conta desde o primeiro commit que mudou a imagem', async () => {
    // a produção parou na tag 2; a tag 3 saiu há 3 h; de lá para cá só entraram commits de docs (HEAD de 1 min atrás)
    const r = await rodar({ noAr: { ...EM_DIA, api: tag(2) }, headHoras: 1 / 60 });
    assert.equal(r.acao, 'firing');
    assert.equal(r.imagens[0].desde, AGORA - 3 * H);
  });

  it('a produção duas versões atrás conta desde a primeira que ela não tem', async () => {
    const r = await rodar({ noAr: { ...EM_DIA, api: tag(1) } });
    assert.equal(r.imagens[0].desde, AGORA - 10 * H);
    assert.equal(r.acao, 'firing');
  });

  it('tag que não está no histórico: atrasada pelo menos desde o commit mais antigo olhado', async () => {
    const r = await rodar({ noAr: { ...EM_DIA, api: tag(99) } });
    assert.equal(r.imagens[0].estado, 'desconhecida');
    assert.equal(r.acao, 'firing');
    assert.match(r.resumo, /api atrás há 20h00 ou mais/);
  });

  it('o ingestor (lido da release) atrás há 3 h também alerta', async () => {
    const historico = {
      ...HISTORICO,
      ingestor: [
        ['c9', 3, tag(21)],
        ['c1', 20, tag(20)],
      ],
    };
    const r = await rodar({ historico });
    assert.equal(r.acao, 'firing');
    assert.match(r.resumo, /^ingestor atrás há 3h00/);
  });

  it('a release abrevia a tag do ingestor: a abreviação casa com a tag inteira', async () => {
    const r = await rodar({ noAr: { ...EM_DIA, ingestor: tag(20).slice(0, 10) } });
    assert.equal(r.imagens[2].estado, 'igual');
  });

  it('sem leitura da API (fora do ar): não decide, nem fecha issue, nem abre (isso é do ApiDown)', async () => {
    const r = await rodar({ noAr: { ...EM_DIA, api: new Error('HTTP 502') }, issueAberta: true });
    assert.equal(r.acao, 'nada');
    assert.equal(r.imagens[0].estado, 'sem-leitura');
    assert.equal(r.novo, false);
  });

  it('sem leitura do ingestor (release fora do ar): API e demo iguais não fecham a issue aberta', async () => {
    const r = await rodar({
      noAr: { ...EM_DIA, ingestor: new Error('release indisponível') },
      issueAberta: true,
    });
    assert.equal(r.acao, 'nada');
    assert.equal(r.payload, null);
    assert.match(r.motivo, /sem leitura de ingestor/);
  });

  it('resposta sem image_hash válido (imagem local, "dev"): sem leitura', async () => {
    const r = await rodar({ noAr: { ...EM_DIA, demo: 'dev' } });
    assert.equal(r.imagens[1].estado, 'sem-leitura');
    assert.equal(r.acao, 'nada');
  });

  it('a API atrasada vence a demo sem leitura', async () => {
    const r = await rodar({ noAr: { ...EM_DIA, api: tag(2), demo: new Error('timeout') } });
    assert.equal(r.acao, 'firing');
  });

  it('LIMITE_MIN menor dispara antes (teste à mão do workflow)', async () => {
    const historico = { ...HISTORICO, api: [['c5', 0.1, tag(3)], ...HISTORICO.api.slice(1)] };
    const noAr = { ...EM_DIA, api: tag(2) };
    assert.equal((await rodar({ historico, noAr })).acao, 'nada');
    assert.equal((await rodar({ historico, noAr }, { limiteS: 60 })).acao, 'firing');
  });

  it('o hash esperado que não se calcula derruba a checagem (nunca um "tudo certo" falso)', async () => {
    const f = fatos({ historico: HISTORICO, noAr: EM_DIA });
    f.hashEm = () => null;
    await assert.rejects(verificar(f, { agora: AGORA }), /não consegui calcular o hash esperado de api/);
  });

  it('o limite é de mais de 2 h: exatamente 2 h ainda não alerta', () => {
    const imagens = [
      { imagem: 'api', estado: 'atrasada', desde: AGORA - LIMITE_S, noAr: tag(2), esperado: tag(3) },
    ];
    assert.equal(decidir({ imagens, agora: AGORA }).acao, 'nada');
    assert.equal(decidir({ imagens, agora: AGORA + 1 }).acao, 'firing');
  });
});

describe('o payload da issue', () => {
  it('é o do alerta-issue.sh: fingerprint hex, status, nome e origem', () => {
    const firing = payload({ acao: 'firing', resumo: 'api atrás', agora: AGORA, runUrl: 'https://x/y' });
    assert.match(firing.fingerprint, /^[0-9a-f]{32}$/);
    assert.equal(firing.fingerprint, FINGERPRINT);
    assert.equal(firing.status, 'firing');
    assert.equal(firing.name, 'ProducaoAtrasada');
    assert.equal(firing.labels.alertname, 'ProducaoAtrasada');
    assert.match(firing.origem, /Produção atrasada/);
    assert.equal(firing.endsAt, '');
    const resolved = payload({ acao: 'resolved', resumo: '', agora: AGORA });
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.fingerprint, firing.fingerprint);
    assert.notEqual(resolved.endsAt, '');
  });
});

describe('leitura dos dados', () => {
  it('a tag do ingestor sai das notas da release', () => {
    const corpo =
      'Publicado na produção: `85e2f12` · 1 PR(s).\n\nSHA `85e2f12` · `api` in-f827e43 (trocada) · `backup` in-c552796 · `demo` in-7848f94 (trocada) · `ingestor` in-33aa925 (trocada) · `prometheus` in-629d666\n\n## Novidades';
    assert.equal(ingestorDaRelease(corpo), 'in-33aa925');
    // formato novo: a tabela "Serviços publicados" e o marcador com a tag inteira (o marcador é quem vale)
    const novo = `Publicado na produção: \`85e2f12\` · 1 PR(s).

## Serviços publicados

| Serviço | Versão | Situação |
|---|---|---|
| \`api\`, \`webhooks\` | \`in-f827e43\` | sem troca |
| \`ingestor\`, \`agents\` | \`in-1111111\` → \`in-33aa925\` | trocada |

## Novidades

<!-- galaxie-versions: api=in-f827e43aaaa ingestor=${tag(7)} demo=in-7848f94 -->`;
    assert.equal(ingestorDaRelease(novo), tag(7));
    assert.equal(ingestorDaRelease('<!-- galaxie-versions: api=in-f827e43 demo=in-7848f94 -->'), null);
    assert.equal(ingestorDaRelease('sem versões'), null);
    assert.equal(ingestorDaRelease(undefined), null);
  });

  it('só tag in-<hex> vale como leitura', () => {
    assert.ok(tagValida(tag(1)));
    assert.ok(tagValida('in-33aa925'));
    for (const ruim of [undefined, null, '', 'dev', 'latest', 'in-xyz', 'in-33aa9', tag(1).toUpperCase()]) {
      assert.equal(tagValida(ruim), false, String(ruim));
    }
  });

  it('duração em horas e minutos', () => {
    assert.equal(duracao(5 * 60), '5 min');
    assert.equal(duracao(3 * H + 12 * 60), '3h12');
    assert.equal(duracao(-5), '0 min');
  });
});

// ── git de verdade ───────────────────────────────────────────────────────────────────────────────────────────────
describe('desde quando, num repositório git', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'producao-atrasada-'));
  after(() => rmSync(root, { recursive: true, force: true }));

  const git = (...args) =>
    execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const T0 = 1_700_000_000;
  let n = 0;
  /** Commit com os arquivos dados, `horas` depois de T0; devolve { sha, ct }. */
  const commit = (arquivos, horas) => {
    for (const [caminho, texto] of Object.entries(arquivos)) {
      mkdirSync(dirname(join(root, caminho)), { recursive: true });
      writeFileSync(join(root, caminho), texto);
    }
    git('add', '-A');
    const ct = T0 + horas * H;
    execFileSync(
      'git',
      ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', `c${++n}`],
      {
        env: { ...process.env, GIT_AUTHOR_DATE: `${ct} +0000`, GIT_COMMITTER_DATE: `${ct} +0000` },
      },
    );
    return { sha: git('rev-parse', 'HEAD'), ct };
  };

  // o image-hash.sh de verdade, com um image-inputs.mjs de mentira: api = uma pasta (hash git dela); demo = duas
  // (sha256 da listagem)
  mkdirSync(join(root, 'infra/ops'), { recursive: true });
  copyFileSync(join(HERE, 'image-hash.sh'), join(root, 'infra/ops/image-hash.sh'));
  writeFileSync(
    join(root, 'infra/ops/image-inputs.mjs'),
    "console.log({ api: 'apps/api', demo: 'apps/demo packages/x' }[process.argv[2]] ?? process.exit(1));\n",
  );
  git('init', '-q');
  const c1 = commit(
    { 'apps/api/a.txt': '1', 'apps/demo/a.txt': '1', 'packages/x/a.txt': '1', 'docs/a.md': '1' },
    0,
  );
  const c2 = commit({ 'apps/api/a.txt': '2' }, 1);
  const c3 = commit({ 'docs/a.md': '2' }, 2); // só docs
  const c4 = commit({ 'packages/x/a.txt': '2' }, 3); // muda a demo, não a api
  const c5 = commit({ 'apps/api/a.txt': '3' }, 4);

  const hash = (imagem, rev = 'HEAD') => hashDaImagem(imagem, rev, root);
  const desde = (imagem, noAr) =>
    desdeQuando({
      noAr,
      esperado: hash(imagem),
      commits: () => commitsDaImagem(imagem, { root }),
      hashEm: (sha) => hash(imagem, sha),
      headCt: c5.ct,
    });

  it('o hash é o do image-hash.sh e merge só de docs não o muda', () => {
    assert.match(hash('api'), /^in-[0-9a-f]{40}$/);
    assert.equal(hash('api', c3.sha), hash('api', c2.sha));
    assert.notEqual(hash('api', c2.sha), hash('api', c1.sha));
    assert.equal(hash('demo', c3.sha), hash('demo', c1.sha)); // formula de várias pastas
    assert.notEqual(hash('demo', c4.sha), hash('demo', c3.sha));
    assert.equal(hash('naoexiste'), null);
  });

  it('só os commits que mexeram na entrada da imagem entram na lista', () => {
    assert.deepEqual(
      commitsDaImagem('api', { root }).map((c) => c.sha),
      [c5.sha, c2.sha, c1.sha],
    );
    assert.deepEqual(
      commitsDaImagem('demo', { root }).map((c) => c.sha),
      [c4.sha, c1.sha],
    );
  });

  it('produção no hash do HEAD: igual', () => {
    assert.deepEqual(desde('api', hash('api')), { estado: 'igual' });
  });

  it('produção na versão anterior: atrás desde o commit que mudou a imagem', () => {
    assert.deepEqual(desde('api', hash('api', c2.sha)), { estado: 'atrasada', desde: c5.ct });
    assert.deepEqual(desde('demo', hash('demo', c1.sha)), { estado: 'atrasada', desde: c4.ct });
  });

  it('produção duas versões atrás: desde o primeiro commit depois dela', () => {
    assert.deepEqual(desde('api', hash('api', c1.sha)), { estado: 'atrasada', desde: c2.ct });
  });

  it('a tag abreviada da release casa', () => {
    assert.deepEqual(desde('api', hash('api', c2.sha).slice(0, 10)), { estado: 'atrasada', desde: c5.ct });
  });

  it('tag fora do histórico: desconhecida, desde o commit mais antigo olhado', () => {
    assert.deepEqual(desde('api', tag(99)), { estado: 'desconhecida', desde: c1.ct });
  });
});
