import { existsSync } from 'node:fs';
import { SCHEDULED_JOBS, scheduleKey } from '@galaxie/runtime-config';
import { envKey, scheduleFromEnv as scheduleJobs } from '@galaxie/scheduler';
import { describe, expect, it } from 'vitest';
import { AGENT_JOBS } from './jobs.js';

/** A agenda dos agentes com as sobrescritas do ambiente. */
const scheduleFromEnv = (env: NodeJS.ProcessEnv) => scheduleJobs(env, AGENT_JOBS);

describe('agenda dos agentes de IA', () => {
  it('só os agentes de IA, na ordem da agenda', () => {
    const jobs = scheduleFromEnv({ SCHEDULE_CONTEXT_RUN: 'off' });
    expect(jobs.map((j) => j.name)).toEqual([
      'recap-run',
      'wtw-run',
      'wtw-channel',
      'related-run',
      'wtw-rights',
      'review-suggestions',
      'lineups-revisit',
      'lineups-pages',
      'channel-lists',
    ]);
  });

  it('revisita a grade de canais e ofertas uma vez por semana, com teto de pesquisas por execução', () => {
    const job = scheduleFromEnv({}).find((j) => j.name === 'lineups-revisit')!;
    expect(job).toMatchObject({
      cron: '50 4 * * 1',
      script: 'dist/cli/lineups-research.js',
      args: ['--revisitar', '--dias', '30', '--max', '4', '--max-paginas', '10'],
    });
    expect(scheduleFromEnv({ SCHEDULE_LINEUPS_REVISIT: 'off' })).not.toContainEqual(
      expect.objectContaining({ name: 'lineups-revisit' }),
    );
  });

  it('confirma a grade pela página oficial uma vez por dia, depois da revisita', () => {
    const job = scheduleFromEnv({}).find((j) => j.name === 'lineups-pages')!;
    expect(job).toMatchObject({
      cron: '20 5 * * *',
      script: 'dist/cli/lineups-pages.js',
      args: ['--max-paginas', '20'],
    });
    expect(scheduleFromEnv({ SCHEDULE_LINEUPS_PAGES: 'off' })).not.toContainEqual(
      expect.objectContaining({ name: 'lineups-pages' }),
    );
  });

  it('confere as sobras das listas de canais a cada 10 min, repetindo as que falharam', () => {
    const job = scheduleFromEnv({}).find((j) => j.name === 'channel-lists')!;
    expect(job).toMatchObject({
      cron: '*/10 * * * *',
      script: 'dist/cli/channel-lists.js',
      args: ['--max', '10', '--repetir-falhas'],
    });
  });

  it('cada job aponta para um CLI que existe no pacote (dist/cli/x.js ← src/cli/x.ts)', () => {
    for (const job of AGENT_JOBS) {
      const match = /^dist\/cli\/([a-z0-9-]+)\.js$/.exec(job.script);
      expect(match, `${job.name}: ${job.script}`).not.toBeNull();
      expect(existsSync(new URL(`../cli/${match![1]}.ts`, import.meta.url)), job.script).toBe(true);
    }
  });

  it('o registro do painel de Operação (@galaxie/runtime-config) tem a mesma agenda padrão e o mesmo perfil', () => {
    const fromCode = AGENT_JOBS.map((j) => ({ name: j.name, service: 'agents', cron: j.cron }));
    expect(
      SCHEDULED_JOBS.filter((j) => j.service === 'agents').map(({ name, service, cron }) => ({
        name,
        service,
        cron,
      })),
    ).toEqual(fromCode);
    for (const j of fromCode) expect(scheduleKey(j.name)).toBe(envKey(j.name));
  });
});
