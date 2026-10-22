import { teamGradient, type TeamColors } from '@galaxie/contracts';
import type { AssetPalette } from '@galaxie/db';

/**
 * Paleta do escudo (core.asset.palette, extraída pelo espelho de mídia) → `colors` do Team.
 * null enquanto o escudo não foi espelhado/decodificado (a paleta é zerada se o escudo sai do storage).
 */
export function teamColors(palette: AssetPalette | null): TeamColors | null {
  if (!palette) return null;
  return {
    primary: palette.dominant,
    secondary: palette.secondary,
    monochrome: palette.monochrome,
    gradient: teamGradient(palette.dominant),
  };
}
