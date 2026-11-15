import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guarda da troca de domínio (#626): o host do produto só aparece nos padrões de `site.ts` e `galaxie/request.ts`.
 * O resto do código lê `SITE_URL`, `PUBLIC_API_URL` ou o `.env`; `galaxie.works` sozinho segue permitido (empresa:
 * e-mail, status, User-Agent). Testes e documentação podem citar o host.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DIRS = ['apps', 'packages', 'infra'];
// o antigo não volta ao código (o 301 dele vive no .env da VPS, LEGACY_*); o novo só nos padrões
const HOST = /sports\.galaxie\.works|(platform|api)\.galaxiesports\.com/;
const ALLOWED = new Set([
  'apps/demo/src/lib/site.ts',
  'apps/demo/src/lib/galaxie/request.ts',
  'infra/ops/producao-atrasada.mjs',
]);
const SKIP_DIR = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', 'drizzle']);
const CODE = /\.(ts|tsx|js|mjs|cjs|json|ya?ml|sh)$/;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (CODE.test(name) && !/\.test\.|\.spec\./.test(name)) out.push(path);
  }
  return out;
}

describe('host do produto fora do código (#626)', () => {
  it('só os padrões de site.ts e request.ts escrevem o host', () => {
    const found = DIRS.flatMap((d) => files(join(ROOT, d)))
      .map((p) => relative(ROOT, p).replaceAll('\\', '/'))
      .filter((rel) => !ALLOWED.has(rel) && HOST.test(readFileSync(join(ROOT, rel), 'utf8')));
    expect(found).toEqual([]);
  });
});
