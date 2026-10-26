import { describe, expect, it } from 'vitest';
import { dbHost, describePanelDecisions, parsePanelDecisions } from './panel-decisions.js';

describe('decisões do painel levadas da VPS para o dev', () => {
  const file = {
    exportedAt: '2026-10-25T12:00:00.000Z',
    host: 'db:5432',
    decisions: [
      { itemId: 'editorial:pt-BR.f1-ayrton-senna', status: 'approved', reviewHash: 'h1' },
      { itemId: 'editorial:es.f1-ayrton-senna', status: 'draft', reviewHash: 'h2' },
    ],
    overrides: [],
  };

  it('lê o arquivo exportado e diz de onde vieram e quantas', () => {
    const p = parsePanelDecisions(JSON.stringify(file), 'panel-decisions.json');
    expect(p.decisions).toHaveLength(2);
    expect(describePanelDecisions(p)).toBe(
      'Decisões do painel: 2 (editorial:*, 1 aprovada(s)) e 0 edição(ões), lidas de db:5432 em 2026-10-25T12:00:00.000Z.',
    );
  });

  it('nenhuma decisão vira aviso; formato inesperado é erro', () => {
    const empty = parsePanelDecisions(JSON.stringify({ ...file, decisions: [] }), 'x.json');
    expect(describePanelDecisions(empty)).toMatch(/AVISO: nenhuma decisão editorial/);
    expect(() => parsePanelDecisions('[]', 'x.json')).toThrow(/formato inesperado/);
    expect(() =>
      parsePanelDecisions(JSON.stringify({ ...file, decisions: [{ itemId: 1 }] }), 'x.json'),
    ).toThrow(/formato inesperado/);
  });

  it('host do banco sem credenciais', () => {
    expect(dbHost('postgres://usuario:senha@db.interno:5432/galaxie')).toBe('db.interno:5432');
    expect(dbHost(undefined)).toBe('?');
    expect(dbHost('não é url')).toBe('?');
  });
});
