#!/usr/bin/env node
/**
 * Produção atrasada (issue #530): a versão que roda na produção está atrás da main há mais de 2 h, com deploy pendente.
 * Roda no workflow .github/workflows/producao-atrasada.yml, a cada 30 min. Entre 30/10 e 02/11/2026 os deploys
 * terminaram verdes sem publicar e ninguém soube até olhar a VPS; este é o alerta que teria avisado no primeiro dia.
 *
 * A fonte da verdade dos dois lados está no GitHub e na própria produção, não no Prometheus (que mora na VPS e cairia
 * junto com ela):
 *   - esperado: o `in-<hash>` de cada imagem (api, demo, ingestor) no HEAD da main, calculado por infra/ops/image-hash.sh,
 *     a mesma fórmula que o docker.yml usa para publicar a imagem e o deploy-gh.sh para escolher a tag. Compara hash, não
 *     SHA: merge que só muda docs, workflow ou outra imagem deixa o hash igual e não é atraso;
 *   - no ar: GET /version da API e da demo (`image_hash`, #572). O ingestor não tem endpoint público: vale o que a release
 *     deploy-* mais recente diz que publicou (limite documentado no runbook);
 *   - "há mais de 2 h" conta desde o commit MAIS ANTIGO da main que mudou a imagem depois da versão que roda, não desde o
 *     HEAD: com merges em sequência o relógio do HEAD reiniciaria a cada um e a produção parada nunca alertaria (era o
 *     defeito da espera por jogo ao vivo, que saiu em 02/11);
 *   - deploy em andamento (deploy.yml ainda rodando, criado há menos de 100 min) = o atraso está sendo resolvido: nada.
 *
 * Disparou: abre/atualiza a issue "Alerta: ProducaoAtrasada" pelo infra/ops/alerta-issue.sh (rótulo `alerta`, diagnóstico
 * só leitura) e o workflow manda o push pelo ntfy. A produção alcançou a main: a issue fecha sozinha.
 *
 *   node infra/ops/producao-atrasada.mjs verificar   # no Actions; GH_TOKEN e GITHUB_OUTPUT. LIMITE_MIN muda as 2 h
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const IMAGENS = ['api', 'demo', 'ingestor'];
export const LIMITE_S = 2 * 3600;
/** Deploy.yml criado há mais que isto e ainda "rodando" está preso (o teto do job é 75 min): não conta como em andamento. */
export const DEPLOY_ATIVO_S = 100 * 60;
/** Quantos commits que mexeram na entrada da imagem olhar para trás atrás da versão que roda. */
export const COMMITS_MAX = 120;
/** A chave de deduplicação da issue (hex, como o alerta-issue.sh exige). */
export const FINGERPRINT = createHash('sha256').update('ProducaoAtrasada').digest('hex').slice(0, 32);

const TAG = /^in-[0-9a-f]{7,40}$/;
export const tagValida = (tag) => typeof tag === 'string' && TAG.test(tag);
/** A tag lida (inteira ou abreviada, como nas notas da release) é a esperada. */
export const casa = (noAr, esperado) => esperado.startsWith(noAr);

/** `in-<hash>` do ingestor nas notas de uma release deploy-* (a versão é abreviada lá), ou null. */
export function ingestorDaRelease(corpo) {
  return /`ingestor` (in-[0-9a-f]{7,40})/.exec(corpo ?? '')?.[1] ?? null;
}

