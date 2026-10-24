import { describe, expect, it } from 'vitest';
import { checkFacts, FactSheetBuilder, type FactSheet } from './facts.js';

/** Fatos do resumo de Palmeiras 4 × 1 Corinthians (timeline do fixture 1492407). */
function recapSheet(): FactSheet {
  const b = new FactSheetBuilder()
    .name('Palmeiras', 'Corinthians', 'Serie A', 'Rodada 30', 'Estádio 258', 'Sao Paulo')
    .expectResults()
    .expectGoals();
  b.score(4, 1, { result: true }).score(2, 0);
  for (const [m, e, scorer, h, a] of [
    [12, null, 'Atacante A', 1, 0],
    [45, 2, 'Zagueiro B', 2, 0],
    [77, null, 'Meia A', 3, 0],
    [81, null, 'Reserva B', 3, 1],
    [90, 4, 'Atacante A', 4, 1],
  ] as const) {
    b.minute(m, e).person(scorer, { goal: true }).score(h, a);
  }
  b.person('Meia A', { goal: true }); // assistência
  b.minute(58, null).person('Atacante B', { goal: true }); // pênalti perdido
  b.minute(30, null).person('Zagueiro B'); // amarelo
  b.number(2, 30, 58, 42, 8, 3); // 2 gols do Atacante A, rodada, posse, chutes
  return b.build();
}

describe('checkFacts — resumo', () => {
  const sheet = recapSheet();

  it('aprova um resumo fiel', () => {
    const text =
      'O Palmeiras venceu o Corinthians por 4 a 1 pela Rodada 30 da Serie A. ' +
      "Atacante A abriu o placar aos 12' e fechou a conta aos 90+4', depois do gol contra de Zagueiro B (45+2') e do pênalti convertido por Meia A (77'). " +
      "Reserva B descontou aos 81'.";
    expect(checkFacts(text, sheet, 'pt-BR')).toEqual([]);
  });

  it('aprova em espanhol', () => {
    const text =
      'Palmeiras le ganó 4-1 a Corinthians. Atacante A marcó dos goles, a los 12 y en el 90+4, y Reserva B descontó en el 81.';
    expect(checkFacts(text, sheet, 'es-AR')).toEqual([]);
  });

  it('reprova autor de gol inventado (nome fora dos fatos)', () => {
    const v = checkFacts("Palmeiras 4 a 1. Gabriel Silva marcou aos 12'.", sheet, 'pt-BR');
    expect(v.map((x) => [x.kind, x.value])).toContainEqual(['unknown_name', 'Gabriel Silva']);
  });

  it('reprova pessoa real creditada por gol que não fez', () => {
    const v = checkFacts(
      'Palmeiras venceu por 4 a 1, com gol de Zagueiro B e outro de Atacante A.',
      sheet,
      'pt-BR',
    );
    expect(v).toEqual([]); // gol contra conta como participação em gol
    const w = checkFacts('Palmeiras venceu por 4 a 1 com dois gols marcados por Meia A.', sheet, 'pt-BR');
    expect(w).toEqual([]);
    const bad = new FactSheetBuilder().name('Palmeiras').expectGoals().person('Atacante A', { goal: true });
    bad.person('Goleiro A');
    expect(
      checkFacts('Goleiro A marcou o gol do Palmeiras.', bad.build(), 'pt-BR').map((x) => x.kind),
    ).toContain('wrong_scorer');
  });

  it('reprova placar final errado mesmo quando o placar existiu no meio do jogo', () => {
    const v = checkFacts('O Palmeiras venceu o Corinthians por 3 a 1.', sheet, 'pt-BR');
    expect(v.map((x) => x.kind)).toContain('wrong_result');
  });

  it('reprova placar que nunca existiu', () => {
    const v = checkFacts('Palmeiras e Corinthians fizeram 5 a 2 no Allianz.', sheet, 'pt-BR');
    expect(v.map((x) => x.kind)).toEqual(expect.arrayContaining(['unknown_score', 'unknown_name']));
  });

  it('reprova minuto que não está na timeline', () => {
    const v = checkFacts("Atacante A marcou aos 15'.", sheet, 'pt-BR');
    expect(v.map((x) => [x.kind, x.value])).toContainEqual(['unknown_minute', "15'"]);
  });

  it('reprova número por extenso inventado', () => {
    const v = checkFacts('O Palmeiras marcou sete gols.', sheet, 'pt-BR');
    expect(v.map((x) => [x.kind, x.value])).toContainEqual(['unknown_number', 'sete']);
  });

  it('não confunde "dos" (contração em pt) com número', () => {
    expect(checkFacts('O Palmeiras dominou a maior parte dos minutos.', sheet, 'pt-BR')).toEqual([]);
  });
});

