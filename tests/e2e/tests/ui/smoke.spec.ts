/**
 * Fumaça do harness (onda 0, #1317): a demo de produção abre, e as sessões gravadas pelo `setup` (login por código)
 * levam o admin a Ajustes e o cliente ao console da marca dele. Os cenários de verdade são das ondas 1 a 5.
 */
import { expect, test } from '@playwright/test';

import { ADMIN_STATE, CLIENT_STATE } from '../../src/env.ts';

test('a home pública abre sem login', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(page.locator('main')).toBeVisible();
});

test.describe('admin logado', () => {
  test.use({ storageState: ADMIN_STATE });

  test('vê Ajustes', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('cliente logado', () => {
  test.use({ storageState: CLIENT_STATE });

  test('vê o console da marca dele', async ({ page }) => {
    // Falha conhecida, achada por este teste: no build de produção o `/client` cai em "This page couldn't load" porque
    // a moldura do console (`components/client/client-area.tsx`, servidor) chama `sectionsForState` e `navRequirement`,
    // exportadas de `client-nav.tsx`, que é `'use client'` ("Attempted to call sectionsForState() from the server").
    // Quando a correção entrar, este teste passa a "passar inesperadamente" e o `test.fail` sai junto.
    test.fail(true, 'console do cliente quebra no servidor: sectionsForState vem de um módulo use client (#1346)');
    await page.goto('/client');
    await expect(page).toHaveURL(/\/client$/);
    await expect(page.getByText('Marca E2E').first()).toBeVisible();
  });
});
