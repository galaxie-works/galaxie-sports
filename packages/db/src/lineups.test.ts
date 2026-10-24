import { describe, expect, it } from 'vitest';
import {
  lineupSlug,
  lineupTargetId,
  LineupError,
  mergeSources,
  normalizeEmailDomains,
  normalizeSources,
  parseLineupTarget,
  platformSlug,
  reviewStatusesFor,
  sanitizeProposal,
  type LineupTarget,
} from './lineups.js';

const PLAN = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('slugs', () => {
  it('normaliza acento, caixa, + e símbolos', () => {
    expect(lineupSlug('Operadora Exemplo  Fútbol+ Total!')).toBe('operadora-exemplo-futbol-plus-total');
    expect(lineupSlug('Pacote & Esportes')).toBe('pacote-e-esportes');
    expect(platformSlug(' br ', 'Operadora Exemplo')).toBe('br-operadora-exemplo');
  });

  it('corta em 80 caracteres sem hífen no fim', () => {
    const s = lineupSlug(`${'a'.repeat(79)} b`);
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('alvos', () => {
  it('ida e volta do target_id', () => {
    const targets: LineupTarget[] = [
      { type: 'platform', id: PLAN },
      { type: 'plan', id: PLAN },
      { type: 'plan_channel', planId: PLAN, channelId: 'canal-exemplo' },
      { type: 'plan_service', planId: PLAN, serviceId: 'streaming-exemplo' },
    ];
    for (const t of targets) expect(parseLineupTarget(t.type, lineupTargetId(t))).toEqual(t);
  });

  it('rejeita tipo ou id malformado', () => {
    expect(() => parseLineupTarget('plan_channel', PLAN)).toThrow(LineupError);
    expect(() => parseLineupTarget('outro', PLAN)).toThrow(LineupError);
  });
});

describe('reviewStatusesFor', () => {
  it('padrão é só aprovado; rejeitado só quando pedido', () => {
    expect(reviewStatusesFor()).toEqual(['approved']);
    expect(reviewStatusesFor({ minReview: 'draft' })).toEqual(['draft', 'reviewed', 'approved']);
    expect(reviewStatusesFor({ minReview: 'reviewed', includeRejected: true })).toEqual([
      'reviewed',
      'approved',
      'rejected',
    ]);
  });
});

describe('fontes', () => {
  const seen = new Date('2026-10-24T12:00:00Z');

  it('aceita só URL http(s); fonte sem URL só se informada (operadora/editorial)', () => {
    const out = normalizeSources(
      [
        'https://operadora.exemplo/planos',
        'javascript:alert(1)',
        'nada',
        { url: null, seen_at: '', kind: 'operator', note: 'informado pela operadora', request_id: 'r1' },
        { url: null, seen_at: '' },
      ],
      seen,
    );
    expect(out.map((s) => s.url)).toEqual(['https://operadora.exemplo/planos', null]);
    expect(out[0]).toMatchObject({ kind: 'research', seen_at: seen.toISOString() });
  });

  it('junta por URL, guarda a vista mais recente e as mais novas primeiro', () => {
    const merged = mergeSources(
      [
        { url: 'https://a.exemplo/x', seen_at: '2026-01-01T00:00:00.000Z' },
        { url: 'https://b.exemplo/y', seen_at: '2026-02-01T00:00:00.000Z' },
      ],
      [{ url: 'https://a.exemplo/x', seen_at: '2026-10-01T00:00:00.000Z' }],
    );
    expect(merged).toEqual([
      { url: 'https://a.exemplo/x', seen_at: '2026-10-01T00:00:00.000Z' },
      { url: 'https://b.exemplo/y', seen_at: '2026-02-01T00:00:00.000Z' },
    ]);
  });
});

describe('sanitizeProposal', () => {
  it('fica só com os campos do tipo de item, normalizados', () => {
    expect(
      sanitizeProposal('plan', {
        name: '  Plano   Exemplo ',
        priceText: 'R$ 10',
        access: 'addon',
        validTo: '2026-12-31',
        hack: 1,
      }),
    ).toEqual({ name: 'Plano Exemplo', priceText: 'R$ 10', validTo: '2026-12-31' });
    expect(sanitizeProposal('plan_channel', { access: 'addon', name: 'x' })).toEqual({ access: 'addon' });
    expect(sanitizeProposal('platform', null)).toEqual({});
  });

  it('recusa valores inválidos', () => {
    expect(() => sanitizeProposal('plan_channel', { access: 'gratis' })).toThrow(LineupError);
    expect(() => sanitizeProposal('platform', { website: 'ftp://x' })).toThrow(LineupError);
    expect(() => sanitizeProposal('plan', { validFrom: '31/12/2026' })).toThrow(LineupError);
    expect(() => sanitizeProposal('platform', { kind: 'radio' })).toThrow(LineupError);
  });
});

describe('normalizeEmailDomains', () => {
  it('minúsculas, sem @ e sem repetição', () => {
    expect(
      normalizeEmailDomains([' @Operadora.Exemplo ', 'operadora.exemplo', 'tv.exemplo.com.br', '']),
    ).toEqual(['operadora.exemplo', 'tv.exemplo.com.br']);
  });

  it('recusa domínio inválido', () => {
    expect(() => normalizeEmailDomains(['não é domínio'])).toThrow(LineupError);
  });
});
