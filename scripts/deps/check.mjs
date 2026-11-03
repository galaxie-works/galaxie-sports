#!/usr/bin/env node
/**
 * Regra de dependência do monorepo (issue #547): `pnpm lint:deps`.
 *
 *   pnpm lint:deps                    # reprova com o nome da regra violada; confere também o mapa de docs/15
 *   pnpm lint:deps --map=warn         # mapa desatualizado só avisa (fila de merge e push: não derruba o que já passou)
 *   pnpm deps:map                     # reescreve o mapa e a tabela de regras de docs/15 (commite o resultado)
 *
 * O dependency-cruiser lê os imports (TS, TSX, ESM, dynamic import, `import type`) de apps/, services/ e packages/; as
 * regras estão em rules.mjs. Três verificações, todas com o nome da regra:
 *   1. imports entre pacotes (pelo nome `@galaxie/x` ou por caminho relativo);
 *   2. dependências `@galaxie/*` declaradas nos package.json (dependencies, devDependencies, peer, optional);
 *   3. o nome de host da api-sports no texto de qualquer arquivo de código fora do apisports-client.
 *
 * O que já violava quando a regra entrou está em exceptions.json, com o motivo de cada linha. Exceção que deixou de
 * ser necessária também reprova: quem corrige a violação apaga a linha.
 */
import { cruise } from 'dependency-cruiser';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMap, renderRulesTable, updateBlocks } from './map.mjs';
import {
  ALL_RULES,
  APISPORTS_HOST,
  APISPORTS_OWNER,
  APISPORTS_RULE,
  isTestFile,
  RULES,
  UNCLASSIFIED_RULE,
} from './rules.mjs';
import { DEP_FIELDS, readUnits, WORKSPACE_GROUPS } from './workspace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const EXCEPTIONS_FILE = join(HERE, 'exceptions.json');
const DOC_FILE = 'docs/15-organizacao-do-monorepo.md';
const MAP_RULE = 'mapa-desatualizado';

const CRUISE_EXCLUDE = '(^|/)(node_modules|dist|\\.next|\\.turbo|coverage|drizzle)(/|$)';

/** Pastas onde o nome de host da api-sports é procurado (o texto, não só os imports). */
const HOST_SCAN_DIRS = ['apps', 'services', 'packages', 'scripts', 'infra', 'tests', '.github'];
const HOST_SCAN_EXT = /\.(?:[cm]?[jt]sx?|ps1|sh|ya?ml)$/;
const HOST_SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', 'drizzle', '.git']);
/** O próprio verificador cita o host nos testes e nas regras. */
const HOST_SKIP_PATHS = ['scripts/deps/'];

/** @typedef {{ rule: string, from: string, to: string, detail: string }} Violation */

const key = (v) => `${v.rule}|${v.from}|${v.to}`;

/**
 * Lê o repositório em `root` e devolve as violações brutas (antes das exceções) e as arestas de código entre
 * pacotes (para o mapa).
 * @returns {Promise<{ violations: Violation[], edges: Map<string, Set<string>>, units: ReturnType<typeof readUnits> }>}
 */
