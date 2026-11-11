// @vitest-environment happy-dom
import { DEFAULT_MODERATION_CONFIG } from '@galaxie/cosmos/moderation-rules';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/client';
import { clientDictionary } from '@/lib/i18n/dictionary';
import type { CosmosModerationData } from '@/lib/cosmos/moderation-data';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const save = vi.fn();
vi.mock('@/lib/cosmos/moderation-actions', () => ({
  saveCosmosModeration: (...a: unknown[]) => save(...a),
  removeCosmosModerationOverride: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CosmosModeration } from './cosmos-moderation';

afterEach(cleanup);
beforeEach(() => {
  save.mockReset();
  refresh.mockReset();
});

const T = clientDictionary('pt-BR').cosmos.moderation;

const data = (patch: Partial<CosmosModerationData> = {}): CosmosModerationData => ({
  config: DEFAULT_MODERATION_CONFIG,
  version: 0,
  ceiling: { hide: 'auto', mute: 'notify', muteHours: 24 },
  overrides: [],
  history: [],
  ...patch,
});

const view = (d: CosmosModerationData, canEdit = true) =>
  render(
    <I18nProvider locale="pt-BR" messages={clientDictionary('pt-BR')}>
      <CosmosModeration data={d} canEdit={canEdit} />
    </I18nProvider>,
  );

describe('aba Moderação da Cosmos (#997)', () => {
  it('suspender e banir aparecem como "pede pessoa", sem degraus para escolher', () => {
    view(data());
    expect(screen.getAllByText(T.needsPerson)).toHaveLength(2);
    expect(screen.queryByRole('group', { name: T.actions.ban })).toBeNull();
    expect(screen.getByRole('group', { name: T.actions.hide })).toBeTruthy();
  });

  it('degrau acima do teto da Galaxie fica desabilitado', () => {
    view(data());
    const mute = screen.getByRole('group', { name: T.actions.mute });
    const auto = [...mute.querySelectorAll('button')].find((b) => b.textContent === T.steps.auto)!;
    expect(auto.hasAttribute('disabled') || auto.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('sem mudança o Salvar fica desligado; ao ligar um recurso, salva com a versão aberta', async () => {
    save.mockResolvedValue({ ok: true, version: 4 });
    view(data({ version: 3 }));
    const button = screen.getByRole('button', { name: T.save });
    expect(button.hasAttribute('disabled')).toBe(true);
    act(() => screen.getByRole('switch', { name: T.features.live_chat.title }).click());
    expect(button.hasAttribute('disabled')).toBe(false);
    await act(async () => button.click());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ features: expect.objectContaining({ live_chat: true }) }),
      3,
    );
  });

  it('só leitura: aviso, sem Salvar e com os recursos travados', () => {
    view(data(), false);
    expect(screen.getByText(T.readOnly)).toBeTruthy();
    expect(screen.queryByRole('button', { name: T.save })).toBeNull();
    const sw = screen.getByRole('switch', { name: T.features.live_chat.title });
    expect(sw.hasAttribute('disabled') || sw.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('apostas e menores aparecem travadas no máximo', () => {
    view(data());
    expect(screen.getByText(T.categories.betting)).toBeTruthy();
    expect(screen.getAllByText(T.locked)).toHaveLength(2);
  });
});
