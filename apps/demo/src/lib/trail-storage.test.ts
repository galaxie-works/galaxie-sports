import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** sessionStorage de mentira (o teste roda em Node, sem `window`). */
function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    dump: () => Object.fromEntries(data),
  };
}

describe('trilha guardada na aba', () => {
  let storage: ReturnType<typeof fakeStorage>;

  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal('window', { sessionStorage: storage });
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('clearTrail (sair, novo login) apaga o que a próxima pessoa na aba veria', async () => {
    const trail = await import('./trail');
    trail.visitTrail({ path: '/ajustes/usuarios', label: 'Usuários', kind: 'ajustes' });
    trail.visitTrail({ path: '/ajustes/usuarios/u-1', label: 'Fulana de Tal', kind: 'ajustes' });
    expect(JSON.stringify(storage.dump())).toContain('Fulana de Tal');

    trail.clearTrail();
    expect(trail.getTrailSnapshot().entries).toEqual([]);
    expect(JSON.stringify(storage.dump())).not.toContain('Fulana de Tal');

    // a página recarregada (módulo novo) lê a aba de novo: nada da sessão anterior
    vi.resetModules();
    const reloaded = await import('./trail');
    expect(reloaded.getTrailSnapshot().entries).toEqual([]);
  });
});