export async function collect(root = REPO_ROOT) {
  const units = readUnits(root);
  const byName = new Map(units.map((u) => [u.name, u]));
  const byDir = new Map(units.map((u) => [u.dir, u]));
  const unitOfPath = (path) => {
    const [group, name] = path.split('/');
    return byDir.get(`${group}/${name}`) ?? null;
  };

  /** @type {Map<string, Violation>} */
  const found = new Map();
  const add = (v) => {
    const k = key(v);
    if (!found.has(k)) found.set(k, v);
  };
  /** unidade → unidades que o código de produção (fora de testes) importa */
  const edges = new Map(units.map((u) => [u.dir, new Set()]));

  for (const unit of units) {
    if (unit.kind === null) {
      add({
        rule: UNCLASSIFIED_RULE.id,
        from: `${unit.dir}/package.json`,
        to: unit.dir,
        detail: `${unit.name} não está em nenhuma camada de PACKAGE_LAYERS`,
      });
    }
  }

  const check = (from, to, fromFile, detail) => {
    if (from.dir === to.dir || from.kind === null || to.kind === null) return;
    for (const rule of RULES) {
      if (rule.applies(from, to)) add({ rule: rule.id, from: fromFile, to: to.dir, detail });
    }
  };

  // 1. imports no código
  const groups = WORKSPACE_GROUPS.filter((g) => existsSync(join(root, g)));
  if (groups.length) {
    const result = await cruise(
      groups,
      {
        baseDir: root,
        exclude: { path: CRUISE_EXCLUDE },
        doNotFollow: { path: 'node_modules' },
        tsPreCompilationDeps: true,
        outputType: 'json',
      },
      {
        extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.json'],
        extensionAlias: { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'], '.jsx': ['.tsx', '.jsx'] },
      },
    );
    const modules = JSON.parse(result.output).modules;
    for (const module of modules) {
      const fromUnit = unitOfPath(module.source);
      if (!fromUnit) continue;
      for (const dep of module.dependencies) {
        let toUnit = null;
        if (dep.module.startsWith('@galaxie/')) {
          // pelo nome do pacote: não depende de ele estar compilado (dist/) nem do mapa de exports
          const name = dep.module.split('/').slice(0, 2).join('/');
          toUnit = byName.get(name) ?? null;
          if (!toUnit) {
            add({
              rule: 'import-de-pacote-inexistente',
              from: module.source,
              to: name,
              detail: `"${dep.module}" não é um pacote do workspace`,
            });
            continue;
          }
        } else if (!dep.couldNotResolve && !dep.coreModule && !dep.resolved.includes('node_modules')) {
          toUnit = unitOfPath(dep.resolved);
        }
        if (!toUnit || toUnit.dir === fromUnit.dir) continue;
        if (!isTestFile(module.source)) edges.get(fromUnit.dir).add(toUnit.dir);
        check(fromUnit, toUnit, module.source, `import de "${dep.module}"`);
      }
    }
  }

  // 2. dependências declaradas no package.json
  for (const unit of units) {
    for (const field of DEP_FIELDS) {
      for (const name of Object.keys(unit.pkg[field] ?? {})) {
        const target = byName.get(name);
        if (target) check(unit, target, `${unit.dir}/package.json`, `${field}: ${name}`);
      }
    }
  }

  // 3. o host da api-sports fora do apisports-client
  for (const file of walk(root, HOST_SCAN_DIRS)) {
    if (file === APISPORTS_OWNER || file.startsWith(`${APISPORTS_OWNER}/`)) continue;
    if (HOST_SKIP_PATHS.some((p) => file.startsWith(p)) || isTestFile(file)) continue;
    const lines = readFileSync(join(root, file), 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (/^\s*(?:\/\/|\/\*|\*|#|<!--)/.test(lines[i])) continue; // comentário: citar o host não é falar com ele
      const hit = [...lines[i].matchAll(APISPORTS_HOST)][0];
      if (hit) {
        add({
          rule: APISPORTS_RULE.id,
          from: file,
          to: 'api-sports',
          detail: `linha ${i + 1}: ${hit[0]}`,
        });
        break;
      }
    }
  }

  return { violations: [...found.values()], edges, units };
}

/** Arquivos de código sob `dirs`, relativos à raiz. */
function* walk(root, dirs) {
  const stack = dirs.filter((d) => existsSync(join(root, d)));
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!HOST_SKIP_DIRS.has(entry.name)) stack.push(path);
      } else if (HOST_SCAN_EXT.test(entry.name) && statSync(join(root, path)).size < 2_000_000) {
        yield path;
      }
    }
  }
}

/** @typedef {{ rule: string, from: string, to: string, reason: string }} Exception */

/** Lê e valida a lista de exceções. */
export function loadExceptions(file = EXCEPTIONS_FILE) {
  if (!existsSync(file)) return [];
  const list = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(list)) throw new Error(`${file}: esperava uma lista`);
  const known = new Set([...ALL_RULES.map((r) => r.id), 'import-de-pacote-inexistente']);
  const seen = new Set();
  for (const [i, e] of list.entries()) {
    for (const field of ['rule', 'from', 'to', 'reason']) {
      if (typeof e[field] !== 'string' || !e[field].trim()) {
        throw new Error(`${file}: exceção #${i + 1} sem "${field}"`);
      }
    }
    if (!known.has(e.rule))
      throw new Error(`${file}: exceção #${i + 1} cita a regra desconhecida "${e.rule}"`);
    if (e.reason.trim().length < 20) {
      throw new Error(`${file}: exceção #${i + 1} (${e.from}) precisa de um motivo de verdade em "reason"`);
    }
    if (seen.has(key(e))) throw new Error(`${file}: exceção repetida: ${key(e)}`);
    seen.add(key(e));
  }
  return list;
}

/** Separa o que as exceções cobrem do que reprova, e as exceções que não cobrem mais nada. */
export function applyExceptions(violations, exceptions) {
  const allowed = new Map(exceptions.map((e) => [key(e), e]));
  const used = new Set();
  const failing = [];
  const excepted = [];
  for (const v of violations) {
    if (allowed.has(key(v))) {
      used.add(key(v));
      excepted.push(v);
    } else {
      failing.push(v);
    }
  }
  const stale = exceptions.filter((e) => !used.has(key(e)));
  return { failing, excepted, stale };
}

