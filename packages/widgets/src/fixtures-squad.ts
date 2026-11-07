// Elenco de exemplo do Clube Aurora (`/v1/teams/{id}/squad`) para a prévia do Builder e os testes do
// widget Elenco do time (#825). Segue o contrato `Squad` de @galaxie/contracts.
import type { Squad } from '@galaxie/contracts';

type Row = [name: string, number: number | null, position: string | null, iso: string, age: number];

const COUNTRIES: Record<string, string> = { BR: 'Brasil', AR: 'Argentina', UY: 'Uruguai', CO: 'Colômbia' };

const PLAYERS: Row[] = [
  ['Rafael Moura', 1, 'Goalkeeper', 'BR', 31],
  ['Caio Prado', 12, 'Goalkeeper', 'BR', 24],
  ['Tiago Brandão', 2, 'Defender', 'BR', 27],
  ['Martín Ibarra', 4, 'Defender', 'AR', 29],
  ['Lucas Fontes', 3, 'Defender', 'BR', 22],
  ['Diego Sosa', 6, 'Defender', 'UY', 26],
  ['Bruno Teles', 5, 'Midfielder', 'BR', 30],
  ['Juan Cárdenas', 8, 'Midfielder', 'CO', 25],
  ['Gabriel Lins', 10, 'Midfielder', 'BR', 23],
  ['Pedro Avelar', 9, 'Attacker', 'BR', 28],
  ['Matías Rey', 11, 'Attacker', 'AR', 21],
  ['Enzo Mota', null, null, 'BR', 18],
];

const uuid = (n: number) => `0199a5c0-0000-7000-8000-0000000005${String(n).padStart(2, '0')}`;

const member = ([name, number, position, iso, age]: Row, i: number): Squad['players'][number] => ({
  person: {
    id: uuid(i + 1),
    name,
    photo: null,
    nationality: COUNTRIES[iso] ?? null,
    nationality_ref: { code: iso, name: COUNTRIES[iso] ?? iso },
    birth_date: null,
    age,
  },
  number,
  position,
  stats: null,
});

/** Elenco do time de exemplo; com `season`, devolve o ano pedido (como a API). */
export function previewSquad(teamId: string, season: number | null): Squad {
  return {
    team_id: teamId,
    season,
    players: PLAYERS.map(member),
    coaches: [member(['Renato Albuquerque', null, null, 'BR', 52], 90)],
    staff: [],
  };
}
