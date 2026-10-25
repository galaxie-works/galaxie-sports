import { describe, expect, it } from 'vitest';

import { hasNearMatch, isActiveStandings, isActiveWindow } from './cache-life';

const now = new Date('2026-10-25T18:00:00Z');

describe('perfil de cache de placar e tabela', () => {
  it('janela de jogos em andamento (ou que acabou há menos de 2 dias) no cache curto', () => {
    expect(isActiveWindow('2026-04-01', '2026-12-10', now)).toBe(true);
    expect(isActiveWindow('2026-04-01', '2026-10-24', now)).toBe(true);
    expect(isActiveWindow('2026-10-26', '2027-03-01', now)).toBe(true);
    // temporada encerrada (Brasileirão 2025 lido em 2026) e a que ainda não começou: horas
    expect(isActiveWindow('2025-03-29', '2025-12-07', now)).toBe(false);
    expect(isActiveWindow('2027-02-01', '2027-11-30', now)).toBe(false);
    expect(isActiveWindow('data ruim', 'data ruim', now)).toBe(true);
  });

  it('tabela atualizada nas últimas 2 semanas está em andamento; a parada há meses, não', () => {
    expect(isActiveStandings('2026-10-19T22:10:00-03:00', now)).toBe(true);
    expect(isActiveStandings('2025-12-08T01:00:00-03:00', now)).toBe(false);
    expect(isActiveStandings(null, now)).toBe(false);
  });

  it('time com jogo perto: ao vivo, o próximo em até 2 dias ou o último há menos de 2 dias', () => {
    const base = { live_event: null, next_event: null, last_events: [] };
    expect(hasNearMatch(base, now)).toBe(false);
    expect(hasNearMatch({ ...base, live_event: {} }, now)).toBe(true);
    expect(hasNearMatch({ ...base, next_event: { starts_at: '2026-10-26T21:30:00-03:00' } }, now)).toBe(true);
    expect(hasNearMatch({ ...base, next_event: { starts_at: '2026-11-04T21:30:00-03:00' } }, now)).toBe(
      false,
    );
    expect(hasNearMatch({ ...base, last_events: [{ starts_at: '2026-10-24T16:00:00-03:00' }] }, now)).toBe(
      true,
    );
    expect(hasNearMatch({ ...base, last_events: [{ starts_at: '2026-10-12T16:00:00-03:00' }] }, now)).toBe(
      false,
    );
  });
});
