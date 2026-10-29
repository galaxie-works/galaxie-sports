#!/usr/bin/env node
// Empacota o embed HTML (`src/embed/entry.ts` + React) num script só, para `<script src=".../embed.js">`.
//
// Saídas (depois do tsc, em dist/):
//   - dist/embed.js            o script, minificado (para conferir o tamanho ou servir como arquivo);
//   - dist/embed-script.js     `EMBED_SCRIPT` (o mesmo script como texto) e `EMBED_VERSION` (hash curto),
//                              que a rota `/embed.js` da demo serve sem depender do disco em produção.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const out = (path) => new URL(path, root);

const result = await build({
  entryPoints: [new URL('src/embed/entry.ts', root).pathname],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  jsx: 'automatic',
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  write: false,
});

const code = result.outputFiles[0].text;
const version = createHash('sha256').update(code).digest('hex').slice(0, 12);
const banner = `/*! Galaxie Sports embed ${version} */\n`;
const script = banner + code;

mkdirSync(out('dist'), { recursive: true });
writeFileSync(out('dist/embed.js'), script);
writeFileSync(
  out('dist/embed-script.js'),
  `// gerado por scripts/build-embed.mjs\nexport const EMBED_VERSION = ${JSON.stringify(version)};\nexport const EMBED_SCRIPT = ${JSON.stringify(script)};\n`,
);
writeFileSync(
  out('dist/embed-script.d.ts'),
  '/** Hash curto do script (ETag). */\nexport declare const EMBED_VERSION: string;\n/** O `embed.js` inteiro, como texto. */\nexport declare const EMBED_SCRIPT: string;\n',
);
console.log(`embed.js: ${(script.length / 1024).toFixed(1)} KB (${version})`);
