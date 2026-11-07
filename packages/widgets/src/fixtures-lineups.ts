// Escalações de exemplo (`/v1/events/{id}/lineups`) para a prévia do Builder e os testes. Segue o contrato
// completo da API (@galaxie/contracts): se ele mudar, o typecheck daqui acusa.
import type { EventLineups } from '@galaxie/contracts';

import type { GsEvent } from './core/model.js';

type Lineup = EventLineups['lineups'][number];
type Player = Lineup['start_xi'][number];

/** Elencos de exemplo por formação: nome, posição e "linha:coluna" no campo (goleiro em `1:1`). */
const XI: Record<'4-3-3' | '4-4-2', [string, string, string][]> = {
  '4-3-3': [
    ['Rafael Lima', 'G', '1:1'],
    ['Diego Prado', 'D', '2:4'],
    ['Bruno Costa', 'D', '2:3'],
    ['Léo Martins', 'D', '2:2'],
    ['Caio Nunes', 'D', '2:1'],
    ['André Sales', 'M', '3:3'],
    ['Felipe Rocha', 'M', '3:2'],
    ['Thiago Alves', 'M', '3:1'],
    ['Matheus Reis', 'F', '4:3'],
    ['Gabriel Souza', 'F', '4:2'],
    ['Vitor Hugo Dias', 'F', '4:1'],
  ],
  '4-4-2': [
    ['Marcos Pereira', 'G', '1:1'],
    ['João Vitor', 'D', '2:4'],
    ['Renan Silva', 'D', '2:3'],
    ['Pedro Henrique', 'D', '2:2'],
    ['Lucas Moura', 'D', '2:1'],
    ['Igor Campos', 'M', '3:4'],
    ['Danilo Freitas', 'M', '3:3'],
    ['Hugo Ramos', 'M', '3:2'],
    ['Samuel Teixeira', 'M', '3:1'],
    ['Wesley Barros', 'F', '4:2'],
    ['Éverton Luz', 'F', '4:1'],
  ],
};
const NUMBERS = [1, 2, 4, 3, 6, 5, 8, 10, 7, 9, 11];
const BENCH: [string, string][] = [
  ['Otávio Brandão', 'G'],
  ['Murilo Santos', 'D'],
  ['Nícolas Faria', 'M'],
  ['Enzo Carvalho', 'M'],
  ['Kauã Ribeiro', 'F'],
];
const COACHES = ['Paulo Azevedo', 'Ricardo Gomes'];

/**
 * Escalação de exemplo de um jogo: antes do início, "ainda não divulgada" (`available: false`, como a API
 * responde sem o detalhe); ao vivo ou encerrado, os dois times com titulares, reservas e técnico.
 */
export function sampleLineups(e: GsEvent): EventLineups {
  if (e.status === 'scheduled') return { event_id: e.id, available: false, lineups: [] };
  const sides = ['home', 'away'] as const;
  return {
    event_id: e.id,
    available: true,
    lineups: sides.map((side, i): Lineup => {
      const p = e.participants.find((x) => x.side === side);
      const formation = i ? '4-4-2' : '4-3-3';
      const player = (name: string, position: string, number: number, grid: string | null): Player => ({
        person: { id: null, name },
        number,
        position,
        grid,
      });
      return {
        team: { id: p?.id ?? null, name: p?.name ?? null, side, logo: p?.logo ?? null },
        formation,
        coach: { id: null, name: COACHES[i]! },
        start_xi: XI[formation].map(([name, pos, grid], n) => player(name, pos, NUMBERS[n]!, grid)),
        substitutes: BENCH.map(([name, pos], n) => player(name, pos, 12 + n * 2 + i, null)),
      };
    }),
  };
}
