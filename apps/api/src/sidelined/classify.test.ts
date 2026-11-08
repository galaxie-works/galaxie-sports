import { describe, expect, it } from 'vitest';
import type { SidelinedPlayer } from '@galaxie/contracts';
import {
  isActiveOn,
  mergeSidelined,
  sidelinedCategory,
  sidelinedReasonLabel,
  sidelinedStatus,
} from './classify.js';

describe('sidelinedCategory', () => {
  it('separa lesão, suspensão, doença e outros motivos pelo texto do fornecedor', () => {
    expect(sidelinedCategory('Hamstring Injury')).toBe('injury');
    expect(sidelinedCategory('Knock')).toBe('injury');
    expect(sidelinedCategory('Broken ankle')).toBe('injury');
    expect(sidelinedCategory('Red Card')).toBe('suspension');
    expect(sidelinedCategory('Yellow Cards')).toBe('suspension');
    expect(sidelinedCategory('Suspended')).toBe('suspension');
    expect(sidelinedCategory('Illness')).toBe('illness');
    expect(sidelinedCategory('Virus')).toBe('illness');
    expect(sidelinedCategory("Coach's decision")).toBe('other');
    expect(sidelinedCategory(null)).toBe('other');
  });
});

describe('sidelinedStatus', () => {
  it('"Questionable" é dúvida; "Missing Fixture" e o resto, fora', () => {
    expect(sidelinedStatus('Questionable')).toBe('doubtful');
    expect(sidelinedStatus('Missing Fixture')).toBe('out');
    expect(sidelinedStatus(undefined)).toBe('out');
  });
});

describe('sidelinedReasonLabel', () => {
  it('traduz os motivos comuns, sem caixa nem pontuação', () => {
    expect(sidelinedReasonLabel('Hamstring Injury', 'pt-BR')).toBe('Lesão na coxa (posterior)');
    expect(sidelinedReasonLabel('red card', 'es-AR')).toBe('Tarjeta roja');
    expect(sidelinedReasonLabel("Coach's Decision", 'pt-BR')).toBe('Opção do técnico');
  });

  it('motivo desconhecido: em inglês o texto do fornecedor; nos outros, a categoria', () => {
    expect(sidelinedReasonLabel('Metatarsal Stress Fracture', 'en')).toBe('Metatarsal Stress Fracture');
    expect(sidelinedReasonLabel('Metatarsal Stress Fracture', 'pt-BR')).toBe('Lesão');
    expect(sidelinedReasonLabel('Something else', 'es-AR')).toBe('Otro motivo');
    expect(sidelinedReasonLabel('', 'pt-BR')).toBeNull();
  });
});

describe('isActiveOn', () => {
  it('vale de início a fim (inclusive)', () => {
    expect(isActiveOn('2026-10-01', '2026-11-10', '2026-11-06')).toBe(true);
    expect(isActiveOn('2026-10-01', '2026-11-06', '2026-11-06')).toBe(true);
    expect(isActiveOn('2026-10-01', '2026-11-05', '2026-11-06')).toBe(false);
    expect(isActiveOn('2026-11-07', '2026-11-20', '2026-11-06')).toBe(false);
  });

  it('sem fim, vale por 120 dias do início; sem nenhuma data, não vale', () => {
    expect(isActiveOn('2026-09-01', null, '2026-11-06')).toBe(true);
    expect(isActiveOn('2026-01-01', null, '2026-11-06')).toBe(false);
    expect(isActiveOn(null, '2026-12-01', '2026-11-06')).toBe(true);
    expect(isActiveOn(null, null, '2026-11-06')).toBe(false);
  });
});

describe('mergeSidelined', () => {
  const player = (
    over: Partial<SidelinedPlayer> & { name: string; id?: string | null },
  ): SidelinedPlayer => ({
    person: { id: over.id ?? null, name: over.name, photo: null },
    position: null,
    number: null,
    status: 'out',
    category: 'injury',
    reason: 'Knee Injury',
    reason_label: 'Lesão no joelho',
    since: null,
    until: null,
    source: 'match',
    ...over,
  });

  it('a lista do jogo vence a do histórico e herda as datas', () => {
    const merged = mergeSidelined([
      [player({ id: 'a', name: 'Ana', status: 'doubtful' })],
      [
        player({
          id: 'a',
          name: 'Ana',
          source: 'history',
          since: '2026-10-20',
          until: '2026-11-15',
          number: 9,
        }),
      ],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      source: 'match',
      status: 'doubtful',
      since: '2026-10-20',
      until: '2026-11-15',
      number: 9,
    });
  });

  it('fora antes de dúvida; sem previsão e a volta mais distante primeiro; depois o nome', () => {
    const merged = mergeSidelined([
      [
        player({ id: 'd', name: 'Duda', status: 'doubtful' }),
        player({ id: 'b', name: 'Bia', until: '2026-11-10' }),
        player({ id: 'c', name: 'Caio', until: '2026-12-20' }),
        player({ id: 'e', name: 'Éder' }),
        player({ id: 'a', name: 'Álvaro' }),
      ],
    ]);
    expect(merged.map((p) => p.person.name)).toEqual(['Álvaro', 'Éder', 'Caio', 'Bia', 'Duda']);
  });
});
