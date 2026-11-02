#!/usr/bin/env node
/**
 * Entrada de cada imagem do Node (api, demo, ingestor): o que, ao mudar, muda a imagem. O passo "Entrada da imagem" do
 * docker.yml faz o hash dessa lista; entrada igual reaproveita a imagem publicada em vez de reconstruir.
 *
 * A lista é o fechamento de dependências do app no workspace (dependencies, devDependencies e as demais, de forma
 * transitiva: o `pnpm --filter "@galaxie/app..."` do Dockerfile constrói também as de dev, então elas quebram e mudam
 * o build), mais o que o Dockerfile copia de fora do grafo, mais os arquivos da raiz que o build lê. Node puro e sem
 * dependências: o passo roda logo depois do checkout, sem pnpm install. Quem confere esta lista contra os Dockerfiles
 * é o image-inputs.test.mjs: um COPY novo sem entrada aqui reprova o CI.
 *
 *   node infra/ops/image-inputs.mjs ingestor                     # a entrada da imagem, numa linha e ordenada
 *   node infra/ops/image-inputs.mjs --changed config/assets/x    # as imagens que mudam com esses caminhos
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Lidos pelo build de toda imagem do Node (instalação, tsconfig, turbo e o próprio contexto do COPY . .). */
const ROOT_FILES = [
  '.dockerignore',
  '.nvmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'turbo.json',
];

const SELFHEAL = 'infra/healthcheck/selfheal.mjs';

/**
 * roots = os pacotes que o Dockerfile constrói (--filter "x..."); external = o que ele copia de fora do grafo.
 * A demo leva só os dicionários de emissoras do config/, de propósito: api e ingestor levam o config/ inteiro, e por
 * isso qualquer mudança nele reconstrói as duas.
 */
export const IMAGES = {
  api: { roots: ['@galaxie/api'], external: ['config', 'data/knowledge', SELFHEAL] },
  demo: { roots: ['@galaxie/demo'], external: ['config/broadcast-rights', 'config/broadcasters', SELFHEAL] },
  ingestor: {
    roots: ['@galaxie/ingestor', '@galaxie/ai-agents'],
    external: ['config', 'data/knowledge', SELFHEAL],
  },
};

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/** Os padrões de `packages:` do pnpm-workspace.yaml. Só a lista em bloco: outra forma falha em vez de achar menos. */
function workspaceGlobs(root) {
  const globs = [];
  let inside = false;
  for (const line of readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8').split(/\r?\n/)) {
    if (/^packages:\s*(#.*)?$/.test(line)) {
      inside = true;
    } else if (inside && !/^\s*(#.*)?$/.test(line)) {
      const item = line.match(/^\s*-\s+['"]?([^'"#\s]+)['"]?\s*(#.*)?$/);
      if (!item) break;
      globs.push(item[1]);
    }
  }
  if (!globs.length) throw new Error('pnpm-workspace.yaml sem lista em packages:');
  return globs;
}

/** nome do pacote → pasta (relativa à raiz, com "/") e nomes de que ele depende. */
export function readWorkspace(root = REPO_ROOT) {
  const dirs = workspaceGlobs(root).flatMap((glob) => {
    if (/[*!?{[]/.test(glob.replace(/\/\*$/, '')))
      throw new Error(`padrão do workspace não suportado: ${glob}`);
    if (!glob.endsWith('/*')) return [glob];
    const parent = glob.slice(0, -2);
    return readdirSync(join(root, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
  const workspace = new Map();
  for (const dir of dirs) {
    const file = join(root, dir, 'package.json');
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    workspace.set(pkg.name, { dir, deps: DEP_FIELDS.flatMap((field) => Object.keys(pkg[field] ?? {})) });
  }
  return workspace;
}

/** As pastas dos pacotes do workspace alcançáveis a partir de `roots`, incluindo elas. */
export function closure(workspace, roots) {
  const seen = new Set();
  const pending = [...roots];
  while (pending.length) {
    const name = pending.pop();
    if (seen.has(name)) continue;
    const pkg = workspace.get(name);
    if (!pkg) throw new Error(`pacote fora do workspace: ${name}`);
    seen.add(name);
    pending.push(...pkg.deps.filter((dep) => workspace.has(dep)));
  }
  return [...seen].map((name) => workspace.get(name).dir);
}

/**
 * A entrada de uma imagem, ordenada (a ordem é por código, não por idioma, para a saída ser a mesma em toda máquina).
 * Caminho que não existe falha aqui: o `git ls-tree` o ignoraria calado, e a imagem deixaria de mudar com ele.
 */
export function imageInputs(image, root = REPO_ROOT) {
  const spec = Object.hasOwn(IMAGES, image) ? IMAGES[image] : null;
  if (!spec) throw new Error(`imagem desconhecida: ${image} (use ${Object.keys(IMAGES).join(', ')})`);
  const inputs = [
    ...new Set([...closure(readWorkspace(root), spec.roots), ...spec.external, ...ROOT_FILES]),
  ].sort();
  const missing = inputs.filter((path) => !existsSync(join(root, path)));
  if (missing.length) throw new Error(`entrada de ${image} não existe: ${missing.join(', ')}`);
  return inputs;
}

/** O caminho está na entrada (é um item dela ou fica dentro de uma pasta dela). */
export function isCovered(path, inputs) {
  return inputs.some((input) => path === input || path.startsWith(`${input}/`));
}

/** As imagens cuja entrada contém algum dos caminhos alterados. */
export function imagesChangedBy(paths, root = REPO_ROOT) {
  return Object.keys(IMAGES).filter((image) => {
    const inputs = imageInputs(image, root);
    return paths.some((path) => isCovered(path, inputs));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [first, ...rest] = process.argv.slice(2);
  try {
    if (!first || (first !== '--changed' && rest.length)) {
      throw new Error('uso: image-inputs.mjs <imagem> | image-inputs.mjs --changed <caminho>...');
    }
    console.log((first === '--changed' ? imagesChangedBy(rest) : imageInputs(first)).join(' '));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
