/**
 * Cores de um escudo em SVG sem rasterizar (o ingestor não tem renderizador de SVG): lê as cores de
 * preenchimento das formas, dá a cada uma um peso aproximado pela área (ou pelo tamanho do traçado,
 * quando a área não é calculável) e entrega o resultado ao mesmo `computePalette` dos PNG, como se
 * fossem pixels. Quando o acervo traz o PNG junto do SVG, a paleta sai do PNG (mais fiel).
 */
import { computePalette, type AssetPalette } from '../palette.js';

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  navy: '#000080',
  gold: '#ffd700',
  orange: '#ffa500',
  purple: '#800080',
  maroon: '#800000',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  darkgreen: '#006400',
  darkblue: '#00008b',
  darkred: '#8b0000',
  skyblue: '#87ceeb',
  royalblue: '#4169e1',
  crimson: '#dc143c',
};

/** "#abc", "#aabbcc", "rgb(…)" ou nome CSS → [r, g, b]; null para none, url(#gradiente) e desconhecidos. */
export function parseColor(value: string | undefined): [number, number, number] | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)));
    return [r!, g!, b!];
  }
  return NAMED[v] ? parseColor(NAMED[v]) : null;
}

const SHAPE_RE = /<(path|rect|circle|ellipse|polygon|polyline)\b([^>]*)>/gi;

function attr(attrs: string, name: string): string | undefined {
  const direct = new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs)?.[1];
  if (direct !== undefined) return direct;
  const style = /(?:^|\s)style\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
  return style ? new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(style)?.[1]?.trim() : undefined;
}

const num = (attrs: string, name: string) => Number(attr(attrs, name) ?? NaN);

/** Peso aproximado da forma: área quando dá para calcular; senão, o tamanho dos dados do traçado. */
function shapeWeight(tag: string, attrs: string): number {
  switch (tag.toLowerCase()) {
    case 'rect': {
      const area = num(attrs, 'width') * num(attrs, 'height');
      return Number.isFinite(area) && area > 0 ? area : 1;
    }
    case 'circle': {
      const r = num(attrs, 'r');
      return Number.isFinite(r) && r > 0 ? Math.PI * r * r : 1;
    }
    case 'ellipse': {
      const area = Math.PI * num(attrs, 'rx') * num(attrs, 'ry');
      return Number.isFinite(area) && area > 0 ? area : 1;
    }
    default: {
      const data = attr(attrs, 'd') ?? attr(attrs, 'points') ?? '';
      return Math.max(1, polygonArea(data) || data.length);
    }
  }
}

/** Área (fórmula do laço) dos números do traçado lidos como pares x,y — boa para M/L absolutos e polígonos. */
function polygonArea(data: string): number {
  if (/[a-z]/.test(data.replace(/e-?\d/gi, ''))) return 0; // comandos relativos/curvas: sem área confiável
  const n = data.match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number) ?? [];
  if (n.length < 6) return 0;
  let sum = 0;
  for (let i = 0; i + 3 < n.length; i += 2) sum += n[i]! * n[i + 3]! - n[i + 2]! * n[i + 1]!;
  sum += n[n.length - 2]! * n[1]! - n[0]! * n[n.length - 1]!;
  return Math.abs(sum) / 2;
}

/** Teto de "pixels" sintéticos: a paleta só precisa da proporção entre as cores. */
const SAMPLE = 20_000;

/** Paleta de um SVG pelas cores de preenchimento; null quando não há nenhuma cor sólida. */
export function paletteFromSvg(body: Uint8Array | string): AssetPalette | null {
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  const weights = new Map<string, number>();
  for (const m of text.matchAll(SHAPE_RE)) {
    const attrs = m[2] ?? '';
    const fill = attr(attrs, 'fill');
    // sem fill o padrão do SVG é preto
    const rgb = fill === undefined ? ([0, 0, 0] as const) : parseColor(fill);
    if (!rgb) continue;
    const opacity = Number(attr(attrs, 'fill-opacity') ?? attr(attrs, 'opacity') ?? 1);
    if (Number.isFinite(opacity) && opacity < 0.5) continue;
    const key = rgb.join(',');
    weights.set(key, (weights.get(key) ?? 0) + shapeWeight(m[1]!, attrs));
  }
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  if (!total) return null;
  const counts = [...weights].map(
    ([key, w]) => [key, Math.max(1, Math.round((w / total) * SAMPLE))] as const,
  );
  const pixels = counts.reduce((a, [, c]) => a + c, 0);
  const rgba = new Uint8Array(pixels * 4);
  let p = 0;
  for (const [key, count] of counts) {
    const [r, g, b] = key.split(',').map(Number) as [number, number, number];
    for (let i = 0; i < count; i++, p += 4) rgba.set([r, g, b, 255], p);
  }
  return computePalette(rgba, pixels, 1);
}
