import { describe, expect, it } from 'vitest';

import {
  decodeStaffReason,
  encodeStaffReason,
  normalizeStaffReason,
  STAFF_REASON_TTL_S,
} from './staff-reason';

const SECRET = 'segredo-de-teste';
const T = '01a16029-0000-7000-8000-000000000001';
const NOW = 1_800_000_000;

describe('motivo da equipe (cookie assinado)', () => {
  it('codifica e lê de volta o motivo do tenant, dentro do prazo', () => {
    const value = encodeStaffReason(SECRET, { tenantId: T, reason: 'ticket 123' }, NOW);
    expect(decodeStaffReason(SECRET, value, T, NOW)).toEqual({
      tenantId: T,
      reason: 'ticket 123',
      exp: NOW + STAFF_REASON_TTL_S,
    });
    expect(decodeStaffReason(SECRET, value, T, NOW + STAFF_REASON_TTL_S - 1)).not.toBeNull();
  });

  it('vencido, de outro tenant, com outro segredo ou adulterado não vale', () => {
    const value = encodeStaffReason(SECRET, { tenantId: T, reason: 'ticket 123' }, NOW);
    expect(decodeStaffReason(SECRET, value, T, NOW + STAFF_REASON_TTL_S)).toBeNull();
    expect(decodeStaffReason(SECRET, value, '01a16029-0000-7000-8000-000000000002', NOW)).toBeNull();
    expect(decodeStaffReason('outro', value, T, NOW)).toBeNull();
    const [payload, sig] = value.split('.');
    const forged = `${Buffer.from(JSON.stringify({ tenantId: T, reason: 'x', exp: NOW + 10 })).toString('base64url')}.${sig}`;
    expect(decodeStaffReason(SECRET, forged, T, NOW)).toBeNull();
    expect(decodeStaffReason(SECRET, payload, T, NOW)).toBeNull();
    expect(decodeStaffReason(SECRET, undefined, T, NOW)).toBeNull();
    expect(decodeStaffReason(SECRET, '', T, NOW)).toBeNull();
  });

  it('o motivo precisa de 5 caracteres, aparado e sem espaços repetidos', () => {
    expect(normalizeStaffReason('  ticket   42 ')).toBe('ticket 42');
    expect(normalizeStaffReason('abcd')).toBeNull();
    expect(normalizeStaffReason('    ')).toBeNull();
    expect(normalizeStaffReason(42)).toBeNull();
    expect(normalizeStaffReason('a'.repeat(600))!.length).toBe(500);
  });
});