const titleOf = (id) => ALL_RULES.find((r) => r.id === id) ?? { summary: id, why: '' };

/** O relatório legível; em GitHub Actions também gera as anotações no diff. */
export function formatReport({ failing, stale, mapProblem }, { actions = false } = {}) {
  const lines = [];
  const byRule = new Map();
  for (const v of failing) byRule.set(v.rule, [...(byRule.get(v.rule) ?? []), v]);
  for (const [id, list] of byRule) {
    const rule = titleOf(id);
    lines.push(`✖ ${id}: ${rule.summary}`);
    if (rule.why) lines.push(`    ${rule.why}`);
    for (const v of list) {
      lines.push(`    ${v.from} → ${v.to}  (${v.detail})`);
      if (actions)
        lines.push(`::error file=${v.from},title=${id}::${rule.summary} ${v.detail} (${v.from} → ${v.to})`);
    }
    lines.push('');
  }
  if (stale.length) {
    lines.push(
      '✖ excecao-sem-violacao: exceções de scripts/deps/exceptions.json que não cobrem mais nada (apague a linha)',
    );
    for (const e of stale) {
      lines.push(`    ${e.rule}: ${e.from} → ${e.to}`);
      if (actions) {
        lines.push(
          `::error file=scripts/deps/exceptions.json,title=excecao-sem-violacao::${key(e)} não é mais violada; apague a exceção`,
        );
      }
    }
    lines.push('');
  }
  if (mapProblem) {
    lines.push(`${mapProblem.fatal ? '✖' : '⚠'} ${MAP_RULE}: ${mapProblem.message}`);
    if (actions) {
      lines.push(
        `::${mapProblem.fatal ? 'error' : 'warning'} file=${DOC_FILE},title=${MAP_RULE}::${mapProblem.message}`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Compara o mapa e a tabela de regras de docs/15 com o que a ferramenta gera agora. */
export function checkDoc(root, edges, units) {
  const file = join(root, DOC_FILE);
  if (!existsSync(file)) return null;
  // o checkout do Windows pode trazer CRLF; o repositório guarda LF
  const current = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const next = updateBlocks(current, {
    'deps-map': renderMap(units, edges),
    'deps-rules': renderRulesTable(),
  });
  return { file, current, next };
}

function parseArgs(argv) {
  const opts = { map: 'error', write: false, root: REPO_ROOT, exceptions: EXCEPTIONS_FILE };
  for (const arg of argv) {
    if (arg === '--write-map') opts.write = true;
    else if (arg.startsWith('--map=')) opts.map = arg.slice('--map='.length);
    else if (arg.startsWith('--root=')) opts.root = resolve(arg.slice('--root='.length));
    else if (arg.startsWith('--exceptions=')) opts.exceptions = resolve(arg.slice('--exceptions='.length));
    else
      throw new Error(
        `argumento desconhecido: ${arg} (use --write-map, --map=error|warn|off, --root=, --exceptions=)`,
      );
  }
  if (!['error', 'warn', 'off'].includes(opts.map)) throw new Error('--map aceita error, warn ou off');
  return opts;
}

export async function main(argv) {
  const opts = parseArgs(argv);
  const actions = process.env.GITHUB_ACTIONS === 'true';
  const exceptions = loadExceptions(opts.exceptions);
  const { violations, edges, units } = await collect(opts.root);
  const { failing, excepted, stale } = applyExceptions(violations, exceptions);

  const doc = checkDoc(opts.root, edges, units);
  if (opts.write) {
    if (!doc) throw new Error(`${DOC_FILE} não existe`);
    writeFileSync(doc.file, doc.next);
    console.log(`${DOC_FILE}: mapa e tabela de regras atualizados.`);
    return 0;
  }

  let mapProblem = null;
  if (doc && opts.map !== 'off' && doc.next !== doc.current) {
    mapProblem = {
      fatal: opts.map === 'error',
      message: `o mapa de dependências (ou a tabela de regras) de ${DOC_FILE} não bate com o código; rode "pnpm deps:map" e commite o resultado.`,
    };
  }

  const report = formatReport({ failing, stale, mapProblem }, { actions });
  if (report) console.log(report);
  const ok = !failing.length && !stale.length && !(mapProblem && mapProblem.fatal);
  console.log(
    ok
      ? `dependências ok: ${units.length} pacotes, ${RULES.length + 1} regras, ${excepted.length} exceções versionadas${mapProblem ? ' (mapa desatualizado: aviso)' : ''}.`
      : `dependências reprovadas: ${failing.length} violações, ${stale.length} exceções sem uso${mapProblem && mapProblem.fatal ? ', mapa desatualizado' : ''}.`,
  );
  return ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  }
}
