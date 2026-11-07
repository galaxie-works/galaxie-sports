import { describe, expect, it } from 'vitest';
import { splitProviderGroups, type TableRow } from './phases.js';

const at = new Date('2026-11-07T00:00:00Z');
const row = (group: string, participantId: string, source: 'computed' | 'provider'): TableRow => ({
  group,
  participantId,
  source,
  updatedAt: at,
});

describe('splitProviderGroups', () => {
  it('sem tabela calculada, tudo segue como está (o fornecedor define os grupos)', () => {
    const rows = [row('Serie A', 't1', 'provider'), row('Acumulada', 't1', 'provider')];
    expect(splitProviderGroups(rows)).toEqual({ own: rows, repeated: [] });
  });

  it('grupo do fornecedor que só repete os nossos times sai da montagem', () => {
    const rows = [
      row('', 't1', 'computed'),
      row('', 't2', 'computed'),
      row('Promedios 2026', 't1', 'provider'),
      row('Promedios 2026', 't2', 'provider'),
    ];
    const r = splitProviderGroups(rows);
    expect(r.repeated).toEqual(['Promedios 2026']);
    expect(r.own.map((x) => x.group)).toEqual(['', '']);
  });

  it('grupo com time que ainda não calculamos (fase de grupos que não começou) continua', () => {
    const rows = [
      row('Group A', 't1', 'computed'),
      row('Group A', 't2', 'computed'),
      row('Group B', 't3', 'provider'),
      row('Group B', 't4', 'provider'),
    ];
    const r = splitProviderGroups(rows);
    expect(r.repeated).toEqual([]);
    expect(r.own).toHaveLength(4);
  });
});
