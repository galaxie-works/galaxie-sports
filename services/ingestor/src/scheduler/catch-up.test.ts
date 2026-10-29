import { describe, expect, it } from 'vitest';
import { missedSlots } from './catch-up.js';
import { DEFAULT_JOBS, type ScheduledJob } from './schedule.js';

const job = (name: string): ScheduledJob => DEFAULT_JOBS.find((j) => j.name === name)!;
const at = (iso: string) => new Date(iso);

describe('missedSlots', () => {
  it('deploy às 00:05 UTC: o sync diário que não chegou a rodar roda na volta', () => {
    const missed = missedSlots([job('sync-daily')], new Map([['sync-daily', at('2026-10-28T00:05:02Z')]]), {
      now: at('2026-10-29T00:09:00Z'),
    });
    expect(missed).toEqual([{ job: 'sync-daily', slot: at('2026-10-29T00:05:00Z') }]);
  });

  it('não duplica: execução iniciada no horário (ou logo antes, pela tolerância) conta', () => {
    const now = at('2026-10-29T00:30:00Z');
    expect(
      missedSlots([job('sync-daily')], new Map([['sync-daily', at('2026-10-29T00:05:01Z')]]), { now }),
    ).toEqual([]);
    expect(
      missedSlots([job('sync-daily')], new Map([['sync-daily', at('2026-10-29T00:04:30Z')]]), { now }),
    ).toEqual([]);
    // o catch-up de um reinício anterior também conta (está em ops.job_run)
    expect(
      missedSlots([job('sync-daily')], new Map([['sync-daily', at('2026-10-29T00:12:00Z')]]), { now }),
    ).toEqual([]);
  });

  it('job sem nenhuma execução registrada roda, se o horário está na janela', () => {
    expect(missedSlots([job('data-quality')], new Map(), { now: at('2026-10-29T05:00:00Z') })).toEqual([
      { job: 'data-quality', slot: at('2026-10-29T04:40:00Z') },
    ]);
  });

  it('horário mais velho que a janela não roda', () => {
    // bootstrap-catalog é semanal (segunda 03:15): na quinta, o de segunda passou da janela de 24 h
    expect(missedSlots([job('bootstrap-catalog')], new Map(), { now: at('2026-10-29T12:00:00Z') })).toEqual(
      [],
    );
    expect(
      missedSlots([job('bootstrap-catalog')], new Map(), {
        now: at('2026-10-29T12:00:00Z'),
        maxAgeMs: 4 * 24 * 3_600_000,
      }),
    ).toEqual([{ job: 'bootstrap-catalog', slot: at('2026-10-26T03:15:00Z') }]);
  });

  it('pula o ao vivo e os de cadência curta (se recuperam no horário seguinte)', () => {
    const now = at('2026-10-29T12:00:00Z');
    expect(
      missedSlots([job('live-run'), job('events-clock'), job('live-reconcile')], new Map(), { now }),
    ).toEqual([]);
    const every15: ScheduledJob = { ...job('quota-status'), name: 'x', cron: '*/15 * * * *' };
    expect(missedSlots([every15], new Map(), { now })).toEqual([]);
  });

  it('job de hora em hora: só o último horário conta', () => {
    expect(
      missedSlots([job('quota-status')], new Map([['quota-status', at('2026-10-29T10:05:00Z')]]), {
        now: at('2026-10-29T12:30:00Z'),
      }),
    ).toEqual([{ job: 'quota-status', slot: at('2026-10-29T12:05:00Z') }]);
  });
});