describe('checkFacts — cenário', () => {
  const sheet = new FactSheetBuilder()
    .name('Palmeiras', 'Corinthians', 'Avança com empate', 'Precisa vencer por 2 gols para avançar direto')
    .score(2, 1)
    .number(2, 1)
    .build();

  it('aprova o exemplo do docs/07', () => {
    const text =
      'O Palmeiras venceu a ida por 2 a 1 e se classifica com qualquer vitória ou empate. ' +
      'O Corinthians precisa vencer por dois gols de diferença para avançar direto; vitória por um gol leva a decisão aos pênaltis.';
    expect(checkFacts(text, sheet, 'pt-BR')).toEqual([]);
  });

  it('reprova margem inventada', () => {
    const v = checkFacts('O Corinthians precisa vencer por três gols.', sheet, 'pt-BR');
    expect(v.map((x) => x.value)).toContain('tres');
  });

  it('reprova apelido que não está nos fatos', () => {
    const v = checkFacts('O Verdão joga pelo empate.', sheet, 'pt-BR');
    expect(v.map((x) => [x.kind, x.value])).toContainEqual(['unknown_name', 'Verdão']);
  });

  it('aceita nome com conector e palavras comuns no início da frase', () => {
    const s = new FactSheetBuilder().name('Vasco da Gama', 'Atlético de Madrid').build();
    expect(
      checkFacts('Com o empate, Vasco da Gama avança. Na Espanha, nada.', s, 'pt-BR').map((x) => x.value),
    ).toEqual(['Espanha']);
    expect(checkFacts('El Atlético de Madrid necesita ganar.', s, 'es-AR')).toEqual([]);
  });

  it('não lê números de dentro de nomes permitidos', () => {
    const s = new FactSheetBuilder().name('Club 9 de Octubre', 'Once Caldas').build();
    expect(checkFacts('Club 9 de Octubre recibe a Once Caldas.', s, 'es-EC')).toEqual([]);
  });
});

describe('checkFacts — ordinais de título (tetra, penta)', () => {
  const s = new FactSheetBuilder()
    .name('Palmeiras', 'Estudiantes', 'Libertadores', 'São Paulo')
    .number(3, 4, 5)
    .build();

  it('aceita tetra e penta quando 4 e 5 estão nos fatos', () => {
    expect(checkFacts('O Palmeiras busca o tetra; o Estudiantes, o pentacampeonato.', s, 'pt-BR')).toEqual(
      [],
    );
    expect(checkFacts('Estudiantes va por el pentacampeonato.', s, 'es-AR')).toEqual([]);
  });

  it('recusa ordinal fora dos fatos (hexa = 6) em pt e es', () => {
    expect(checkFacts('O Palmeiras busca o hexa.', s, 'pt-BR').map((v) => v.value)).toEqual(['hexa']);
    expect(checkFacts('Palmeiras es hexacampeón.', s, 'es-AR').map((v) => v.value)).toEqual(['hexacampeon']);
  });

  it('não confunde "tricolor" com tricampeão', () => {
    expect(checkFacts('O Tricolor recebe o Palmeiras.', s, 'pt-BR').map((v) => v.kind)).not.toContain(
      'unknown_number',
    );
  });
});
