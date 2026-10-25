import { describe, expect, it } from 'vitest';
import { nextCronRuns } from './cron.js';
import { parseAgentUsdBudgets, SCHEDULED_JOBS, SETTINGS, scheduleKey, settingDef } from './registry.js';
import {
  applyOverrides,
  envReport,
  resolveAll,
  resolveSetting,
  runtimeBaseEnv,
  RUNTIME_BASE_ENV,
  validateSettingKey,
} from './resolve.js';

const def = (key: string) => {
  const d = settingDef(key);
  if (!d) throw new Error(`sem ${key}`);
  return d;
};

const env = (values: Record<string, string>) => (key: string) => values[key];

describe('precedência banco > env > padrão', () => {
  it('banco vence o env e o padrão', () => {
    const r = resolveSetting(def('LIVE_FEATURED'), {
      overrides: { LIVE_FEATURED: 'on' },
      env: env({ LIVE_FEATURED: 'off' }),
    });
    expect(r).toMatchObject({
      value: 'on',
      source: 'db',
      envValue: 'off',
      defaultValue: 'off',
      override: 'on',
    });
  });

  it('sem banco vale o env; sem env, o padrão do código', () => {
    const d = def('LIVE_FEATURED');
    expect(resolveSetting(d, { overrides: {}, env: env({ LIVE_FEATURED: 'auto' }) })).toMatchObject({
      value: 'auto',
      source: 'env',
    });
    expect(resolveSetting(d, { overrides: {}, env: env({}) })).toMatchObject({
      value: 'off',
      source: 'default',
    });
  });

  it('env vazio (o compose repassa `${X:-}`) conta como ausente', () => {
    const r = resolveSetting(def('APISPORTS_PLAN_FOOTBALL'), {
      overrides: {},
      env: env({ APISPORTS_PLAN_FOOTBALL: '' }),
    });
    expect(r).toMatchObject({ value: null, source: 'default', envValue: null });
  });

  it('sobrescrita inválida no banco é ignorada (cai no env) e marcada', () => {
    const r = resolveSetting(def('LIVE_FEATURED'), {
      overrides: { LIVE_FEATURED: 'sempre' },
      env: env({ LIVE_FEATURED: 'auto' }),
    });
    expect(r).toMatchObject({ value: 'auto', source: 'env', overrideInvalid: true });
  });

  it('sobrescrita vazia permitida (herdar o plano padrão) vale como banco', () => {
    const r = resolveSetting(def('APISPORTS_PLAN_FOOTBALL'), {
      overrides: { APISPORTS_PLAN_FOOTBALL: '' },
      env: env({ APISPORTS_PLAN_FOOTBALL: 'pro' }),
    });
    expect(r).toMatchObject({ value: null, source: 'db' });
  });

  it('segredos nunca leem o banco nem expõem valor', () => {
    const r = resolveSetting(def('OPENAI_API_KEY'), { overrides: { OPENAI_API_KEY: 'sk-x' }, env: env({}) });
    expect(r).toMatchObject({ source: 'default', override: null, value: null });
  });

  it('padrão do modelo de IA segue o provedor efetivo', () => {
    const all = resolveAll({ overrides: { AI_PROVIDER: 'anthropic' }, env: env({ AI_PROVIDER: 'openai' }) });
    const light = all.find((s) => s.key === 'AI_MODEL_LIGHT');
    expect(light).toMatchObject({ value: 'claude-haiku-5-5', source: 'default' });
    const viaEnv = resolveAll({ overrides: {}, env: env({ AI_MODEL_LIGHT: 'gpt-x' }) }).find(
      (s) => s.key === 'AI_MODEL_LIGHT',
    );
    expect(viaEnv).toMatchObject({ value: 'gpt-x', source: 'env', defaultValue: 'gpt-6-luna' });
  });
});

