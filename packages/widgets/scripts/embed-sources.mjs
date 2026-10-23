#!/usr/bin/env node
// Embute os fontes dos widgets em `src/registry/sources.generated.ts` para o `buildRegistryItem`.
//
// O registry shadcn entrega código-fonte, não um pacote. Para o arquivo que a operadora instala nunca
// ficar velho em relação ao pacote, ele sai destes mesmos arquivos a cada build/typecheck/test:
//   - src/core/model.ts + src/core/react.tsx  → `galaxie-core.tsx` (um arquivo só, autocontido);
//   - src/widgets/<widget>.tsx                 → corpo do widget, com os imports trocados por './galaxie-core'.
// O arquivo gerado fica fora do git (.gitignore) e é refeito só quando muda.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');

/** kind → arquivo e componente. */
const WIDGETS = {
  match_card: { file: 'src/widgets/match-card.tsx', component: 'MatchCard' },
  live_list: { file: 'src/widgets/live-list.tsx', component: 'LiveList' },
  standings: { file: 'src/widgets/standings-table.tsx', component: 'StandingsTable' },
  where_to_watch: { file: 'src/widgets/where-to-watch.tsx', component: 'WhereToWatch' },
};

const IMPORT_RE = /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)';\n/gm;
const USE_CLIENT_RE = /^'use client';\n+/;

function fail(message) {
  console.error(`embed-sources: ${message}`);
  process.exit(1);
}

/** Separa os imports nomeados do resto do arquivo. Só aceita `import { … } from '…'`. */
function splitImports(source, file) {
  const imports = [];
  const body = source.replace(USE_CLIENT_RE, '').replace(IMPORT_RE, (_, typeOnly, names, from) => {
    const specifiers = names
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (typeOnly && !s.startsWith('type ') ? `type ${s}` : s));
    imports.push({ from, specifiers });
    return '';
  });
  if (/^import\s/m.test(body)) fail(`${file}: use só imports nomeados de uma linha por origem (import { … } from '…').`);
  return { imports, body: body.trim() };
}

// ─── núcleo ──────────────────────────────────────────────────────────────────────────────────────

const model = splitImports(read('src/core/model.ts'), 'src/core/model.ts');
if (model.imports.length > 0) fail('src/core/model.ts não pode importar nada (vai embutido no galaxie-core).');

const react = splitImports(read('src/core/react.tsx'), 'src/core/react.tsx');
const reactSpecifiers = [];
for (const imp of react.imports) {
  if (imp.from === 'react') reactSpecifiers.push(...imp.specifiers);
  else if (imp.from !== './model.js') fail(`src/core/react.tsx: import inesperado de '${imp.from}'.`);
}

const coreBody = `${model.body}\n\n${react.body}\n`;
const coreVersion = createHash('sha256').update(coreBody).digest('hex').slice(0, 10);
const coreFile = [
  "'use client';",
  '',
  `// Galaxie Sports widgets · núcleo ${coreVersion}`,
  '// Instalado pelo registry shadcn do Galaxie Sports Builder. Compartilhado por todos os widgets Galaxie:',
  '// atualize reinstalando um widget (npx shadcn add …) em vez de editar à mão.',
  '',
  `import { ${reactSpecifiers.join(', ')} } from 'react';`,
  '',
  coreBody,
].join('\n');

// ─── widgets ─────────────────────────────────────────────────────────────────────────────────────

const widgets = {};
for (const [kind, { file, component }] of Object.entries(WIDGETS)) {
  const { imports, body } = splitImports(read(file), file);
  const core = [];
  const reactImports = [];
  for (const imp of imports) {
    if (imp.from === '../core/model.js' || imp.from === '../core/react.js') core.push(...imp.specifiers);
    else if (imp.from === 'react') reactImports.push(...imp.specifiers);
    else fail(`${file}: widgets só importam de 'react' e de ../core (import de '${imp.from}').`);
  }
  if (!body.includes(`export function ${component}(`)) fail(`${file}: não exporta a função ${component}.`);
  if (!body.includes(`export interface ${component}Props`)) fail(`${file}: não exporta ${component}Props.`);
  widgets[kind] = { file, component, propsType: `${component}Props`, coreImports: core, reactImports, body };
}

// ─── saída ───────────────────────────────────────────────────────────────────────────────────────

const out = `// Gerado por scripts/embed-sources.mjs a partir de src/core e src/widgets. Não edite à mão.
import type { WidgetKind } from '../core/model.js';

export interface EmbeddedWidget {
  /** Arquivo de origem no pacote. */
  file: string;
  component: string;
  propsType: string;
  coreImports: readonly string[];
  reactImports: readonly string[];
  body: string;
}

export const CORE_VERSION = ${JSON.stringify(coreVersion)};

export const CORE_FILE = ${JSON.stringify(coreFile)};

export const WIDGET_FILES: Record<WidgetKind, EmbeddedWidget> = ${JSON.stringify(widgets, null, 2)};
`;

const target = new URL('src/registry/sources.generated.ts', root);
if (!existsSync(target) || readFileSync(target, 'utf8') !== out) {
  writeFileSync(target, out);
  console.log(`embed-sources: src/registry/sources.generated.ts atualizado (núcleo ${coreVersion}).`);
}
