import { describe, expect, it } from 'vitest';

import { exampleIds } from './pages';
import data from './snapshot.json';

const SNAPSHOT = data as Record<string, unknown>;
const keys = Object.keys(SNAPSHOT);
const text = JSON.stringify(SNAPSHOT);

describe('cópia gravada do exemplo público', () => {
  it('tem as leituras principais das quatro páginas de cada versão', () => {
    for (const locale of ['pt-BR', 'es-AR'] as const) {
      const ids = exampleIds(locale);
      expect(keys.some((k) => k.startsWith(`getEvent("${ids.match}",`))).toBe(true);
      expect(keys.some((k) => k.startsWith(`getTeamOverview("${ids.team}",`))).toBe(true);
      expect(keys.some((k) => k.startsWith(`getCompetition("${ids.competition}",`))).toBe(true);
      expect(keys.some((k) => k.startsWith(`getPersonOverview("${ids.player}",`))).toBe(true);
    }
  });

  it('não leva onde assistir nem conteúdo relacionado', () => {
    expect(keys.filter((k) => /^(getWhereToWatch|getRelated)\(/.test(k))).toEqual([]);
  });

  it('não aponta para o bucket, a rede interna ou o fornecedor de dados', () => {
    expect(text).not.toMatch(/192\.168\.|localhost|api-sports|external_ids/);
  });

  it('as imagens são do próprio site (/example/img)', () => {
    const images = text.match(/"[^"]+\.(png|jpe?g|svg|webp|gif)"/gi) ?? [];
    expect(images.length).toBeGreaterThan(50);
    expect(images.filter((i) => !i.startsWith('"/example/img/'))).toEqual([]);
  });
});
