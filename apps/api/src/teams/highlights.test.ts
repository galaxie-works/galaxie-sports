import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { photoHighlights } from './highlights.js';

const acervo = parse(
  readFileSync(fileURLToPath(new URL('../../../../config/assets/commons/f1.yaml', import.meta.url)), 'utf8'),
) as { entries: { target: string; photos?: { file: string; match?: string }[] }[] };

describe('curadoria da foto de fundo do piloto', () => {
  const highlights = photoHighlights();

  it('Senna: Phoenix 1991', () => {
    expect(highlights.get('ayrton-senna')).toBe('File:Ayrton Senna 1991 USA 3 cropped.jpg');
  });

  it('toda foto curada está no acervo, como foto do piloto ou de um carro, e não foi rejeitada', () => {
    for (const [driver, file] of highlights) {
      const entries = acervo.entries.filter(
        (e) => e.target === `driver/${driver}` || e.target.startsWith('car/'),
      );
      const photo = entries.flatMap((e) => e.photos ?? []).find((p) => p.file === file);
      expect(photo, `${driver}: ${file}`).toBeDefined();
      expect(photo?.match).not.toBe('rejected');
    }
  });
});
