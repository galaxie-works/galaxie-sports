import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commonsTitle, parseTeamLogos, teamLogoStorageKey } from './team-logos.js';

const MANIFEST = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'config',
  'assets',
  'commons',
  'team-logos.yaml',
);

describe('lista de logos de time', () => {
  it('a lista versionada é válida: construtores da F1 pelo id do f1db', () => {
    const entries = parseTeamLogos(readFileSync(MANIFEST, 'utf8'));
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e).toMatchObject({ sport: 'formula-1', provider: 'f1db' });
      expect(e.file).toMatch(/^File:/);
    }
  });

  it('recusa item sem time, arquivo fora da Commons, QID inválido ou time repetido', () => {
    const base = 'logos:\n  - sport: formula-1\n    provider: f1db\n';
    expect(() => parseTeamLogos(`${base}    file: "File:X.svg"`)).toThrow(/team/);
    expect(() => parseTeamLogos(`${base}    team: lola\n    file: x.svg`)).toThrow(/File:/);
    expect(() => parseTeamLogos(`${base}    team: lola\n    file: "File:X.svg"\n    wikidata: lola`)).toThrow(
      /QID/,
    );
    expect(() =>
      parseTeamLogos(
        `${base}    team: lola\n    file: "File:A.svg"\n  - sport: formula-1\n    provider: f1db\n    team: lola\n    file: "File:B.svg"`,
      ),
    ).toThrow(/repetido/);
    expect(parseTeamLogos('')).toEqual([]);
  });

  it('o mesmo time em outro fornecedor ou esporte não é repetição', () => {
    const entries = parseTeamLogos(
      'logos:\n' +
        '  - { sport: formula-1, provider: f1db, team: "1", file: "File:A.svg" }\n' +
        '  - { sport: formula-1, provider: api-sports, team: "1", file: "File:A.svg" }',
    );
    expect(entries).toHaveLength(2);
  });
});

describe('título e chave', () => {
  it('normaliza o título como a Commons devolve', () => {
    expect(commonsTitle('File:lola_Cars logo.png')).toBe('File:Lola Cars logo.png');
    expect(commonsTitle('File:Dallara logo.svg')).toBe('File:Dallara logo.svg');
  });

  it('a chave no storage usa só o id do time e o hash, nunca o nome do arquivo', () => {
    expect(teamLogoStorageKey('01a1', 'abcdef0123456789ff')).toBe('commons/teams/01a1.abcdef012345.png');
  });
});
