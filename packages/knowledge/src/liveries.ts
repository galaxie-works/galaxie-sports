import type { LiveryEntry, LiveryEra } from './types.js';

/** Pintura do construtor (id do F1DB) na temporada, ou null quando a curadoria não cobre aquele ano. */
export function liveryFor(
  entries: readonly LiveryEntry[],
  constructorId: string,
  year: number,
): (LiveryEra & { constructor: string }) | null {
  const entry = entries.find((e) => e.slug === constructorId);
  const era = entry?.eras.find((e) => e.from <= year && (e.to === null || year <= e.to));
  return entry && era ? { ...era, constructor: entry.slug } : null;
}