describe('validação por tipo', () => {
  it('cron: 5 campos válidos, normalizados; "off" e sinônimos desligam', () => {
    expect(validateSettingKey('SCHEDULE_QUOTA_STATUS', '  */30   *  * * * ')).toEqual({
      ok: true,
      value: '*/30 * * * *',
    });
    expect(validateSettingKey('SCHEDULE_QUOTA_STATUS', 'disabled')).toEqual({ ok: true, value: 'off' });
    expect(validateSettingKey('SCHEDULE_QUOTA_STATUS', 'OFF')).toEqual({ ok: true, value: 'off' });
    expect(validateSettingKey('SCHEDULE_QUOTA_STATUS', '61 * * * *')).toMatchObject({
      ok: false,
      error: { code: 'cron' },
    });
    expect(validateSettingKey('SCHEDULE_QUOTA_STATUS', '* * * *')).toMatchObject({
      ok: false,
      error: { code: 'cron' },
    });
    expect(validateSettingKey('SCHEDULE_QUOTA_STATUS', '0 0 * * * *')).toMatchObject({
      ok: false,
      error: { code: 'cron' },
    });
    expect(validateSettingKey('SCHEDULE_QUOTA_STATUS', '')).toMatchObject({
      ok: false,
      error: { code: 'required' },
    });
  });

  it('enum: só os valores do registro, sem diferenciar maiúsculas', () => {
    expect(validateSettingKey('LIVE_FEATURED', 'AUTO')).toEqual({ ok: true, value: 'auto' });
    expect(validateSettingKey('LIVE_FEATURED', 'sim')).toMatchObject({
      ok: false,
      error: { code: 'enum', values: ['off', 'auto', 'on'] },
    });
    expect(validateSettingKey('APISPORTS_PLAN', 'gold')).toMatchObject({
      ok: false,
      error: { code: 'enum' },
    });
  });

  it('número com faixa; inteiro recusa decimal', () => {
    expect(validateSettingKey('WTW_MIN_RELEVANCE', '72,5')).toEqual({ ok: true, value: '72.5' });
    expect(validateSettingKey('WTW_MIN_RELEVANCE', '101')).toMatchObject({
      ok: false,
      error: { code: 'range', min: 0, max: 100 },
    });
    expect(validateSettingKey('LIVE_IDLE_EXIT_MINUTES', '1.5')).toMatchObject({
      ok: false,
      error: { code: 'integer' },
    });
    expect(validateSettingKey('LIVE_IDLE_EXIT_MINUTES', '0')).toMatchObject({
      ok: false,
      error: { code: 'range' },
    });
    expect(validateSettingKey('LIVE_IDLE_EXIT_MINUTES', 'dez')).toMatchObject({
      ok: false,
      error: { code: 'integer' },
    });
  });

  it('"unlimited" (ou 0) só onde o serviço entende sem limite', () => {
    expect(validateSettingKey('AI_DAILY_TOKEN_BUDGET', '0')).toEqual({ ok: true, value: 'unlimited' });
    expect(validateSettingKey('AI_DAILY_TOKEN_BUDGET', 'Unlimited')).toEqual({
      ok: true,
      value: 'unlimited',
    });
    expect(validateSettingKey('AI_DAILY_TOKEN_BUDGET', '500')).toMatchObject({
      ok: false,
      error: { code: 'range' },
    });
    expect(validateSettingKey('YOUTUBE_DAILY_QUOTA', 'unlimited')).toMatchObject({
      ok: false,
      error: { code: 'integer' },
    });
  });

  it('orçamento de IA em US$, por agente e buscas por chamada', () => {
    expect(validateSettingKey('AI_DAILY_USD_BUDGET', '7,5')).toEqual({ ok: true, value: '7.5' });
    // 0 desliga a IA (como `agente=0`), não tira o teto; sem teto só com "unlimited"
    expect(validateSettingKey('AI_DAILY_USD_BUDGET', '0')).toEqual({ ok: true, value: '0' });
    expect(validateSettingKey('AI_DAILY_USD_BUDGET', '0,0')).toEqual({ ok: true, value: '0' });
    expect(validateSettingKey('AI_DAILY_USD_BUDGET', 'unlimited')).toEqual({ ok: true, value: 'unlimited' });
    expect(validateSettingKey('AI_DAILY_USD_BUDGET', '0.1')).toMatchObject({
      ok: false,
      error: { code: 'range' },
    });
    expect(validateSettingKey('AI_AGENT_USD_BUDGETS', 'lineups=2, wtw=3.5;context=1')).toMatchObject({
      ok: true,
    });
    expect(validateSettingKey('AI_AGENT_USD_BUDGETS', '')).toEqual({ ok: true, value: '' });
    expect(validateSettingKey('AI_AGENT_USD_BUDGETS', 'lineups:2')).toMatchObject({
      ok: false,
      error: { code: 'format' },
    });
    expect(parseAgentUsdBudgets('Lineups=2, wtw=0.5')).toEqual({ lineups: 2, wtw: 0.5 });
    expect(parseAgentUsdBudgets('lineups')).toBeNull();
    expect(validateSettingKey('AI_MAX_SEARCHES_PER_CALL', '8')).toEqual({ ok: true, value: '8' });
    expect(validateSettingKey('AI_MAX_SEARCHES_PER_CALL', 'unlimited')).toEqual({
      ok: true,
      value: 'unlimited',
    });
    expect(validateSettingKey('AI_MAX_SEARCHES_PER_CALL', '2.5')).toMatchObject({
      ok: false,
      error: { code: 'integer' },
    });
  });

  it('mercados: ISO2 suportados, sem repetição, na ordem do registro', () => {
    expect(validateSettingKey('WTW_MARKETS', 'ar, br;BR mx')).toEqual({ ok: true, value: 'BR,AR,MX' });
    expect(validateSettingKey('WTW_MARKETS', 'BR,US,XX')).toMatchObject({
      ok: false,
      error: { code: 'markets', values: ['US', 'XX'] },
    });
    expect(validateSettingKey('WTW_MARKETS', '')).toEqual({ ok: true, value: '' });
  });

  it('texto com formato (id de modelo)', () => {
    expect(validateSettingKey('AI_MODEL_LIGHT', 'gpt-6-luna')).toEqual({ ok: true, value: 'gpt-6-luna' });
    expect(validateSettingKey('AI_MODEL_LIGHT', 'rm -rf /; echo')).toMatchObject({
      ok: false,
      error: { code: 'format' },
    });
  });

  it('segredos e chaves fora do registro não são editáveis', () => {
    expect(validateSettingKey('OPENAI_API_KEY', 'sk-x')).toMatchObject({
      ok: false,
      error: { code: 'readonly' },
    });
    expect(validateSettingKey('NODE_OPTIONS', '--inspect')).toMatchObject({
      ok: false,
      error: { code: 'unknown' },
    });
  });

  it('todo padrão do registro passa na própria validação', () => {
    for (const s of SETTINGS)
      if (s.type !== 'secret' && s.default !== null)
        expect(validateSettingKey(s.key, s.default), s.key).toMatchObject({ ok: true });
  });
});

