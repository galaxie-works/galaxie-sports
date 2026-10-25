// node --test infra/lineup-render/versions.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromHasDigest, playwrightVersions, versionProblems } from './versions.mjs';

const files = (v = {}) => ({
  dockerfile: `# comentário\nFROM mcr.microsoft.com/playwright:v${v.image ?? '1.64.0'}-noble@sha256:abc\nUSER pwuser\n`,
  pkg: JSON.stringify({ dependencies: { playwright: v.pkg ?? '1.64.0' } }),
  lock: JSON.stringify({
    packages: {
      'node_modules/playwright': { version: v.lock ?? '1.64.0' },
      'node_modules/playwright-core': { version: v.lockCore ?? '1.64.0' },
    },
  }),
  agentsPkg: JSON.stringify({ dependencies: { 'playwright-core': v.agents ?? '1.64.0' } }),
  compose: `  lineup-render:\n    image: \${IMAGE_PREFIX:?defina IMAGE_PREFIX}-lineup-render:${v.compose ?? '1.64.0'}\n`,
});

test('tudo na mesma versão exata: sem problemas', () => {
  const versions = playwrightVersions(files());
  assert.equal(Object.keys(versions).length, 6);
  assert.deepEqual(versionProblems(versions), []);
});

test('o cliente dos agents subiu sozinho (Dependabot): acusa a divergência', () => {
  const problems = versionProblems(playwrightVersions(files({ agents: '1.65.0' })));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /services\/ai-agents\/package\.json \(playwright-core\) = 1\.65\.0/);
});

test('imagem base ou tag do compose fora de sincronia', () => {
  assert.equal(versionProblems(playwrightVersions(files({ image: '1.63.1' }))).length, 1);
  assert.equal(versionProblems(playwrightVersions(files({ compose: '1.63.1' }))).length, 1);
});

test('faixa em vez de versão exata e versão ausente', () => {
  assert.deepEqual(versionProblems(playwrightVersions(files({ pkg: '^1.64.0' }))).slice(0, 1), [
    'infra/lineup-render/package.json: ^1.64.0 não é versão exata',
  ]);
  const noCompose = { ...files(), compose: 'services: {}\n' };
  assert.deepEqual(versionProblems(playwrightVersions(noCompose)), [
    'infra/vps-telemetry/compose.yml (lineup-render): versão não encontrada',
  ]);
});

test('FROM fixado por digest', () => {
  const digest = 'a'.repeat(64);
  assert.equal(fromHasDigest(`FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:${digest}\n`), true);
  assert.equal(fromHasDigest('FROM mcr.microsoft.com/playwright:v1.64.0-noble\n'), false);
  assert.equal(fromHasDigest('FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:abc\n'), false);
});
