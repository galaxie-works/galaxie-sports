// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLocalStorage } from './use-local-storage';

function Probe({ storageKey }: { storageKey: string }) {
  const [value, set] = useLocalStorage(storageKey, 'padrao');
  return (
    <button type="button" onClick={() => set('local')}>
      {value}
    </button>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('useLocalStorage', () => {
  it('o que outra aba grava chega pelo evento storage, mesmo depois de gravar nesta', () => {
    render(<Probe storageKey="t:outra-aba" />);
    act(() => screen.getByRole('button').click());
    expect(screen.getByRole('button').textContent).toBe('local');
    act(() => {
      window.localStorage.setItem('t:outra-aba', 'de-outra-aba');
      window.dispatchEvent(new StorageEvent('storage', { key: 't:outra-aba' }));
    });
    expect(screen.getByRole('button').textContent).toBe('de-outra-aba');
  });

  it('sem armazenamento, a escolha vale nesta aba', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    render(<Probe storageKey="t:sem-armazenamento" />);
    expect(screen.getByRole('button').textContent).toBe('padrao');
    act(() => screen.getByRole('button').click());
    expect(screen.getByRole('button').textContent).toBe('local');
  });
});
