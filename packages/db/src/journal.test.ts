import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { journalProblems, type Journal, type JournalEntry } from './journal.js';
import { migrationsFolder } from './migrate.js';

const entry = (idx: number, when: number, name = `m${idx}`): JournalEntry => ({
  idx,
  when,
  tag: `${String(idx).padStart(4, '0')}_${name}`,
});
const journal = (...entries: JournalEntry[]): Journal => ({ entries });

describe('journal de migrations', () => {
  it('aceita idx sequencial e when crescente, com a base preservada', () => {
    const base = journal(entry(0, 100), entry(1, 200));
    expect(journalProblems(journal(...base.entries, entry(2, 300)), base)).toEqual([]);
  });

  it('acusa a migration renumerada no merge que ficou com when menor que o da base', () => {
    // o PR gerou a 0002 às 250; o main recebeu outra 0002 às 300; o PR foi renumerado para 0003 sem mudar o when
    const base = journal(entry(0, 100), entry(1, 200), entry(2, 300, 'main'));
    const head = journal(...base.entries, entry(3, 250, 'pr'));
    const problems = journalProblems(head, base);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^0003_pr: when 250 não é maior que o de 0002_main \(300\)/);
  });

  it('acusa when igual ao anterior (o migrator compara com <)', () => {
    expect(journalProblems(journal(entry(0, 100), entry(1, 100)))).toHaveLength(1);
  });

  it('acusa idx fora de sequência', () => {
    expect(journalProblems(journal(entry(0, 100), entry(2, 200)))).toEqual([
      '0002_m2: idx 2 na posição 1 (esperado 1)',
    ]);
  });

  it('acusa migration da base alterada, trocada de posição ou removida', () => {
    const base = journal(entry(0, 100), entry(1, 200, 'main'));
    // when de migration já aplicada mudou: o migrator a rodaria de novo
    expect(journalProblems(journal(entry(0, 100), entry(1, 250, 'main')), base)).toHaveLength(1);
    // a do PR entrou antes da do main
    const swapped = journal(entry(0, 100), entry(1, 150, 'pr'), entry(2, 200, 'main'));
    expect(journalProblems(swapped, base)).toEqual([
      expect.stringMatching(/^posição 1: a base tem 0001_main/),
    ]);
    expect(journalProblems(journal(entry(0, 100)), base)).toEqual([
      '0001_main: migration da base sumiu do journal',
    ]);
  });

  it('o journal versionado está em ordem', () => {
    const real = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as Journal;
    expect(real.entries.length).toBeGreaterThan(0);
    expect(journalProblems(real)).toEqual([]);
  });
});