describe('aplicação das sobrescritas no env de um job', () => {
  it('só chaves do registro, só valores válidos, nunca segredos', () => {
    const {
      env: out,
      applied,
      rejected,
    } = applyOverrides(
      { LIVE_FEATURED: 'off', OPENAI_API_KEY: 'real' },
      {
        LIVE_FEATURED: 'on',
        SCHEDULE_SYNC_DAILY: 'nunca',
        OPENAI_API_KEY: 'roubada',
        NODE_OPTIONS: '--require x',
      },
    );
    expect(out.LIVE_FEATURED).toBe('on');
    expect(out.OPENAI_API_KEY).toBe('real');
    expect(out.NODE_OPTIONS).toBeUndefined();
    expect(out.SCHEDULE_SYNC_DAILY).toBeUndefined();
    expect(applied).toEqual(['LIVE_FEATURED']);
    expect(rejected.map((r) => r.key).sort()).toEqual([
      'NODE_OPTIONS',
      'OPENAI_API_KEY',
      'SCHEDULE_SYNC_DAILY',
    ]);
  });

  it('o job sabe desfazer as sobrescritas (voltar ao padrão no meio de um processo longo)', () => {
    const container = { LIVE_FEATURED: 'off', PATH: '/bin' };
    const { env: child } = applyOverrides(container, { LIVE_FEATURED: 'on', LIVE_PROTECT_DAILY: '40' });
    expect(child[RUNTIME_BASE_ENV]).toBe(JSON.stringify({ LIVE_FEATURED: 'off', LIVE_PROTECT_DAILY: null }));
    expect(runtimeBaseEnv(child)).toEqual(container);
    // reaplicar sobre o env já sobrescrito preserva o original do contêiner
    const again = applyOverrides(child, { LIVE_FEATURED: 'auto' }).env;
    expect(runtimeBaseEnv(again)).toEqual(container);
    // o banco não usa a variável para injetar segredos
    expect(
      runtimeBaseEnv({ [RUNTIME_BASE_ENV]: JSON.stringify({ OPENAI_API_KEY: 'x', NODE_OPTIONS: 'y' }) }),
    ).toEqual({});
  });
});

describe('relatório do env', () => {
  it('segredos só como configurado/não configurado', () => {
    const report = envReport('agents', {
      OPENAI_API_KEY: 'sk-segredo',
      AI_PROVIDER: 'openai',
      WTW_MARKETS: '',
    });
    expect(report.find((e) => e.key === 'OPENAI_API_KEY')).toEqual({
      key: 'OPENAI_API_KEY',
      value: null,
      configured: true,
    });
    expect(report.find((e) => e.key === 'ANTHROPIC_API_KEY')).toEqual({
      key: 'ANTHROPIC_API_KEY',
      value: null,
      configured: false,
    });
    expect(report.find((e) => e.key === 'AI_PROVIDER')).toEqual({
      key: 'AI_PROVIDER',
      value: 'openai',
      configured: true,
    });
    expect(report.find((e) => e.key === 'WTW_MARKETS')).toEqual({
      key: 'WTW_MARKETS',
      value: null,
      configured: false,
    });
    expect(JSON.stringify(report)).not.toContain('sk-segredo');
  });
});

describe('agenda', () => {
  it('cada job tem a sua variável SCHEDULE_* no registro', () => {
    for (const j of SCHEDULED_JOBS) expect(settingDef(scheduleKey(j.name))?.default).toBe(j.cron);
  });

  it('próximas execuções em UTC; nenhuma para "off" ou inválida', () => {
    const from = new Date('2026-10-22T10:07:00Z');
    expect(nextCronRuns('*/30 * * * *', 2, from).map((d) => d.toISOString())).toEqual([
      '2026-10-22T10:30:00.000Z',
      '2026-10-22T11:00:00.000Z',
    ]);
    expect(nextCronRuns('off', 2, from)).toEqual([]);
    expect(nextCronRuns('99 * * * *', 2, from)).toEqual([]);
  });
});
