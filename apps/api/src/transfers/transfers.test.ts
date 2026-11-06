import { describe, expect, it } from 'vitest';
import { shapeTransfers, sinceDate, type TransferRow } from './transfers.js';

const A = '0199a5c0-0000-7000-8000-0000000000a1';
const B = '0199a5c0-0000-7000-8000-0000000000a2';
const OUT = '0199a5c0-0000-7000-8000-0000000000f1';
const P1 = '0199a5c0-0000-7000-8000-000000000101';
const P2 = '0199a5c0-0000-7000-8000-000000000102';
const P3 = '0199a5c0-0000-7000-8000-000000000103';

const row = (r: Partial<TransferRow>): TransferRow => ({
  personId: P1,
  date: '2026-07-01',
  type: null,
  fromId: null,
  toId: null,
  fromName: null,
  toName: null,
  ...r,
});

const base = {
  teams: new Set([A, B]),
  people: new Map([
    [P1, { name: 'Jogador Um', photo: null }],
    [P2, { name: 'Jogador Dois', photo: 'https://cdn/p2.png' }],
  ]),
  clubs: new Map([
    [A, { name: 'Clube Aurora', logo: 'https://cdn/a.png' }],
    [B, { name: 'Estrela do Sul', logo: null }],
  ]),
  limit: 10,
};

describe('shapeTransfers', () => {
  const rows = [
    row({ personId: P1, toId: A, fromName: 'Clube de Fora', type: 'Loan' }),
    row({ personId: P2, date: '2026-06-20', fromId: A, toName: 'Exterior FC', type: '€ 2.5M' }),
    row({ personId: P2, date: '2026-06-10', fromId: A, toId: B, type: 'N/A' }),
  ];

  it('direção do ponto de vista do recorte, com tipo e clubes', () => {
    const out = shapeTransfers(rows, { ...base, direction: 'all' });
    expect(out.map((t) => t.direction)).toEqual(['in', 'out', 'in']);
    expect(out[0]).toMatchObject({
      person: { id: P1, name: 'Jogador Um' },
      kind: 'loan',
      type: 'Loan',
      from: { id: null, name: 'Clube de Fora', logo: null },
      to: { id: A, name: 'Clube Aurora', logo: 'https://cdn/a.png' },
    });
    expect(out[1]).toMatchObject({ kind: 'fee', fee: '€ 2.5M', to: { id: null, name: 'Exterior FC' } });
    // "N/A" é ausência de tipo
    expect(out[2]).toMatchObject({ kind: null, type: null });
  });

  it('só entradas ou só saídas (com saídas pedidas, a troca interna também é saída)', () => {
    expect(shapeTransfers(rows, { ...base, direction: 'in' }).map((t) => t.person.id)).toEqual([P1, P2]);
    const outs = shapeTransfers(rows, { ...base, direction: 'out' });
    expect(outs.map((t) => [t.person.id, t.direction])).toEqual([
      [P2, 'out'],
      [P2, 'out'],
    ]);
  });

  it('ignora quem não está no cadastro, linhas fora do recorte e repetidas; respeita o limite', () => {
    const extra = [
      row({ personId: P3, toId: A }),
      row({ personId: P1, fromId: OUT, toId: OUT }),
      row({ personId: P1, toId: A, fromName: 'Clube de Fora', type: 'N/A' }),
    ];
    expect(shapeTransfers([...rows, ...extra], { ...base, direction: 'all' })).toHaveLength(3);
    expect(shapeTransfers(rows, { ...base, direction: 'all', limit: 1 })).toHaveLength(1);
  });
});

describe('sinceDate', () => {
  it('N dias antes de hoje, em UTC', () => {
    expect(sinceDate(new Date('2026-11-06T23:00:00Z'), 30)).toBe('2026-10-07');
  });
});
