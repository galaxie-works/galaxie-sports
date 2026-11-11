import { SCHEDULED_JOBS, SETTINGS } from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';

import { groupJobs, jobArea, jobsWithArea } from './job-areas';
import { settingPage } from './setting-page';

describe('Agenda dos jobs agrupada por área (#1075)', () => {
  it('todo job do registro tem área', () => {
    expect(jobsWithArea().sort()).toEqual(SCHEDULED_JOBS.map((j) => j.name).sort());
  });

  it('os mesmos 30 ajustes continuam na Agenda', () => {
    const schedule = SETTINGS.filter((d) => settingPage(d.key)?.item === 'schedule');
    expect(schedule).toHaveLength(30);
    expect(schedule.filter((d) => d.job)).toHaveLength(SCHEDULED_JOBS.length);
  });

  it('grupos na ordem fixa, linhas em ordem alfabética e busca sem acento', () => {
    const rows = [
      { job: 'wtw-run', label: 'Onde assistir', key: 'SCHEDULE_WTW_RUN' },
      { job: 'live-run', label: 'Ao vivo', key: 'SCHEDULE_LIVE_RUN' },
      { job: 'recap-run', label: 'Crônica', key: 'SCHEDULE_RECAP_RUN' },
      { job: 'data-retention', label: 'Retenção', key: 'SCHEDULE_DATA_RETENTION' },
    ];
    const groups = groupJobs(rows);
    expect(groups.map((g) => g.area)).toEqual(['live', 'ai', 'maintenance']);
    expect(groups[1]!.rows.map((r) => r.label)).toEqual(['Crônica', 'Onde assistir']);
    expect(groupJobs(rows, 'cronica').flatMap((g) => g.rows.map((r) => r.job))).toEqual(['recap-run']);
    expect(groupJobs(rows, 'SCHEDULE_DATA').flatMap((g) => g.rows.map((r) => r.job))).toEqual([
      'data-retention',
    ]);
    expect(jobArea('job-novo')).toBe('maintenance');
  });
});
