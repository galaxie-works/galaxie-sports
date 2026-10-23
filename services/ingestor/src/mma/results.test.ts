import { describe, expect, it } from 'vitest';
import { prioritizeMmaResults, type MmaFightRow } from './results.js';

const fight = (
  fightId: string,
  cardId: string,
  cardName: string,
  date: string,
  isMain: boolean,
  names: [string, string],
  status = 'finished',
): MmaFightRow => ({
  fightId,
  cardId,
  cardName,
  startsAt: new Date(date),
  status,
  summary: {
    id: Number(fightId),
    date,
    is_main: isMain,
    status: { short: status === 'cancelled' ? 'CANC' : 'FT' },
    fighters: { first: { name: names[0] }, second: { name: names[1] } },
  },
});

describe('fila de desfechos do MMA', () => {
  const ufc300 = 'UFC 300: Pereira vs. Hill';
  const fn = 'UFC Fight Night: Moreno vs. Royval 2';
  const fights = [
    fight('1', 'c300', ufc300, '2024-04-13T14:00:00Z', false, ['Cody Garbrandt', 'Deiveson Figueiredo']),
    fight('2', 'c300', ufc300, '2024-04-13T16:00:00Z', false, ['Diego Lopes', 'Sodiq Yusuff']),
    fight('3', 'c300', ufc300, '2024-04-13T18:00:00Z', true, ['Arman Tsarukyan', 'Charles Oliveira']),
    fight('4', 'c300', ufc300, '2024-04-13T18:00:00Z', true, ['Jamahal Hill', 'Alex Pereira']),
    fight('5', 'c300', ufc300, '2024-04-13T18:00:00Z', true, ['A B', 'C D'], 'cancelled'),
    fight('6', 'cfn', fn, '2024-02-24T19:00:00Z', true, ['Brandon Moreno', 'Brandon Royval']),
    fight('7', 'cfn', fn, '2024-02-24T16:00:00Z', false, ['Ricky Turcios', 'Raul Rosas Jr.']),
  ];

  it('luta principal, card principal, preliminares e iniciais; PPV antes de Fight Night', () => {
    expect(prioritizeMmaResults(fights, new Set()).map((c) => [c.fightId, c.segment, c.mainEvent])).toEqual([
      ['4', 'main_card', true],
      ['6', 'main_card', true],
      ['3', 'main_card', false],
      ['2', 'prelims', false],
      // único bloco de preliminares do Fight Night: preliminares
      ['7', 'prelims', false],
      ['1', 'early_prelims', false],
    ]);
  });

  it('pula as que já têm desfecho no raw e as não encerradas', () => {
    const queue = prioritizeMmaResults(fights, new Set(['4', '3']));
    expect(queue.map((c) => c.fightId)).toEqual(['6', '2', '7', '1']);
  });
});
