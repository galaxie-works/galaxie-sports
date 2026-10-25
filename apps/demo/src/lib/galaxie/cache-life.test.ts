import { describe, expect, it } from 'vitest';

import { isLiveSeason, isRecentWindow } from './cache-life';

const now = new Date('2026-10-25T18:00:00Z');

describe('perfil de cache de placar e tabela', () => {
  it('temporada atual (ou a anterior, de uma 2025/26) em minutos; as passadas em horas', () => {
    expect(isLiveSeason(undefined, now)).toBe(true);
    expect(isLiveSeason(2026, now)).toBe(true);
    expect(isLiveSeason(2025, now)).toBe(true);
    expect(isLiveSeason(2024, now)).toBe(false);
  });

  it('janela de jogos que chega aos últimos 2 dias em minutos; a mais antiga em horas', () => {
    expect(isRecentWindow('2026-12-31', now)).toBe(true);
    expect(isRecentWindow('2026-10-24', now)).toBe(true);
    expect(isRecentWindow('2026-10-24T03:00:00Z', now)).toBe(true);
    expect(isRecentWindow('2026-10-20', now)).toBe(false);
    expect(isRecentWindow('data ruim', now)).toBe(true);
  });
});
