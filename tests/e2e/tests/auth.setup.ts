/**
 * Projeto `setup`: login de verdade de cada papel, uma vez por execução, e as sessões em `.auth/` para os outros testes.
 *
 * 1. O admin (primeiro admin da demo, `DEMO_ADMIN_EMAIL`) entra pelo código lido no Mailpit e cai em Ajustes.
 * 2. Com a sessão dele, cria o cliente de referência pela rota de admin do Better Auth (a mesma do convite do painel):
 *    papel `client`, preso à marca semeada; no primeiro acesso a demo faz dele Dono da marca.
 * 3. O cliente entra pelo código e cai no console.
 */
import { expect, test as setup } from '@playwright/test';

import { ADMIN_EMAIL, ADMIN_STATE, CLIENT_EMAIL, CLIENT_STATE, DEMO_URL, seeded } from '../src/env.ts';
import { loginWithCode } from '../src/login.ts';

setup.describe.configure({ mode: 'serial' });

setup('admin entra pelo código e chega em Ajustes', async ({ page, request }) => {
  await loginWithCode(page, request, ADMIN_EMAIL, '/settings');
  await page.context().storageState({ path: ADMIN_STATE });

  const res = await page.request.post('/api/auth/admin/create-user', {
    // o Better Auth confere a origem das chamadas com cookie de sessão
    headers: { origin: DEMO_URL },
    data: {
      email: CLIENT_EMAIL,
      name: 'Cliente E2E',
      role: 'client',
      data: { tenantId: seeded('E2E_CLIENT_TENANT_ID') },
    },
  });
  // numa nova tentativa (retry do CI) o cliente já existe
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  expect(res.ok() || body.code === 'USER_ALREADY_EXISTS', `criar o cliente respondeu ${res.status()}`).toBe(
    true,
  );
});

setup('cliente entra pelo código e chega no console', async ({ page, request }) => {
  await loginWithCode(page, request, CLIENT_EMAIL, '/client');
  await page.context().storageState({ path: CLIENT_STATE });
});
