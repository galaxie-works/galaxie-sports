import { describe, expect, it } from 'vitest';
import { matchProvisional, type ProvisionalCandidate, type ProvisionalEventRow } from './match.js';

const at = (iso: string) => new Date(iso);
const row = (over: Partial<ProvisionalEventRow> = {}): ProvisionalEventRow => ({
  id: 'ev-final',
  competitionId: 'lib',
  seasonId: 'lib-2026',
  startsAt: at('2026-11-28T15:00:00Z'),
  participants: ['pal', 'est'],
  ...over,
});
const candidate = (over: Partial<ProvisionalCandidate> = {}): ProvisionalCandidate => ({
  providerId: '1500001',
  competitionId: 'lib',
  seasonId: 'lib-2026',
  startsAt: at('2026-11-28T20:00:00Z'),
  participants: ['pal', 'est'],
  ...over,
});

describe('junção do jogo provisório com o oficial', () => {
  it('casa mesma competição, temporada e participantes, com o horário definido depois', () => {
    expect(matchProvisional([candidate()], [row()])).toEqual(new Map([['1500001', 'ev-final']]));
  });

  it('casa com o mando invertido e com a data mudando até 2 dias', () => {
    const swapped = candidate({ participants: ['est', 'pal'], startsAt: at('2026-11-30T14:00:00Z') });
    expect(matchProvisional([swapped], [row()]).get('1500001')).toBe('ev-final');
  });

  it.each([
    ['data a mais de 2 dias', { startsAt: at('2026-11-30T16:00:01Z') }],
    ['outra temporada', { seasonId: 'lib-2025' }],
    ['outra competição', { competitionId: 'sula' }],
    ['outro adversário', { participants: ['pal', 'fla'] }],
    ['sem temporada', { seasonId: null }],
    ['um participante só', { participants: ['pal', 'pal'] }],
  ])('não casa: %s', (_name, over) => {
    expect(matchProvisional([candidate(over)], [row()]).size).toBe(0);
  });

  it('cada provisório é assumido por um jogo só: o de data mais próxima', () => {
    const far = candidate({ providerId: '1', startsAt: at('2026-11-29T20:00:00Z') });
    const near = candidate({ providerId: '2', startsAt: at('2026-11-28T21:00:00Z') });
    expect(matchProvisional([far, near], [row()])).toEqual(new Map([['2', 'ev-final']]));
  });
});
