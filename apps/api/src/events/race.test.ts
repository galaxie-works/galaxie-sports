import { describe, expect, it } from 'vitest';
import { parseSessionType, raceResult, sessionName } from './race.js';

describe('sessões da F1', () => {
  it('lê o tipo e o número da sessão do fornecedor', () => {
    expect(parseSessionType('Race')).toEqual({ type: 'race', number: null });
    expect(parseSessionType('Sprint')).toEqual({ type: 'sprint', number: null });
    expect(parseSessionType('3rd Qualifying')).toEqual({ type: 'qualifying', number: 3 });
    expect(parseSessionType('2nd Sprint Shootout')).toEqual({ type: 'sprint_qualifying', number: 2 });
    expect(parseSessionType('1st Practice')).toEqual({ type: 'practice', number: 1 });
    expect(parseSessionType('Warm Up')).toBeNull();
    expect(parseSessionType(null)).toBeNull();
  });

  it('nomeia a sessão no idioma da resposta', () => {
    expect(sessionName('race', null, 'pt-BR')).toBe('Corrida');
    expect(sessionName('practice', 2, 'pt-BR')).toBe('Treino livre 2');
    expect(sessionName('qualifying', 3, 'es-AR')).toBe('Clasificación · Q3');
    expect(sessionName('sprint_qualifying', 1, 'pt-BR')).toBe('Classificação da sprint · SQ1');
  });
});

describe('resultado do piloto', () => {
  const teams = new Map([
    ['1', { id: '01a16671-2a0c-73ff-a4a0-a5ce0bb85308', name: 'Red Bull Racing', logo: null }],
  ]);

  it('troca o ID da equipe do fornecedor pelo participante nosso', () => {
    expect(
      raceResult(
        {
          position: 2,
          time: '+22.457s',
          laps: 57,
          grid: 5,
          pits: 2,
          gap: null,
          team: { id: 1, name: 'RBR' },
        },
        teams,
      ),
    ).toEqual({
      time: '+22.457s',
      gap: null,
      laps: 57,
      grid: 5,
      pits: 2,
      team: { id: '01a16671-2a0c-73ff-a4a0-a5ce0bb85308', name: 'Red Bull Racing', logo: null },
    });
  });

  it('equipe fora do cadastro fica só com o nome; grid de classificação usa o tempo de volta', () => {
    expect(
      raceResult({ grid: 3, qualifying_time: '1:29.179', team: { id: 99, name: 'Nova' } }, teams),
    ).toEqual({
      time: '1:29.179',
      gap: null,
      laps: null,
      grid: 3,
      pits: null,
      team: { id: null, name: 'Nova', logo: null },
    });
    expect(raceResult(null, teams)).toBeNull();
  });
});
