import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Gauge, Registry } from 'prom-client';
import { afterEach, describe, expect, it } from 'vitest';
import { bearerMatches, registerBuildInfo, startOpsServer, versionInfo } from './version.js';

describe('versionInfo', () => {
  it('traz o hash da imagem gravado no build', () => {
    const info = versionInfo('api', { GALAXIE_IMAGE_HASH: 'in-abc' });
    expect(info).toMatchObject({ service: 'api', image_hash: 'in-abc', node: process.version });
    expect(new Date(info.started_at).getTime()).not.toBeNaN();
  });

  it('fora de imagem é dev', () => {
    expect(versionInfo('api', {}).image_hash).toBe('dev');
  });
});

describe('registerBuildInfo', () => {
  it('expõe build_info com serviço e hash', async () => {
    const registry = new Registry();
    registerBuildInfo(registry, 'webhooks', { GALAXIE_IMAGE_HASH: 'in-abc' });
    expect(await registry.metrics()).toContain('build_info{service="webhooks",image_hash="in-abc"} 1');
  });
});

describe('bearerMatches', () => {
  it('compara o token com e sem o prefixo', () => {
    expect(bearerMatches('Bearer segredo', 'segredo')).toBe(true);
    expect(bearerMatches('Bearer outro12', 'segredo')).toBe(false);
    expect(bearerMatches(undefined, 'segredo')).toBe(false);
  });
});

describe('startOpsServer', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  const start = async (env: NodeJS.ProcessEnv, register?: (registry: Registry) => void) => {
    server = startOpsServer({ service: 'ingestor', port: 0, env, ...(register ? { register } : {}) });
    const running = server;
    await new Promise((resolve) => running.once('listening', resolve));
    return `http://127.0.0.1:${(running.address() as AddressInfo).port}`;
  };

  it('responde /health e /version sem autenticação', async () => {
    const url = await start({ GALAXIE_IMAGE_HASH: 'in-abc', METRICS_TOKEN: 'segredo' });
    expect(await (await fetch(`${url}/health`)).json()).toEqual({ status: 'ok', service: 'ingestor' });
    expect(await (await fetch(`${url}/version`)).json()).toMatchObject({
      service: 'ingestor',
      image_hash: 'in-abc',
    });
  });

  it('/metrics exige o token quando há METRICS_TOKEN', async () => {
    const url = await start({ GALAXIE_IMAGE_HASH: 'in-abc', METRICS_TOKEN: 'segredo' });
    expect((await fetch(`${url}/metrics`)).status).toBe(401);
    const res = await fetch(`${url}/metrics`, { headers: { authorization: 'Bearer segredo' } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('build_info{service="ingestor",image_hash="in-abc"} 1');
    expect(body).toContain('process_start_time_seconds');
  });

  it('as métricas do próprio serviço entram no /metrics junto com as do processo', async () => {
    const url = await start({}, (registry) => {
      new Gauge({ name: 'live_window_open', help: 'x', registers: [registry] }).set(1);
    });
    const body = await (await fetch(`${url}/metrics`)).text();
    expect(body).toContain('live_window_open 1');
    expect(body).toContain('build_info{service="ingestor"');
  });

  it('o /health leva o estado que o serviço informa', async () => {
    server = startOpsServer({
      service: 'worker',
      port: 0,
      env: {},
      health: () => ({ idle: false, task: { id: 't1', type: 'exemplo.eco' } }),
    });
    const running = server;
    await new Promise((resolve) => running.once('listening', resolve));
    const url = `http://127.0.0.1:${(running.address() as AddressInfo).port}`;
    expect(await (await fetch(`${url}/health`)).json()).toEqual({
      status: 'ok',
      service: 'worker',
      idle: false,
      task: { id: 't1', type: 'exemplo.eco' },
    });
  });

  it('caminho desconhecido é 404 e método diferente de GET é 405', async () => {
    const url = await start({});
    expect((await fetch(`${url}/x`)).status).toBe(404);
    expect((await fetch(`${url}/health`, { method: 'POST' })).status).toBe(405);
  });
});
