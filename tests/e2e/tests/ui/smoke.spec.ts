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
    await page.goto('/client');
    await expect(page).toHaveURL(/\/client$/);
    await expect(page.getByText('Marca E2E').first()).toBeVisible();
  });
});
