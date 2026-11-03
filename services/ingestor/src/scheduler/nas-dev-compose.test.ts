import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { settingDef } from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { AGENT_JOBS, DEFAULT_JOBS, envKey, jobsForProfile, scheduleFromEnv } from './schedule.js';

/**
 * Stack de dev do NAS (infra/nas-dev/compose.yml). Dev e produção dividem a conta da api-sports, a chave do YouTube
 * e o crédito de IA: um worker ligado por engano no dev gasta a cota da produção. Estes testes trancam o que a
 * stack promete (issue #534): subir do zero, sem nenhum ajuste, não chama api-sports, YouTube nem LLM.
 */
const composePath = fileURLToPath(new URL('../../../../infra/nas-dev/compose.yml', import.meta.url));
const envExamplePath = fileURLToPath(new URL('../../../../infra/nas-dev/env.example', import.meta.url));

interface Service {
  profiles?: string[];
  environment?: Record<string, string>;
}
const compose = parse(readFileSync(composePath, 'utf8'), { merge: true }) as {
  services: Record<string, Service>;
};

/** Como o Compose resolve `${VAR}` e `${VAR:-padrão}` com o ambiente dado (padrão: nada definido). */
function interpolate(value: string, env: Record<string, string> = {}): string {
  return value.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (_, name: string, dflt?: string) => {
    const v = env[name];
    return v !== undefined && v !== '' ? v : (dflt ?? '');
  });
}

/** Ambiente que o contêiner de um worker recebe numa subida do zero. */
function defaultEnv(
  service: 'ingestor' | 'agents',
  env: Record<string, string> = {},
): Record<string, string> {
  const raw = compose.services[service]?.environment ?? {};
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, interpolate(String(v), env)]));
}

describe('stack de dev do NAS (infra/nas-dev/compose.yml)', () => {
  it('ingestor e agents ficam no perfil workers: a stack nova não sobe worker nenhum', () => {
    expect(compose.services.ingestor?.profiles).toEqual(['workers']);
    expect(compose.services.agents?.profiles).toEqual(['workers']);
    for (const infra of ['postgres', 'valkey', 's3', 's3-init']) {
      expect(compose.services[infra], infra).toBeDefined();
      expect(compose.services[infra]?.profiles, infra).toBeUndefined();
    }
  });

  it('nenhum job do ingestor está agendado por padrão (inclusive o ao vivo)', () => {
    const env = defaultEnv('ingestor');
    expect(scheduleFromEnv(env, jobsForProfile('ingestor')).map((j) => j.name)).toEqual([]);
    for (const job of ['live-run', 'live-reconcile', 'events-clock']) expect(env[envKey(job)]).toBe('off');
  });

  it('nenhum job dos agentes está agendado por padrão', () => {
    const env = defaultEnv('agents');
    expect(scheduleFromEnv(env, jobsForProfile('agents')).map((j) => j.name)).toEqual([]);
  });

  it('cada job do código tem a sua variável SCHEDULE_ na stack (job novo sem ela ficaria ligado)', () => {
    const declared = (service: 'ingestor' | 'agents') =>
      Object.keys(compose.services[service]?.environment ?? {}).filter((k) => k.startsWith('SCHEDULE_'));
    expect(declared('ingestor').sort()).toEqual(DEFAULT_JOBS.map((j) => envKey(j.name)).sort());
    expect(declared('agents').sort()).toEqual(AGENT_JOBS.map((j) => envKey(j.name)).sort());
  });

  it('ligar um job é só definir a variável com um cron', () => {
    const env = defaultEnv('ingestor', { SCHEDULE_NORMALIZE_SPORTS: '15 * * * *' });
    expect(scheduleFromEnv(env, jobsForProfile('ingestor')).map((j) => [j.name, j.cron])).toEqual([
      ['normalize-sports', '15 * * * *'],
    ]);
  });

  it('IA desligada e YouTube desligado nos dois workers; nenhuma chave de fornecedor por padrão', () => {
    for (const service of ['ingestor', 'agents'] as const) {
      const env = defaultEnv(service);
      expect(env.AI_STATUS, service).toBe('off');
      for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'])
        expect(env[key], `${service} ${key}`).toBe('');
    }
    expect(defaultEnv('agents').YOUTUBE_SEARCH).toBe('off');
    expect(defaultEnv('agents').YOUTUBE_API_KEY).toBe('');
    // sem APISPORTS_KEY o ingestor roda em modo offline (só lê o raw espelhado)
    expect(defaultEnv('ingestor').APISPORTS_KEY).toBe('');
    expect(defaultEnv('agents').APISPORTS_KEY).toBeUndefined();
  });

  it('sem APP_ENV: o Governor trata o ambiente como dev e segura 70 % da conta', () => {
    for (const service of ['ingestor', 'agents'] as const)
      expect(compose.services[service]?.environment, service).not.toHaveProperty('APP_ENV');
  });

  it('cada serviço que gasta cota declara o orçamento do dev', () => {
    const agents = defaultEnv('agents');
    expect(agents.AI_DAILY_USD_BUDGET).toBe('0.5');
    expect(Number(agents.AI_DAILY_TOKEN_BUDGET)).toBeLessThanOrEqual(100_000);
    expect(Number(agents.AI_AGENT_DEFAULT_USD_BUDGET)).toBeLessThanOrEqual(0.05);
    expect(Number(agents.YOUTUBE_SEARCH_DAILY_QUOTA)).toBeLessThanOrEqual(5);
    expect(Number(agents.YOUTUBE_DAILY_QUOTA)).toBeLessThanOrEqual(200);
    expect(Number(defaultEnv('ingestor').APISPORTS_PER_MINUTE)).toBeLessThanOrEqual(10);
  });

  it('o teto por agente cobre todos os agentes do código e nunca passa do padrão', () => {
    const parseBudgets = (text: string) =>
      Object.fromEntries(text.split(',').map((p) => p.split('=') as [string, string]));
    const dev = parseBudgets(defaultEnv('agents').AI_AGENT_USD_BUDGETS!);
    const code = parseBudgets(settingDef('AI_AGENT_USD_BUDGETS')!.default!);
    expect(Object.keys(dev).sort()).toEqual(Object.keys(code).sort());
    for (const [agent, usd] of Object.entries(dev))
      expect(Number(usd), agent).toBeLessThanOrEqual(Number(code[agent]));
  });

  it('o env.example declara toda variável obrigatória (sem padrão) do compose', () => {
    const example = readFileSync(envExamplePath, 'utf8');
    const text = readFileSync(composePath, 'utf8');
    const required = new Set([...text.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]!));
    expect(required.size).toBeGreaterThan(0);
    for (const name of required) expect(example, name).toMatch(new RegExp(`^${name}=`, 'm'));
  });

  it('o env.example só traz valores desligados e baratos nos serviços que gastam cota', () => {
    const example = readFileSync(envExamplePath, 'utf8');
    const get = (name: string) => new RegExp(`^${name}=(.*)$`, 'm').exec(example)?.[1];
    expect(get('AI_STATUS')).toBe('off');
    expect(get('YOUTUBE_SEARCH')).toBe('off');
    expect(get('APISPORTS_KEY')).toBe('');
    expect(get('YOUTUBE_API_KEY')).toBe('');
    expect(get('COMPOSE_PROFILES')).toBe('');
  });
});
