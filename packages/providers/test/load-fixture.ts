import { readFileSync } from 'node:fs';

/** Lê um envelope real (recortado e anonimizado) de test/fixtures/api-sports/football. */
export function loadFootballFixture<T = { response: unknown[]; parameters: Record<string, string> }>(
  name: string,
): T {
  const url = new URL(`./fixtures/api-sports/football/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}
