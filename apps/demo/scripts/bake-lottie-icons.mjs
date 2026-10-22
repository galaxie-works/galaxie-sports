#!/usr/bin/env node
/**
 * "Assa" os ícones animados (Lottie, estilo Lordicon) para o tema da demo:
 * - troca as expressions de cor/espessura (que apontam para a camada de controle) por valores fixos:
 *   contorno claro, destaque índigo da marca e traço mais grosso para tamanhos de sidebar (16–24 px);
 * - remove as expressions: o player "light" do lottie-web nunca executa código vindo do arquivo.
 *
 * Uso: node apps/demo/scripts/bake-lottie-icons.mjs "<pasta com os .json originais>"
 * Saída: apps/demo/src/components/sport/animated-icons/<esporte>.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../src/components/sport/animated-icons');

/** Arquivo original → esporte(s) da demo. */
const MAP = {
  'football.json': ['football'],
  'basketball.json': ['basketball'],
  'volleyball.json': ['volleyball'],
  'helmet.json': ['formula-1'],
  'wrestling.json': ['mma'],
  'goal (1).json': ['american-football'],
  'rugby-ball.json': ['rugby'],
  'baseball.json': ['baseball'],
  'ice-hockey.json': ['hockey'],
  'ball.json': ['handball'],
};

const rgba = (hex) => [...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), 1];
const BASE = rgba('#E6E8EC'); // contorno (sidebar-foreground)
const HIGHLIGHT = rgba('#6C69F2'); // destaque (primary)
const STROKE_FACTOR = 2.25; // 16 → 36 numa tela de 500: ~1,5 px a 20 px

function kind(expr) {
  const m = /effect\('([^']+)'\)/.exec(expr);
  if (!m) return null;
  if (m[1] === 'Base Color') return 'base';
  if (m[1] === 'Highlight') return 'highlight';
  if (m[1].startsWith('Stroke width')) return 'stroke';
  return null;
}

/** Aplica `fn` ao valor estático (`k` número/array) ou a cada keyframe (`s`). */
function mapValue(prop, fn) {
  if (Array.isArray(prop.k) && prop.k.length && typeof prop.k[0] === 'object') {
    for (const kf of prop.k) if (kf.s !== undefined) kf.s = fn(kf.s);
  } else {
    prop.k = fn(prop.k);
  }
}

function bake(node, stats) {
  if (Array.isArray(node)) return node.forEach((n) => bake(n, stats));
  if (!node || typeof node !== 'object') return;
  if (typeof node.x === 'string') {
    const k = kind(node.x);
    if (k === 'base') mapValue(node, () => BASE);
    else if (k === 'highlight') mapValue(node, () => HIGHLIGHT);
    else if (k === 'stroke')
      mapValue(node, (v) => (Array.isArray(v) ? v.map((n) => n * STROKE_FACTOR) : v * STROKE_FACTOR));
    else throw new Error(`expression desconhecida: ${node.x.slice(0, 120)}`);
    delete node.x;
    stats[k] = (stats[k] ?? 0) + 1;
  }
  // Cores fixas (sem expression) em preenchimentos e traços: preto vira o contorno claro e qualquer
  // cor de destaque vira índigo; branco (recortes internos) fica como está.
  if ((node.ty === 'fl' || node.ty === 'st') && node.c && !node.c.x) {
    mapValue(node.c, (v) => {
      if (!Array.isArray(v) || v.length < 3 || typeof v[0] !== 'number') return v;
      const [r, g, b] = v;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max < 0.2) return BASE;
      if (min > 0.9) return v;
      return HIGHLIGHT;
    });
    stats.static = (stats.static ?? 0) + 1;
  }
  for (const v of Object.values(node)) bake(v, stats);
}

const src = process.argv[2];
if (!src) {
  console.error('Uso: node bake-lottie-icons.mjs "<pasta com os .json originais>"');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
for (const [file, sports] of Object.entries(MAP)) {
  const data = JSON.parse(readFileSync(join(src, file), 'utf8'));
  const stats = {};
  bake(data, stats);
  const json = JSON.stringify(data);
  for (const sport of sports) writeFileSync(join(OUT, `${sport}.json`), json);
  console.log(`${file} → ${sports.join(', ')} (${json.length} bytes)`, stats);
}
