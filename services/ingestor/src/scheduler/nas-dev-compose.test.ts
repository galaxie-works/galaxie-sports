import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { settingDef } from '@galaxie/runtime-config';
import { envKey, scheduleFromEnv } from '@galaxie/scheduler';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DEFAULT_JOBS } from './schedule.js';

/**
 * Stack de dev do NAS (infra/nas-dev/compose.yml). Dev e produção dividem a conta da api-sports, a chave do YouTube
 * e o crédito de IA: um worker ligado por engano no dev gasta a cota da produção. Estes testes trancam o que a
 * stack promete (issue #534): subir do zero, sem nenhum ajuste, não chama api-sports, YouTube nem LLM.
 */
const composePath = fileURLToPath(new URL('../../../../infra/nas-dev/compose.yml', import.meta.url));
const envExamplePath = fileURLToPath(new URL('../../../../infra/nas-dev/env.example', import.meta.url));
const vpsComposePath = fileURLToPath(new URL('../../../../infra/vps-telemetry/compose.yml', import.meta.url));

interface Service {
  profiles?: string[];
  image?: string;
  command?: string[];
  pull_policy?: string;
  restart?: string;
  depends_on?: Record<string, { condition?: string }> | string[];
  environment?: Record<string, string>;
}
const compose = parse(readFileSync(composePath, 'utf8'), { merge: true }) as {
  services: Record<string, Service>;
};
const vps = parse(readFileSync(vpsComposePath, 'utf8'), { merge: true }) as {
  services: Record<string, Service>;
};

/** Os segredos da stack: sem padrão no compose (`${VAR:?}`), a stack não sobe sem eles. */
const SECRETS = ['POSTGRES_PASSWORD', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'];
/** O texto do compose sem as linhas de comentário (que citam `${VAR:?}` como exemplo); `$${VAR}` é do shell do contêiner. */
const composeSemComentarios = readFileSync(composePath, 'utf8')
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

/**
 * Como o Compose resolve `${VAR}`, `${VAR:-padrão}` e `${VAR:?mensagem}` com o ambiente dado (padrão: nada
 * definido; o `:?` sem valor vira vazio aqui, no Compose de verdade ele derruba a stack).
 */
function interpolate(value: string, env: Record<string, string> = {}): string {
  return value.replace(
    /\$\{([A-Z0-9_]+)(?::([-?])([^}]*))?\}/g,
    (_, name: string, op?: string, arg?: string) => {
      const v = env[name];
      if (v !== undefined && v !== '') return v;
      return op === '-' ? (arg ?? '') : '';
    },
  );
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
    expect(scheduleFromEnv(env, DEFAULT_JOBS).map((j) => j.name)).toEqual([]);
    for (const job of ['live-run', 'live-reconcile', 'events-clock']) expect(env[envKey(job)]).toBe('off');
  });

  // a agenda dos agentes (nenhum job ligado por padrão e uma SCHEDULE_ por job) é conferida em
  // services/ai-agents/src/scheduler/jobs.test.ts, que enxerga a lista deles
  it('cada job do ingestor tem a sua variável SCHEDULE_ na stack (job novo sem ela ficaria ligado)', () => {
    const declared = Object.keys(compose.services.ingestor?.environment ?? {}).filter((k) =>
      k.startsWith('SCHEDULE_'),
    );
    expect(declared.sort()).toEqual(DEFAULT_JOBS.map((j) => envKey(j.name)).sort());
  });

  it('ligar um job é só definir a variável com um cron', () => {
    const env = defaultEnv('ingestor', { SCHEDULE_NORMALIZE_SPORTS: '15 * * * *' });
    expect(scheduleFromEnv(env, DEFAULT_JOBS).map((j) => [j.name, j.cron])).toEqual([
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

  // ── stack a partir do git (#550, #552): o Portainer lê o compose da main e redeploya a cada commit ────────────────
  it('migrate sobe sem perfil, na tag main, com a imagem e o comando do migrate da produção', () => {
    const migrate = compose.services.migrate!;
    expect(migrate.profiles).toBeUndefined();
    expect(interpolate(migrate.image!)).toBe('ghcr.io/galaxie-works/galaxie-sports-api:main');
    expect(migrate.command).toEqual(vps.services.migrate?.command);
    // o mesmo nome de imagem da produção (-api), que só troca a tag por serviço
    expect(vps.services.migrate?.image).toMatch(/-api:\$\{TAG_API/);
    expect(migrate.pull_policy).toBe('always');
    expect(migrate.restart).toBe('no');
    expect(migrate.depends_on).toEqual({ postgres: { condition: 'service_healthy' } });
    const env = Object.fromEntries(
      Object.entries(migrate.environment ?? {}).map(([k, v]) => [k, interpolate(String(v))]),
    );
    expect(env.DATABASE_URL).toBe('postgres://galaxie:@postgres:5432/galaxie_sports');
    expect(env.DB_ROLES).toBe('off');
    expect(env).not.toHaveProperty('APP_ENV');
  });

  it('ingestor e agents acompanham a main (mesma tag do migrate) e só sobem depois dele', () => {
    for (const service of ['ingestor', 'agents'] as const) {
      expect(interpolate(compose.services[service]!.image!), service).toBe(
        'ghcr.io/galaxie-works/galaxie-sports-ingestor:main',
      );
      expect(compose.services[service]!.depends_on, service).toEqual({
        migrate: { condition: 'service_completed_successfully' },
      });
    }
    // uma tag de teste vale para os três de uma vez: o esquema acompanha os workers
    const env = { IMAGE_TAG: 'in-abc1234' };
    for (const service of ['migrate', 'ingestor', 'agents'])
      expect(interpolate(compose.services[service]!.image!, env), service).toMatch(/:in-abc1234$/);
  });

  it('variável sem segredo tem padrão; segredo é ${VAR:?} (a stack não sobe sem ele)', () => {
    const seen = new Set<string>();
    for (const m of composeSemComentarios.matchAll(/(?<!\$)\$\{([A-Z0-9_]+)(?::([-?])[^}]*)?\}/g)) {
      const [, name, op] = m as unknown as [string, string, string | undefined];
      seen.add(name);
      if (SECRETS.includes(name)) expect(op, `${name} é segredo: use \${${name}:?...}`).toBe('?');
      else expect(op, `${name} sem segredo: dê um padrão \${${name}:-...}`).toBe('-');
    }
    for (const secret of SECRETS) expect(seen.has(secret), secret).toBe(true);
  });

  it('o env.example declara toda variável obrigatória (sem padrão) do compose', () => {
    const example = readFileSync(envExamplePath, 'utf8');
    const required = new Set(
      [...composeSemComentarios.matchAll(/(?<!\$)\$\{([A-Z0-9_]+)(?::\?[^}]*)?\}/g)].map((m) => m[1]!),
    );
    expect(required.size).toBeGreaterThan(0);
    for (const name of required) expect(example, name).toMatch(new RegExp(`^${name}=`, 'm'));
    expect(/^IMAGE_TAG=main$/m.test(example)).toBe(true);
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
