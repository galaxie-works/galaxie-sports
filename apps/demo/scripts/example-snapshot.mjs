#!/usr/bin/env node
/**
 * Junta a gravação do exemplo público (`SHOWCASE_RECORD=<pasta>` no `next dev`, ver lib/galaxie/source.ts)
 * em `src/lib/example/snapshot.json`, a cópia que as páginas de /exemplo leem no lugar da API.
 *
 * - Ficam de fora as leituras que o exemplo não mostra (onde assistir e conteúdo relacionado).
 * - Saem os ids nos fornecedores (`external_ids`).
 * - Toda imagem (escudo, foto, bandeira, logo) é baixada para `public/exemplo/img/` e o endereço é
 *   reescrito: o exemplo não aponta para o bucket nem para fontes externas.
 *
 * Uso: node apps/demo/scripts/example-snapshot.mjs <pasta da gravação>
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../src/lib/example/snapshot.json');
const IMG_DIR = resolve(here, '../public/exemplo/img');
const IMG_URL = '/exemplo/img/';

/** Leituras que o exemplo não usa (nomes de emissoras, vídeos de terceiros). */
const SKIP = new Set(['getWhereToWatch', 'getRelated']);
const IMAGE = /\.(png|jpe?g|svg|webp|gif)(\?.*)?$/i;
/** Campos que não vão para fora: ids nos fornecedores de dados. */
const HIDDEN_FIELDS = new Set(['external_ids']);

const dir = process.argv[2];
if (!dir) {
  console.error('Uso: node scripts/example-snapshot.mjs <pasta da gravação>');
  process.exit(1);
}

const entries = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  .filter(({ key }) => !SKIP.has(key.slice(0, key.indexOf('('))))
  .sort((a, b) => a.key.localeCompare(b.key));

// imagens: coleta, baixa uma vez cada e reescreve
const urls = new Set();
const collect = (v) => {
  if (typeof v === 'string') {
    if (/^https?:\/\//.test(v) && IMAGE.test(v)) urls.add(v);
  } else if (Array.isArray(v)) v.forEach(collect);
  else if (v && typeof v === 'object') Object.values(v).forEach(collect);
};
entries.forEach((e) => collect(e.value));

mkdirSync(IMG_DIR, { recursive: true });
const local = new Map();
let failed = 0;
for (const url of urls) {
  const ext = extname(new URL(url).pathname).toLowerCase() || '.png';
  const name = `${createHash('sha1').update(url).digest('hex').slice(0, 16)}${ext}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    writeFileSync(join(IMG_DIR, name), Buffer.from(await res.arrayBuffer()));
    local.set(url, IMG_URL + name);
  } catch (err) {
    failed += 1;
    console.warn(`imagem não baixada (${err.message}): ${url}`);
  }
}

// sem a imagem local, o campo fica vazio: o app já mostra as iniciais no lugar
const rewrite = (v) => {
  if (typeof v === 'string') return /^https?:\/\//.test(v) && IMAGE.test(v) ? (local.get(v) ?? null) : v;
  if (Array.isArray(v)) return v.map(rewrite);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !HIDDEN_FIELDS.has(k))
        .map(([k, x]) => [k, rewrite(x)]),
    );
  return v;
};

// uma leitura por linha: diffs legíveis quando a cópia for regravada
const lines = entries.map(({ key, value }) => `${JSON.stringify(key)}: ${JSON.stringify(rewrite(value))}`);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `{\n${lines.join(',\n')}\n}\n`);
console.log(`${entries.length} leituras · ${local.size} imagens (${failed} falharam) → ${OUT}`);
