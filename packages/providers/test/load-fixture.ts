import { readFileSync } from 'node:fs';

/** Lê um envelope real (recortado e anonimizado) de test/fixtures/api-sports/football. */
export function loadFootballFixture<T = { response: unknown[]; parameters: Record<string, string> }>(
  name: string,
): T {
  const url = new URL(`./fixtures/api-sports/football/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

/**
 * Lê um envelope de outro esporte (test/fixtures/api-sports/<esporte>): respostas reais capturadas,
 * recortadas para poucos itens (fonte: docs/research/api-sports-outros-esportes.md).
 */
export function loadSportFixture(
  sport: string,
  name: string,
): { get: string; parameters: Record<string, string>; response: unknown[] } {
  const url = new URL(`./fixtures/api-sports/${sport}/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as {
    get: string;
    parameters: Record<string, string>;
    response: unknown[];
  };
}
