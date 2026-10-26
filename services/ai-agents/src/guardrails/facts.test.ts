import { describe, expect, it } from 'vitest';
import { checkFacts, FactSheetBuilder, type FactSheet } from './facts.js';
import { splitSentences } from './text.js';

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
    b.minute(m, e).person(scorer, { goal: 'scorer' }).score(h, a);
  }
  b.person('Meia A', { goal: 'assist' });
  b.person('Lateral A', { goal: 'assist' }); // só deu assistência
  b.minute(58, null).person('Atacante B', { goal: 'missed_penalty' });
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
    const bad = new FactSheetBuilder()
      .name('Palmeiras')
      .expectGoals()
      .person('Atacante A', { goal: 'scorer' });
    bad.person('Goleiro A');
    expect(
      checkFacts('Goleiro A marcou o gol do Palmeiras.', bad.build(), 'pt-BR').map((x) => x.kind),
    ).toContain('wrong_scorer');
  });

  it('assistência e pênalti perdido não fazem de ninguém autor de gol', () => {
    const scorer = (text: string) =>
      checkFacts(text, sheet, 'pt-BR')
        .filter((v) => v.kind === 'wrong_scorer')
        .map((v) => v.value);
    expect(scorer("Lateral A marcou o gol do Palmeiras aos 12'.")).toEqual(['lateral a']);
    expect(scorer('Palmeiras venceu por 4 a 1, com gol de Lateral A.')).toEqual(['lateral a']);
    expect(scorer("Atacante B marcou de pênalti aos 58'.")).toEqual(['atacante b']);
    // papel trocado na mesma frase: quem só deu o passe aparece como autor
    expect(scorer("Lateral A marcou aos 12', com assistência de Atacante A.")).toEqual(['lateral a']);
    // cada um no seu papel
    expect(scorer("Atacante A abriu o placar aos 12' após assistência de Lateral A.")).toEqual([]);
    expect(scorer("Atacante B perdeu um pênalti aos 58', antes do gol de Meia A.")).toEqual([]);
    expect(
      checkFacts('Atacante A marcó tras una asistencia de Lateral A.', sheet, 'es-AR').filter(
        (v) => v.kind === 'wrong_scorer',
      ),
    ).toEqual([]);
    expect(checkFacts('Lateral A marcó el gol de Palmeiras.', sheet, 'es-AR').map((v) => v.kind)).toContain(
      'wrong_scorer',
    );
    expect(
      checkFacts('Atacante B erró un penal a los 58, antes del gol de Meia A.', sheet, 'es-AR').filter(
        (v) => v.kind === 'wrong_scorer',
      ),
    ).toEqual([]);
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

describe('checkFacts — desfecho do confronto', () => {
  const sheet = new FactSheetBuilder()
    .name('Palmeiras', 'Corinthians', 'Libertadores', 'final', 'semifinais')
    .score(2, 1, { result: true })
    .outcome(['Palmeiras', 'Verdão'], ['Corinthians', 'Timão'])
    .build();
  const outcome = (text: string, locale = 'pt-BR') =>
    checkFacts(text, sheet, locale)
      .filter((v) => v.kind === 'wrong_outcome')
      .map((v) => v.value);

  it('reprova o perdedor como classificado ou campeão e o vencedor como eliminado', () => {
    expect(outcome('O Corinthians se classificou para a final.')).toEqual(['corinthians']);
    expect(outcome('O Corinthians é campeão da Libertadores.')).toEqual(['corinthians']);
    expect(outcome('O Corinthians eliminou o Palmeiras.')).toEqual(['corinthians']);
    expect(outcome('O Palmeiras foi eliminado pelo Corinthians.')).toEqual(['palmeiras']);
    expect(outcome('Corinthians se clasificó a la final.', 'es-AR')).toEqual(['corinthians']);
    expect(outcome('Palmeiras quedó eliminado ante Corinthians.', 'es-AR')).toEqual(['palmeiras']);
  });

  it('aceita o desfecho certo, com o perdedor como objeto ou em outra oração', () => {
    for (const text of [
      'O Palmeiras se classificou para a final ao eliminar o Corinthians.',
      'O Palmeiras eliminou o Corinthians e avançou para a final.',
      'Mesmo perdendo para o Corinthians por 2 a 1, o Palmeiras se classificou.',
      'O Palmeiras perdeu para o Corinthians, mas se classificou para a final.',
      'O Corinthians venceu por 2 a 1, mas foi eliminado.',
      'O Corinthians caiu diante do Palmeiras, que se classificou para a final.',
      'O Corinthians não se classificou.',
      'O Palmeiras é tetracampeão; o Corinthians ficou com o vice-campeonato.',
    ])
      expect(outcome(text), text).toEqual([]);
    expect(outcome('Palmeiras eliminó a Corinthians y se metió en la final.', 'es-AR')).toEqual([]);
  });

  it('sem desfecho nos fatos, não checa', () => {
    const open = new FactSheetBuilder().name('Palmeiras', 'Corinthians').build();
    expect(checkFacts('O Corinthians se classificou.', open, 'pt-BR')).toEqual([]);
  });
});

describe('checkFacts — texto bom do resumo não é barrado (casos da revisão)', () => {
  // papéis variados no gol e desfecho: Palmeiras passou, Corinthians caiu
  const b = new FactSheetBuilder()
    .name('Palmeiras', 'Corinthians', 'Libertadores', 'final', 'semifinais', 'Allianz Parque')
    .expectResults()
    .expectGoals();
  b.score(2, 1, { result: true }).score(1, 0).score(4, 3, { result: true }).score(3, 3, { result: true });
  b.number(2, 1, 4, 3);
  b.minute(12, null).person('João Pedro', { goal: 'scorer' });
  b.person('Raphael Veiga', { goal: 'assist' });
  b.minute(77, null).person('Raphael Veiga Jr', { goal: 'scorer' });
  b.minute(30, null).person('Yuri Alberto', { goal: 'scorer' });
  b.person('Rodrigo Garro', { goal: 'assist' });
  b.minute(58, null).person('Memphis Depay', { goal: 'missed_penalty' });
  b.person('Weverton'); // goleiro: sem papel em gol
  b.outcome(['Palmeiras', 'Verdão'], ['Corinthians', 'Timão']);
  const sheet = b.build();
  const run = (t: string, locale = 'pt-BR') =>
    checkFacts(t, sheet, locale)
      .filter((v) => v.kind === 'wrong_scorer' || v.kind === 'wrong_outcome')
      .map((v) => `${v.kind}:${v.value}`);

  const cases: [string, string?][] = [
    // gols
    ["Raphael Veiga cruzou e João Pedro marcou de cabeça aos 12'."],
    ["Raphael Veiga lançou João Pedro, que marcou aos 12'."],
    ["Raphael Veiga tocou para João Pedro marcar aos 12'."],
    ["João Pedro abriu o placar aos 12', após passe de Raphael Veiga."],
    ['Com gol de João Pedro após passe de Raphael Veiga, o Palmeiras abriu o placar.'],
    ['O gol foi marcado por João Pedro, em jogada de Raphael Veiga.'],
    ["Rodrigo Garro participou do gol de Yuri Alberto aos 30'."],
    ["Memphis Depay desperdiçou um pênalti aos 58' e Yuri Alberto marcou aos 30'."],
    ["Weverton defendeu o pênalti de Memphis Depay aos 58', e João Pedro marcou aos 12'."],
    ["Weverton pegou o pênalti de Memphis Depay aos 58'; antes, João Pedro marcou aos 12'."],
    ["Weverton brilhou ao defender pênalti de Memphis Depay, e João Pedro marcou aos 12'."],
    ["Memphis Depay mandou o pênalti no travessão aos 58', e Yuri Alberto marcou aos 30'."],
    ["Memphis Depay chutou o pênalti por cima aos 58'; Yuri Alberto marcou aos 30'."],
    ["Raphael Veiga Jr, de pênalti, ampliou aos 77'."],
    ["Raphael Veiga Jr ampliou de pênalti aos 77'."],
    // es
    ["Raphael Veiga centró y João Pedro marcó de cabeza a los 12'.", 'es-AR'],
    ["Raphael Veiga habilitó a João Pedro, que marcó a los 12'.", 'es-AR'],
    ["João Pedro abrió el marcador a los 12' tras un pase de Raphael Veiga.", 'es-AR'],
    ["Memphis Depay estrelló un tiro de penal en el travesaño a los 58'.", 'es-AR'],
    ["Memphis Depay pateó desviado un tiro de penal a los 58' y Yuri Alberto marcó a los 30'.", 'es-AR'],
    ["Weverton le atajó un penal a Memphis Depay a los 58' y João Pedro marcó a los 12'.", 'es-MX'],
    // desfecho
    ['O Corinthians conquistou a vitória por 2 a 1, mas foi eliminado nos pênaltis.'],
    ["O Corinthians passou à frente aos 30', mas o Palmeiras se classificou nos pênaltis."],
    ['Depois do gol, o Corinthians passou a pressionar, mas o Palmeiras avançou.'],
    ['O Palmeiras venceu o Corinthians nos pênaltis, que acabou eliminado.'],
    ['O Palmeiras bateu o Corinthians, que foi eliminado apesar da vitória por 2 a 1.'],
    ['O Palmeiras eliminou o Corinthians, que venceu por 2 a 1 mas ficou fora da final.'],
    ['O Palmeiras, que esteve perto de ser eliminado, se classificou nos pênaltis.'],
    ['O Palmeiras evitou ser eliminado e avançou para a final.'],
    ['O Corinthians foi eliminado nos pênaltis apesar de vencer por 2 a 1.'],
    ['Eliminado nos pênaltis, o Corinthians se despediu da Libertadores.'],
    ['O Corinthians até venceu por 2 a 1, mas quem avançou foi o Palmeiras.'],
    ['Quem avançou foi o Palmeiras, que perdeu por 2 a 1 para o Corinthians.'],
    ['A vaga na final ficou com o Palmeiras.'],
    ['Mesmo com a derrota por 2 a 1 para o Corinthians, o Verdão avançou para a final.'],
    ['O Timão venceu por 2 a 1, mas o Verdão se classificou nos pênaltis por 4 a 3.'],
    ['Corinthians ganó 2-1 pero Palmeiras se clasificó a la final por penales.', 'es-AR'],
    ["Corinthians se metió en el partido a los 30', pero Palmeiras se clasificó.", 'es-AR'],
    ['Corinthians pasó a ganar, pero Palmeiras se clasificó por penales.', 'es-AR'],
    ['Palmeiras venció a Corinthians, que quedó eliminado pese a ganar 2-1.', 'es-AR'],
    ['Corinthians conquistó el triunfo 2-1, pero quedó afuera por penales.', 'es-AR'],
    ['Palmeiras eliminó a Corinthians por penales tras el 3-3 en el global.', 'es-CO'],
    ['Pese a la derrota ante Corinthians, Palmeiras avanzó a la final.', 'es-CL'],
    ['O Corinthians caiu nos pênaltis e o Palmeiras está na final.'],
    ['O Palmeiras despachou o Corinthians e garantiu vaga na final.'],
    [
      'Palmeiras e Corinthians empataram no agregado, e o Palmeiras levou a melhor nos pênaltis por 4 a 3, eliminando o rival.',
    ],
    ['O Corinthians saiu na frente e passou a dominar, mas o Palmeiras se classificou.'],
    ['O Corinthians, que precisava vencer por dois gols, ficou pelo caminho.'],
  ];

  it.each(cases)('%s', (text, locale) => {
    // o goleiro citado numa frase de gol continua barrado, como antes (ele não participou de gol)
    expect(run(text, locale)).toEqual(/^Weverton/.test(text) ? ['wrong_scorer:weverton'] : []);
  });

  it('siglas de 3 letras não entram no desfecho ("SAO" × "são")', () => {
    const s = new FactSheetBuilder()
      .name('São Paulo', 'SAO', 'Palmeiras', 'PAL')
      .score(2, 1, { result: true })
      .number(2, 1)
      .outcome(['São Paulo', 'SAO'], ['Palmeiras', 'PAL'])
      .build();
    for (const t of [
      'Mesmo com a vitória por 2 a 1, os palmeirenses são eliminados.',
      'O Palmeiras, atual campeão, foi eliminado pelo São Paulo.',
      'O São Paulo conquistou a vaga na final.',
      'O Palmeiras conquistou o primeiro gol, mas o São Paulo virou.',
      'O São Paulo eliminou o Palmeiras, que perdeu a chance de ser campeão.',
      'O Palmeiras ficou com o gostinho da vitória, mas o São Paulo avançou.',
      'Palmeiras dominó, pero São Paulo pasó a la final.',
      'São Paulo avanzó a la final; Palmeiras, que había ganado la ida, quedó afuera.',
    ]) {
      const locale = /dominó|avanzó/.test(t) ? 'es-AR' : 'pt-BR';
      expect(
        checkFacts(t, s, locale).filter((v) => v.kind === 'wrong_outcome'),
        t,
      ).toEqual([]);
    }
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

describe('splitSentences', () => {
  it('a inicial de um nome não encerra a frase', () => {
    expect(splitSentences("Gols do Vasco: J. Rodríguez (35') e M. Hinestroza (88'). Fim.")).toEqual([
      "Gols do Vasco: J. Rodríguez (35') e M. Hinestroza (88').",
      'Fim.',
    ]);
    expect(splitSentences('Venceu. Depois empatou! E agora?')).toHaveLength(3);
  });
});
