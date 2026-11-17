/**
 * Fumaça da API: a chave secreta `gs_test_…` semeada autentica no `/v1` e a resposta é da marca de referência. Os
 * cenários de recusa (sem chave, chave revogada, estado do tenant, módulo) são da onda 1 (#1319).
 */
import { expect, test } from '@playwright/test';

import { API_URL, CLIENT_TENANT_SLUG, seeded } from '../../src/env.ts';

test('GET /v1/account com a chave semeada responde 200 com a marca de referência', async ({ request }) => {
  const res = await request.get(`${API_URL}/v1/account`, {
    headers: { 'x-galaxie-key': seeded('E2E_API_KEY') },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    tenant: { slug: string; plan: string; modules: string[] };
    key: { env: string };
  };
  expect(body.tenant.slug).toBe(CLIENT_TENANT_SLUG);
  expect(body.tenant.plan).toBe('fan_experience');
  expect(body.tenant.modules).toContain('core_data');
  expect(body.key.env).toBe('test');
});
