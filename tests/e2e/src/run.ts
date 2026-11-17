/**
 * Executor do E2E (`pnpm --filter @galaxie/e2e-tests e2e [-- argumentos do playwright test]`):
 *
 * 1. cria o banco descartável `galaxie_e2e_<hex>` a partir de `DATABASE_URL` e aplica as migrations;
 * 2. grava o seed mínimo (`seed.ts`);
 * 3. roda o `playwright test` com o endereço do banco e as chaves semeadas no ambiente (o `playwright.config.ts` sobe
 *    a API e a demo de produção apontadas para esse banco);
 * 4. apaga o banco no fim, passe ou falhe o teste, e também em Ctrl+C.
 *
 * Por que um executor e não o `globalSetup` do Playwright: os `webServer` sobem antes do `globalSetup`, e a API e a demo
 * precisam do banco já criado e migrado.
 *
 * Roda direto no Node 24 (tipos apagados na carga, sem build): `node src/run.ts`.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

import { createDisposableDb, migrate } from './db.ts';
import { seed } from './seed.ts';

/**
 * `DATABASE_URL` do ambiente ou, na máquina, só ela do `.env` da raiz. O resto do `.env` não entra no ambiente dos
 * servidores de teste (chaves de fornecedor, SMTP de verdade): ver `isolatedFromRootEnv` no `playwright.config.ts`.
 */
function adminDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
  const fromFile = existsSync(rootEnv) ? parseEnv(readFileSync(rootEnv, 'utf8')).DATABASE_URL : undefined;
  if (!fromFile) {
    console.error(
      '[e2e] DATABASE_URL não definida (nem no ambiente nem no .env da raiz). Veja tests/e2e/README.md.',
    );
    process.exit(1);
  }
  return fromFile;
}

const startedAt = Date.now();
const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)} s`;

const db = await createDisposableDb(adminDatabaseUrl());
console.log(`[e2e] banco descartável ${db.name} criado (${elapsed()})`);

let child: ReturnType<typeof spawn> | null = null;
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    interrupted = true;
    // o Playwright derruba os webServer ao sair; o banco cai no finally abaixo
    if (child && child.exitCode === null) child.kill(signal);
  });

let code = 1;
try {
  await migrate(db.url);
  console.log(`[e2e] migrations aplicadas (${elapsed()})`);
  const seeded = await seed(db.url);
  console.log(`[e2e] seed gravado (${elapsed()})`);
  if (interrupted) throw new Error('interrompido antes do Playwright');

  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  child = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2).filter((a) => a !== '--')], {
    stdio: 'inherit',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      E2E_DATABASE_URL: db.url,
      E2E_CLIENT_TENANT_ID: seeded.clientTenantId,
      E2E_API_KEY: seeded.clientApiKey,
      E2E_DEMO_KEY: seeded.demoApiKey,
      // segredo do Better Auth e prefixo do Valkey só desta execução
      E2E_AUTH_SECRET: randomBytes(32).toString('hex'),
      E2E_RUN_ID: db.name,
    },
  });
  code = await new Promise<number>((resolve) => {
    child!.on('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
    child!.on('error', (err) => {
      console.error('[e2e] não deu para rodar o Playwright', err);
      resolve(1);
    });
  });
} catch (err) {
  console.error('[e2e] falha ao preparar o banco de teste', err);
  code = 1;
} finally {
  try {
    await db.drop();
    console.log(`[e2e] banco descartável ${db.name} apagado (${elapsed()})`);
  } catch (err) {
    console.error(`[e2e] não deu para apagar o banco ${db.name}; apague à mão`, err);
    code ||= 1;
  }
}
process.exit(code);
