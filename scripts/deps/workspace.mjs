import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kindOf } from './rules.mjs';

/** As pastas do workspace (pnpm-workspace.yaml); uma nova exige rever as regras antes. */
export const WORKSPACE_GROUPS = ['apps', 'services', 'packages', 'tests'];

/** Os padrões do pnpm-workspace.yaml que as regras conhecem (`tests/` só tem o pacote de integração). */
const EXPECTED_GLOBS = ['apps/*', 'services/*', 'packages/*', 'tests/integration'];

export const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * Os pacotes do workspace: pasta (relativa à raiz, com "/"), nome, camada e o package.json lido. Falha se o
 * pnpm-workspace.yaml listar outra coisa que apps/*, services/* e packages/*: a camada de um pacote sai da pasta.
 */
export function readUnits(root) {
  const manifest = join(root, 'pnpm-workspace.yaml');
  if (existsSync(manifest)) {
    const globs = [];
    let inside = false;
    for (const line of readFileSync(manifest, 'utf8').split(/\r?\n/)) {
      if (/^packages:\s*(#.*)?$/.test(line)) inside = true;
      else if (inside) {
        const item = line.match(/^\s*-\s+['"]?([^'"#\s]+)['"]?\s*(#.*)?$/);
        if (item) globs.push(item[1]);
        else if (!/^\s*(#.*)?$/.test(line)) break;
      }
    }
    const expected = EXPECTED_GLOBS;
    if (globs.length && JSON.stringify([...globs].sort()) !== JSON.stringify([...expected].sort())) {
      throw new Error(
        `pnpm-workspace.yaml lista ${globs.join(', ')}; as regras de dependência conhecem só ${expected.join(', ')}. ` +
          'Ensine a nova pasta a scripts/deps/rules.mjs antes de adicioná-la.',
      );
    }
  }
  const units = [];
  for (const group of WORKSPACE_GROUPS) {
    const parent = join(root, group);
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `${group}/${entry.name}`;
      const file = join(root, dir, 'package.json');
      if (!existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      units.push({ dir, name: pkg.name, kind: kindOf(dir), group, pkg });
    }
  }
  return units.sort((a, b) => (a.dir < b.dir ? -1 : 1));
}
