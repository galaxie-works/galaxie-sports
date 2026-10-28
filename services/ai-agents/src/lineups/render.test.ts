import { describe, expect, it } from 'vitest';
import type { HostResolver } from '@galaxie/net-guard';
import { requestGuard } from './render.js';

describe('requestGuard (navegador headless)', () => {
  let lookups = 0;
  const resolve: HostResolver = async (h) => {
    lookups++;
    if (h === 'plano.example') return [{ address: '93.184.216.34', family: 4 }];
    if (h === 'rebind.example') return [{ address: '172.30.50.1', family: 4 }];
    throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
  };

  it('recusa host interno, IP privado e metadados; aceita público e URLs locais do navegador', async () => {
    const allowed = requestGuard({ resolve });
    expect(await allowed('https://plano.example/grade')).toBe(true);
    expect(await allowed('wss://plano.example/socket')).toBe(true);
    expect(await allowed('http://rebind.example/')).toBe(false);
    expect(await allowed('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(await allowed('http://postgres:5432/')).toBe(false);
    expect(await allowed('http://localhost:3000/')).toBe(false);
    expect(await allowed('http://[::1]/')).toBe(false);
    expect(await allowed('https://u:p@plano.example/')).toBe(false);
    expect(await allowed('data:text/plain,oi')).toBe(true);
    expect(await allowed('nao é url')).toBe(false);
  });

  it('resolve cada host uma vez por leitura', async () => {
    lookups = 0;
    const allowed = requestGuard({ resolve });
    await allowed('https://plano.example/a');
    await allowed('https://plano.example/b');
    expect(lookups).toBe(1);
  });
});
