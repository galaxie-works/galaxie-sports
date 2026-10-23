import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/**
 * config/assets/commons/destaques.yaml (ou PHOTO_HIGHLIGHTS_PATH): a foto de fundo do heading do piloto escolhida
 * pela curadoria, por id do F1DB → arquivo da Commons. Lido uma vez; sem o arquivo, nenhuma curadoria.
 */
let cached: Map<string, string> | undefined;

export function photoHighlights(): Map<string, string> {
  if (cached) return cached;
  const path =
    process.env.PHOTO_HIGHLIGHTS_PATH ??
    fileURLToPath(new URL('../../../../config/assets/commons/destaques.yaml', import.meta.url));
  const doc = existsSync(path)
    ? (parse(readFileSync(path, 'utf8')) as { drivers?: Record<string, unknown> } | null)
    : null;
  cached = new Map(
    Object.entries(doc?.drivers ?? {}).flatMap(([id, file]) =>
      typeof file === 'string' && file ? [[id, file] as const] : [],
    ),
  );
  return cached;
}
