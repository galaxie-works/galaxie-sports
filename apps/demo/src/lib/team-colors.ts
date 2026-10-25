/**
 * Cores de comparação entre dois times (confronto direto, barras de estatística): cada lado usa a cor
 * predominante do escudo, para quem lê saber de relance quem leva a melhor.
 *
 * - Escudo monocromático (preto/branco): cinza claro, para não sumir no fundo escuro.
 * - Cores parecidas (dois vermelhos): o visitante usa a secundária do escudo; sem secundária, uma
 *   versão mais clara da própria cor.
 * - Sem paleta (escudo ainda não espelhado): as cores de destaque do tema.
 */

export interface TeamColorsLike {
  primary: string;
  secondary: string | null;
  monochrome: boolean;
}

/** Cinza claro para escudos preto/branco (legível sobre o fundo escuro da demo). */
export const MONOCHROME_COLOR = '#d4d4d8';
/** Fallbacks do tema (primária índigo e info) quando o time não tem paleta. */
export const FALLBACK_COLORS: readonly [string, string] = ['var(--primary)', 'var(--info)'];

/** Distância mínima (RGB euclidiana, 0–441) para as duas cores não se confundirem na barra. */
const MIN_DISTANCE = 90;

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function distance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/** Mistura a cor com branco (0–1), para clarear mantendo o matiz. */
export function lighten(hex: string, amount: number): string {
  const mix = rgb(hex).map((c) => Math.round(c + (255 - c) * amount));
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function base(colors: TeamColorsLike): string {
  return colors.monochrome ? MONOCHROME_COLOR : colors.primary;
}

/** Cores [mandante, visitante] para comparar os dois times lado a lado. */
export function versusColors(
  home: TeamColorsLike | null | undefined,
  away: TeamColorsLike | null | undefined,
): [string, string] {
  if (!home || !away) return [home ? base(home) : FALLBACK_COLORS[0], away ? base(away) : FALLBACK_COLORS[1]];
  const a = base(home);
  let b = base(away);
  if (distance(a, b) < MIN_DISTANCE) {
    const alt = away.secondary && !away.monochrome ? away.secondary : null;
    b = alt && distance(a, alt) >= MIN_DISTANCE ? alt : lighten(b, 0.55);
  }
  return [a, b];
}

const DARK_TEXT = '#09090b';

/**
 * Cor do texto sobre a cor do time (pílula das estatísticas): branco ou preto, o que der mais contraste
 * (razão de contraste WCAG). Cor do tema (`var(--…)`, sem paleta): o texto do primário.
 */
export function contrastText(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return 'var(--primary-foreground)';
  const bg = luminance(color);
  const onWhite = 1.05 / (bg + 0.05);
  const onDark = (bg + 0.05) / (luminance(DARK_TEXT) + 0.05);
  return onDark > onWhite ? DARK_TEXT : '#ffffff';
}

/** Luminância relativa WCAG de uma cor `#rrggbb`. */
function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
