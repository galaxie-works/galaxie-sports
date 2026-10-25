#!/usr/bin/env node
/**
 * Confere que a versão do Playwright é uma só: a imagem base do Dockerfile, o package.json e o package-lock.json
 * daqui, o playwright-core do services/ai-agents (o cliente tem de falar o protocolo do servidor) e a tag da imagem
 * no compose da VPS. Subir a versão é mudar os cinco juntos (o lockfile com `npm install --package-lock-only`).
 *
 *   node infra/lineup-render/versions.mjs        # sai com 1 e lista o que diverge
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Versão de cada lugar a partir do texto dos arquivos; null = não achou. */
export function playwrightVersions({ dockerfile, pkg, lock, agentsPkg, compose }) {
  const lockJson = JSON.parse(lock);
  return {
    'infra/lineup-render/Dockerfile (FROM)':
      /^FROM\s+mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-/m.exec(dockerfile)?.[1] ?? null,
    'infra/lineup-render/package.json': JSON.parse(pkg).dependencies?.playwright ?? null,
    'infra/lineup-render/package-lock.json (playwright)':
      lockJson.packages?.['node_modules/playwright']?.version ?? null,
    'infra/lineup-render/package-lock.json (playwright-core)':
      lockJson.packages?.['node_modules/playwright-core']?.version ?? null,
    'services/ai-agents/package.json (playwright-core)':
      JSON.parse(agentsPkg).dependencies?.['playwright-core'] ?? null,
    'infra/vps-telemetry/compose.yml (lineup-render)':
      /-lineup-render:(\d+\.\d+\.\d+)\s*$/m.exec(compose)?.[1] ?? null,
  };
}

/** Problemas, vazio se todas as versões existem, são exatas e iguais. */
export function versionProblems(versions) {
  const problems = [];
  for (const [where, v] of Object.entries(versions)) {
    if (v === null) problems.push(`${where}: versão não encontrada`);
    else if (!/^\d+\.\d+\.\d+$/.test(v)) problems.push(`${where}: ${v} não é versão exata`);
  }
  const distinct = [...new Set(Object.values(versions).filter(Boolean))];
  if (distinct.length > 1)
    problems.push(
      `versões diferentes: ${Object.entries(versions)
        .map(([where, v]) => `${where} = ${v}`)
        .join('; ')}`,
    );
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const versions = playwrightVersions({
    dockerfile: read('./Dockerfile'),
    pkg: read('./package.json'),
    lock: read('./package-lock.json'),
    agentsPkg: read('../../services/ai-agents/package.json'),
    compose: read('../vps-telemetry/compose.yml'),
  });
  const problems = versionProblems(versions);
  if (problems.length) {
    for (const p of problems) console.error(`playwright: ${p}`);
    console.error('Suba a versão nos cinco lugares juntos (ver infra/lineup-render/Dockerfile).');
    process.exit(1);
  }
  console.log(`playwright ${Object.values(versions)[0]} em todos os lugares.`);
}
