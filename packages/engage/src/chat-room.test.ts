import { describe, expect, it } from 'vitest';
import { canReadRoom, roomWindow, sendRefusal, sendRefusalNotice } from './chat-room.js';

const MIN = 60_000;
const start = Date.UTC(2026, 10, 15, 20, 0);
const base = {
  storedState: 'open' as const,
  event: { startsAt: start, endsAtExpected: start + 110 * MIN, status: 'scheduled' },
  openBeforeMinutes: 60,
  closeAfterMinutes: 30,
};

describe('roomWindow', () => {
  it('fechada antes da janela, aberta dentro dela', () => {
    expect(roomWindow({ ...base, now: start - 61 * MIN }).state).toBe('scheduled');
    expect(roomWindow({ ...base, now: start - 60 * MIN }).state).toBe('open');
    const w = roomWindow({ ...base, now: start });
    expect(w.opensAt).toBe(start - 60 * MIN);
    expect(w.closesAt).toBe(start + 140 * MIN);
  });

  it('encerra pelo fim real do jogo quando ele termina antes do previsto', () => {
    const event = { ...base.event, status: 'finished', updatedAt: start + 100 * MIN };
    expect(roomWindow({ ...base, event, now: start + 129 * MIN }).state).toBe('open');
    expect(roomWindow({ ...base, event, now: start + 130 * MIN }).state).toBe('closed');
  });

  it('jogo em andamento não fecha a sala, mesmo passando do previsto', () => {
    const event = { ...base.event, status: 'live', updatedAt: start + 200 * MIN };
    expect(roomWindow({ ...base, event, now: start + 139 * MIN }).state).toBe('open');
    expect(roomWindow({ ...base, event, now: start + 240 * MIN }).state).toBe('open');
  });

  it('terminado depois do previsto fecha pelo apito; o teto evita o updated_at tardio do espelho', () => {
    const late = { ...base.event, status: 'finished', updatedAt: start + 150 * MIN };
    expect(roomWindow({ ...base, event: late, now: start + 170 * MIN }).state).toBe('open');
    expect(roomWindow({ ...base, event: late, now: start + 181 * MIN }).state).toBe('closed');
    const touched = { ...base.event, status: 'finished', updatedAt: start + 48 * 60 * MIN };
    expect(roomWindow({ ...base, event: touched, now: start + 7 * 60 * MIN }).state).toBe('closed');
  });

  it('adiado fecha a sala dentro da janela', () => {
    const event = { ...base.event, status: 'postponed' };
    expect(roomWindow({ ...base, event, now: start - 10 * MIN }).state).toBe('closed');
    expect(roomWindow({ ...base, event, now: start - 90 * MIN }).state).toBe('scheduled');
  });

  it('o estado gravado vale dentro da janela', () => {
    expect(roomWindow({ ...base, storedState: 'frozen', now: start }).state).toBe('frozen');
    expect(roomWindow({ ...base, storedState: 'read_only_peak', now: start }).state).toBe('read_only_peak');
    expect(roomWindow({ ...base, storedState: 'frozen', now: start + 7 * 60 * MIN }).state).toBe('closed');
  });
});

describe('sendRefusal', () => {
  it('só 18plus escreve, e só em sala aberta', () => {
    expect(sendRefusal('open', '18plus')).toBeNull();
    expect(sendRefusal('open', '13_17')).toBe('age_band');
    expect(sendRefusal('open', 'under13')).toBe('age_band');
    expect(sendRefusal('frozen', '18plus')).toBe('room_frozen');
    expect(sendRefusal('closed', '18plus')).toBe('room_closed');
    expect(sendRefusal('scheduled', '18plus')).toBe('room_scheduled');
    expect(sendRefusal('read_only_peak', '18plus')).toBe('room_read_only_peak');
  });

  it('menor de 13 não lê', () => {
    expect(canReadRoom('under13')).toBe(false);
    expect(canReadRoom('13_17')).toBe(true);
    expect(canReadRoom(null)).toBe(true);
  });

  it('aviso no idioma do torcedor', () => {
    expect(sendRefusalNotice('age_band', 'es-AR')).toMatch(/mayores de 18/);
    expect(sendRefusalNotice('room_frozen', 'en')).toMatch(/froze/);
    expect(sendRefusalNotice('room_closed', 'fr')).toMatch(/encerrada/);
  });
});
