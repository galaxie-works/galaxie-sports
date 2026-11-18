import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExploreSnapshot } from '@galaxie/explore';
import type { GeoConfig } from '@galaxie/geo';

const { loadExploreSnapshot, computeExploreSnapshot } = vi.hoisted(() => ({
  loadExploreSnapshot: vi.fn(),
  computeExploreSnapshot: vi.fn(),
}));

vi.mock('@galaxie/explore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@galaxie/explore')>()),
  loadExploreSnapshot,
  computeExploreSnapshot,
}));

const { exploreSnapshotFor } = await import('./summary.js');

const NOW = new Date('2026-11-17T18:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

const snapshot = (ageMs: number): ExploreSnapshot =>
  ({
    version: 1,
    generatedAt: new Date(NOW.getTime() - ageMs),
    window: { from: NOW, to: NOW },
    sports: {},
    countries: {},
    countrySports: {},
  }) as ExploreSnapshot;

const bctx = { db: {} as never, now: NOW };
const geo = {} as GeoConfig;

describe('exploreSnapshotFor', () => {
  const warn = vi.fn();
  const computed = snapshot(0);

  beforeEach(() => {
    loadExploreSnapshot.mockReset();
    computeExploreSnapshot.mockReset().mockResolvedValue(computed);
    warn.mockReset();
  });

  it('resumo em dia (até 30 min) serve sem aviso', async () => {
    const stored = snapshot(10 * MIN);
    loadExploreSnapshot.mockResolvedValue(stored);
    const r = await exploreSnapshotFor(bctx, geo, { warn });
    expect(r).toEqual({ snapshot: stored, source: 'precomputed' });
    expect(warn).not.toHaveBeenCalled();
    expect(computeExploreSnapshot).not.toHaveBeenCalled();
  });

  it('resumo com 2 h serve com aviso, sem calcular na requisição', async () => {
    const stored = snapshot(2 * HOUR);
    loadExploreSnapshot.mockResolvedValue(stored);
    const r = await exploreSnapshotFor(bctx, geo, { warn });
    expect(r).toEqual({ snapshot: stored, source: 'precomputed' });
    expect(computeExploreSnapshot).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      { age_seconds: 7200, generated_at: stored.generatedAt.toISOString() },
      expect.stringMatching(/mais de 30 min \(120 min; .*servindo assim mesmo/),
    );
  });

  it('sem resumo (ou de outra versão: a leitura devolve null) calcula na requisição', async () => {
    loadExploreSnapshot.mockResolvedValue(null);
    const r = await exploreSnapshotFor(bctx, geo, { warn });
    expect(r).toEqual({ snapshot: computed, source: 'computed' });
    expect(computeExploreSnapshot).toHaveBeenCalledWith(bctx.db, geo, NOW);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sem pré-cálculo'));
  });

  it('leitura que falha calcula na requisição', async () => {
    loadExploreSnapshot.mockRejectedValue(new Error('relation does not exist'));
    const r = await exploreSnapshotFor(bctx, geo, { warn });
    expect(r.source).toBe('computed');
    expect(computeExploreSnapshot).toHaveBeenCalledTimes(1);
  });

  it('acima do teto de 24 h calcula na requisição', async () => {
    loadExploreSnapshot.mockResolvedValue(snapshot(25 * HOUR));
    const r = await exploreSnapshotFor(bctx, geo, { warn });
    expect(r).toEqual({ snapshot: computed, source: 'computed' });
    expect(computeExploreSnapshot).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ age_seconds: 25 * 3600 }),
      expect.stringMatching(/mais de 24 h \(25 h; .*calculando na requisição/),
    );
  });

  it('exatamente no teto de 24 h ainda serve o pré-calculado', async () => {
    const stored = snapshot(24 * HOUR);
    loadExploreSnapshot.mockResolvedValue(stored);
    const r = await exploreSnapshotFor(bctx, geo, { warn });
    expect(r).toEqual({ snapshot: stored, source: 'precomputed' });
    expect(computeExploreSnapshot).not.toHaveBeenCalled();
  });
});
