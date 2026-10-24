import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logoDecision, parseCompetitionLogos } from './competition-logos.js';

describe('lista de logos de competição', () => {
  it('a lista versionada é válida e tem a F1', () => {
    const file = join(
      import.meta.dirname,
      '..',
      '..',
      '..',
      '..',
      'config',
      'assets',
      'commons',
      'competition-logos.yaml',
    );
    const entries = parseCompetitionLogos(readFileSync(file, 'utf8'));
    expect(entries).toContainEqual(
      expect.objectContaining({ competition: 'formula-1-world-championship', file: 'File:F1.svg' }),
    );
  });

  it('recusa item sem competição, arquivo fora da Commons ou competição repetida', () => {
    expect(() => parseCompetitionLogos('logos:\n  - file: "File:X.svg"')).toThrow(/competition/);
    expect(() => parseCompetitionLogos('logos:\n  - competition: a\n    file: x.svg')).toThrow(/File:/);
    expect(() =>
      parseCompetitionLogos(
        'logos:\n  - competition: a\n    file: "File:A.svg"\n  - competition: a\n    file: "File:B.svg"',
      ),
    ).toThrow(/repetida/);
    expect(parseCompetitionLogos('')).toEqual([]);
  });
});

describe('fornecedor primeiro', () => {
  it('sem logo: liga o da Commons', () => {
    expect(logoDecision({ logoAssetId: null, origin: null })).toBe('link');
  });

  it('com o logo do fornecedor (ou do acervo): não toca', () => {
    expect(logoDecision({ logoAssetId: 'a', origin: 'provider' })).toBe('provider');
    expect(logoDecision({ logoAssetId: 'a', origin: 'acervo' }, true)).toBe('provider');
  });

  it('com o da Commons já ligado: só com --refazer', () => {
    expect(logoDecision({ logoAssetId: 'a', origin: 'commons' })).toBe('linked');
    expect(logoDecision({ logoAssetId: 'a', origin: 'commons' }, true)).toBe('link');
  });
});