export function duracao(segundos) {
  const min = Math.max(0, Math.floor(segundos / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

/**
 * Desde quando a produção está atrás, para uma imagem.
 *   noAr     tag lida (in-…); esperado: tag no HEAD da main
 *   commits  () => [{ sha, ct }], do mais novo ao mais antigo, só os que mexeram na entrada da imagem
 *   hashEm   (sha) => tag da imagem naquele commit, ou null se não deu para calcular
 *   headCt   hora (epoch, s) do HEAD, usada se a versão que roda for a do commit mais novo da lista
 * `igual`: nada a fazer. `atrasada`: achou a versão que roda no histórico; `desde` é a hora do primeiro commit depois
 * dela que mudou a imagem. `desconhecida`: a tag que roda não está nos últimos commits (voltou-se muito atrás, ou veio
 * de fora do CI); `desde` é a hora do commit mais antigo examinado, o piso do atraso.
 */
export function desdeQuando({ noAr, esperado, commits, hashEm, headCt }) {
  if (casa(noAr, esperado)) return { estado: 'igual' };
  let seguinte = null;
  for (const commit of commits()) {
    const tag = hashEm(commit.sha);
    if (tag && casa(noAr, tag)) return { estado: 'atrasada', desde: (seguinte ?? { ct: headCt }).ct };
    seguinte = commit;
  }
  return { estado: 'desconhecida', desde: (seguinte ?? { ct: headCt }).ct };
}

/**
 * A decisão, pura. imagens = [{ imagem, estado: igual|atrasada|desconhecida|sem-leitura, desde, noAr, esperado }].
 *   firing    alguma imagem atrás há mais de limiteS e nenhum deploy em andamento: abre (ou segue aberta) a issue
 *   resolved  as três imagens lidas e no hash esperado: fecha a issue
 *   nada      o resto: atraso ainda curto, deploy em andamento, ou sem leitura para decidir
 */
export function decidir({ imagens, agora, limiteS = LIMITE_S, deployAtivo = false }) {
  const atrasadas = imagens.filter((i) => i.estado === 'atrasada' || i.estado === 'desconhecida');
  const vencidas = atrasadas.filter((i) => agora - i.desde > limiteS);
  const descreve = (i) =>
    `${i.imagem} atrás há ${duracao(agora - i.desde)}${i.estado === 'desconhecida' ? ' ou mais' : ''} ` +
    `(no ar ${i.noAr.slice(0, 10)}, esperado ${i.esperado.slice(0, 10)})`;
  const resumo = vencidas.map(descreve).join('; ');

  if (vencidas.length && !deployAtivo) return { acao: 'firing', resumo, motivo: resumo };
  if (vencidas.length) return { acao: 'nada', resumo, motivo: `deploy em andamento (${resumo})` };
  if (atrasadas.length) {
    return {
      acao: 'nada',
      resumo,
      motivo: `atraso ainda abaixo de ${duracao(limiteS)}: ${atrasadas.map(descreve).join('; ')}`,
    };
  }
  // só as três lidas e iguais fecham a issue: uma leitura que falhou (release fora do ar por um instante, /version
  // fora) não prova que o atraso que abriu a issue acabou
  if (imagens.length && imagens.every((i) => i.estado === 'igual')) {
    return { acao: 'resolved', resumo: '', motivo: 'produção no hash da main' };
  }
  const sem = imagens.filter((i) => i.estado === 'sem-leitura').map((i) => i.imagem);
  return { acao: 'nada', resumo: '', motivo: `sem leitura de ${sem.join(', ')}: nada a decidir` };
}

/** O payload no formato do infra/ops/alerta-issue.sh (o mesmo que o Grafana manda), com `origem` no lugar do Grafana. */
export function payload({ acao, resumo, agora, limiteS = LIMITE_S, runUrl = '' }) {
  const iso = new Date(agora * 1000).toISOString();
  return {
    status: acao === 'resolved' ? 'resolved' : 'firing',
    fingerprint: FINGERPRINT,
    name: 'ProducaoAtrasada',
    detail: 'ProducaoAtrasada',
    severity: 'warning',
    summary:
      acao === 'resolved'
        ? 'A produção alcançou a main'
        : `A produção está atrás da main há mais de ${duracao(limiteS)}: ${resumo}`,
    startsAt: iso,
    endsAt: acao === 'resolved' ? iso : '',
    url: runUrl,
    origem: 'pelo workflow Produção atrasada',
    labels: { alertname: 'ProducaoAtrasada', severity: 'warning' },
  };
}

/** Cruza os fatos (todos injetados em `d`, para testar sem rede nem git) e devolve a decisão e o que o workflow usa. */
export async function verificar(d, { agora, limiteS = LIMITE_S, runUrl = '' }) {
  const imagens = [];
  for (const imagem of IMAGENS) {
    const esperado = d.hashEm(imagem, 'HEAD');
    if (!esperado) throw new Error(`não consegui calcular o hash esperado de ${imagem} no HEAD`);
    let noAr = null;
    let erro = 'resposta sem image_hash válido';
    try {
      noAr = await d.noAr(imagem);
    } catch (err) {
      erro = err.message;
    }
    if (!tagValida(noAr)) {
      imagens.push({ imagem, estado: 'sem-leitura', noAr: null, esperado, erro });
      continue;
    }
    imagens.push({
      imagem,
      noAr,
      esperado,
      ...desdeQuando({
        noAr,
        esperado,
        commits: () => d.commits(imagem),
        hashEm: (sha) => d.hashEm(imagem, sha),
        headCt: d.headCt,
      }),
    });
  }
  const atrasada = imagens.some((i) => i.estado === 'atrasada' || i.estado === 'desconhecida');
  const deployAtivo = atrasada ? await d.deployAtivo() : false;
  const decisao = decidir({ imagens, agora, limiteS, deployAtivo });
  const novo = decisao.acao === 'firing' ? !(await d.issueAberta()) : false;
  return {
    ...decisao,
    imagens,
    novo,
    payload:
      decisao.acao === 'nada'
        ? null
        : payload({ acao: decisao.acao, resumo: decisao.resumo, agora, limiteS, runUrl }),
  };
}

// ── os fatos de verdade: git, gh e rede ─────────────────────────────────────────────────────────────────────────
const sh = (cmd, args, opt = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opt }).trim();

/** in-<hash> da imagem no commit (a fórmula é a do image-hash.sh), ou null se o cálculo falhar. */
export function hashDaImagem(imagem, rev = 'HEAD', root = ROOT) {
  try {
    return `in-${sh('bash', [join(root, 'infra/ops/image-hash.sh'), imagem, rev], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })}`;
  } catch {
    return null;
  }
}

/** Commits que mexeram na entrada da imagem (a lista de hoje), do mais novo ao mais antigo. */
export function commitsDaImagem(imagem, { root = ROOT, max = COMMITS_MAX } = {}) {
  const caminhos = sh('node', [join(root, 'infra/ops/image-inputs.mjs'), imagem], { cwd: root }).split(/\s+/);
  const saida = sh('git', ['-C', root, 'log', '-n', String(max), '--format=%H %ct', '--', ...caminhos]);
  return saida
    .split('\n')
    .filter(Boolean)
    .map((linha) => {
      const [sha, ct] = linha.split(' ');
      return { sha, ct: Number(ct) };
    });
}

async function lerVersao(url) {
  let ultimo;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: { accept: 'application/json' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${url}`);
      return (await resp.json()).image_hash;
    } catch (err) {
      ultimo = err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`${url}: ${ultimo.message}`);
}

function ingestorPublicado() {
  const lista = JSON.parse(sh('gh', ['release', 'list', '--limit', '10', '--json', 'tagName']));
  const tag = lista.find((r) => r.tagName.startsWith('deploy-'))?.tagName;
  if (!tag) throw new Error('nenhuma release deploy-*');
  const corpo = JSON.parse(sh('gh', ['release', 'view', tag, '--json', 'body'])).body;
  const versao = ingestorDaRelease(corpo);
  if (!versao) throw new Error(`a release ${tag} não traz a versão do ingestor`);
  return versao;
}

function deployAtivo(agora) {
  const runs = JSON.parse(
    sh('gh', ['run', 'list', '--workflow', 'deploy.yml', '--limit', '20', '--json', 'status,createdAt']),
  );
  return runs.some(
    (r) => r.status !== 'completed' && agora - Date.parse(r.createdAt) / 1000 < DEPLOY_ATIVO_S,
  );
}

function issueAberta() {
  const issues = JSON.parse(
    sh('gh', ['issue', 'list', '--label', 'alerta', '--state', 'open', '--limit', '200', '--json', 'body']),
  );
  return issues.some((i) => (i.body ?? '').includes(`fingerprint=${FINGERPRINT}`));
}

function fatosReais(agora) {
  return {
    hashEm: (imagem, rev) => hashDaImagem(imagem, rev),
    commits: (imagem) => commitsDaImagem(imagem),
    headCt: Number(sh('git', ['-C', ROOT, 'log', '-1', '--format=%ct'])),
    noAr: async (imagem) => {
      if (imagem === 'api')
        return lerVersao(process.env.API_VERSION_URL || 'https://api.sports.galaxie.works/version');
      if (imagem === 'demo')
        return lerVersao(process.env.DEMO_VERSION_URL || 'https://sports.galaxie.works/api/version');
      return ingestorPublicado();
    },
    deployAtivo: async () => deployAtivo(agora),
    issueAberta: async () => issueAberta(),
  };
}

async function main() {
  const [comando] = process.argv.slice(2);
  if (comando !== 'verificar') {
    console.error('uso: producao-atrasada.mjs verificar');
    process.exit(2);
  }
  const agora = Math.floor(Date.now() / 1000);
  const limiteS = Number(process.env.LIMITE_MIN) > 0 ? Number(process.env.LIMITE_MIN) * 60 : LIMITE_S;
  const runUrl = process.env.RUN_URL ?? '';
  const r = await verificar(fatosReais(agora), { agora, limiteS, runUrl });

  const linhas = r.imagens.map((i) => {
    if (i.estado === 'sem-leitura')
      return `${i.imagem}: sem leitura (${i.erro}); esperado ${i.esperado.slice(0, 10)}`;
    if (i.estado === 'igual') return `${i.imagem}: igual à main (${i.noAr.slice(0, 10)})`;
    return `${i.imagem}: ${i.estado}, no ar ${i.noAr.slice(0, 10)}, esperado ${i.esperado.slice(0, 10)}, atrás desde ${new Date(i.desde * 1000).toISOString()} (${duracao(agora - i.desde)})`;
  });
  linhas.forEach((l) => console.log(l));
  for (const i of r.imagens.filter((x) => x.estado === 'sem-leitura')) {
    console.log(`::warning::${i.imagem} sem leitura da versão no ar: ${i.erro}`);
  }
  console.log(`decisão: ${r.acao} (${r.motivo})`);

  if (process.env.GITHUB_OUTPUT) {
    const saida = {
      acao: r.acao,
      novo: String(r.novo),
      resumo: r.resumo,
      payload: r.payload ? JSON.stringify(r.payload) : '',
    };
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `${Object.entries(saida)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')}\n`,
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Produção atrasada: ${r.acao}\n\n${r.motivo}\n\n${linhas.map((l) => `- ${l}`).join('\n')}\n`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`::error::${err.message}`);
    process.exit(1);
  });
}
