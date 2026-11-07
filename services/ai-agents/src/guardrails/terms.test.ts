import { describe, expect, it } from 'vitest';
import { STAKE_FAMILIES, STAKE_LOCALES, stakeText, type StakeFamily } from '@galaxie/rules';
import { checkGeneratedText, rivalryAllowed } from './check.js';
import { FactSheetBuilder } from './facts.js';
import { checkLength, MAX_LENGTH } from './length.js';
import { findForbiddenTerms } from './terms.js';
import { AGENT_LOCALES, detectLanguage } from './text.js';

describe('termos proibidos por locale', () => {
  it('nenhum rótulo fixo de stakes cai no filtro (sem falso positivo nos textos determinísticos)', () => {
    for (const locale of STAKE_LOCALES) {
      for (const family of STAKE_FAMILIES as readonly StakeFamily[]) {
        for (const n of [0, 1, 2]) {
          const text = stakeText({ family, params: { n, zone: 'libertadores' } }, locale);
          expect(findForbiddenTerms(text, locale), `${locale} ${family}: ${text}`).toEqual([]);
        }
      }
    }
  });

  it.each([
    ['pt-BR', 'O time foi um bando de idiotas em campo.', 'insult'],
    ['pt-BR', 'A torcida chamou o atacante de macaco.', 'discrimination'],
    ['pt-BR', 'Foi uma guerra no gramado.', 'violence'],
    ['pt-BR', 'O clássico lembrou a tragédia de 2016.', 'tragedy'],
    ['es-AR', 'Son unos pelotudos.', 'insult'],
    ['es-MX', 'El grito de puto en la tribuna.', 'discrimination'],
    ['es-CO', 'Partido de gonorreas.', 'insult'],
    ['es-CL', 'Jugaron como weones.', 'insult'],
    ['es-PE', 'Qué cojudos.', 'insult'],
    ['es-UY', 'Hubo una golpiza en la tribuna.', 'violence'],
    ['es-EC', 'Le dijeron mono al delantero.', 'discrimination'],
  ])('%s: barra "%s"', (locale, text, category) => {
    expect(findForbiddenTerms(text, locale).map((h) => h.category)).toContain(category);
  });

  it('rivalidade só passa com rival declarado', () => {
    const text = 'Hoje é dia de secar o rival.';
    expect(findForbiddenTerms(text, 'pt-BR').map((h) => h.category)).toEqual(['rivalry']);
    expect(rivalryAllowed('rival', 'explicit')).toBe(true);
    expect(rivalryAllowed('rival', 'inferred')).toBe(false);
    expect(rivalryAllowed(null, null)).toBe(false);
    expect(findForbiddenTerms(text, 'pt-BR', { allowRivalry: rivalryAllowed('rival', 'explicit') })).toEqual(
      [],
    );
  });

  it('nome oficial que contém termo da lista é liberado pelo allowPhrases', () => {
    expect(findForbiddenTerms('Gil marcou o gol.', 'es-AR').length).toBe(1);
    expect(findForbiddenTerms('Gil marcou o gol.', 'es-AR', { allowPhrases: ['Gil'] })).toEqual([]);
  });

  it('allowPhrases só libera a palavra inteira, não um pedaço de termo proibido', () => {
    const hits = findForbiddenTerms('Gil marcó, pero son unos giles.', 'es-AR', { allowPhrases: ['Gil'] });
    expect(hits.map((h) => h.match)).toEqual(['giles']);
    expect(findForbiddenTerms('Um time de vagabundos.', 'pt-BR', { allowPhrases: ['Vaga'] }).length).toBe(1);
  });

  it('expressões comuns do futebol não são barradas', () => {
    for (const text of [
      'Cobrou o tiro livre.',
      'Chutou uma bomba de fora da área.',
      'O time ainda briga pelo título.',
    ])
      expect(findForbiddenTerms(text, 'pt-BR')).toEqual([]);
    expect(findForbiddenTerms('Sigue en la pelea por el título con un tiro libre.', 'es-AR')).toEqual([]);
  });
});

describe('tamanho e idioma', () => {
  it('limites por superfície', () => {
    expect(checkLength('Curto.', 'tv')).toEqual([]);
    const long = `${'a'.repeat(MAX_LENGTH.tv.sentence + 1)}.`;
    expect(checkLength(long, 'tv').map((v) => v.kind)).toContain('sentence_too_long');
    expect(checkLength('Uma. Duas. Três. Quatro.', 'tv').map((v) => v.kind)).toContain('too_many_sentences');
    expect(checkLength('   ', 'web').map((v) => v.kind)).toEqual(['empty']);
  });

  it('detecta pt × es', () => {
    expect(
      detectLanguage('O Palmeiras precisa de uma vitória para avançar à próxima fase da competição.'),
    ).toBe('pt');
    expect(
      detectLanguage('El equipo necesita una victoria para avanzar en la competición y el torneo.'),
    ).toBe('es');
    expect(detectLanguage('Palmeiras 4-1.')).toBeNull();
  });

  it('inglês: texto em espanhol para `en` é idioma errado (o caso Vitória × Fluminense)', () => {
    const es =
      'Fluminense venció 3 a 0 a Vitoria por la fecha 34 del Brasileirão Série A. Con este resultado, Fluminense sigue en el puesto 4 con 57 puntos.';
    expect(detectLanguage(es)).toBe('es');
    expect(checkGeneratedText(es, { locale: 'en' }).map((x) => x.kind)).toContain('wrong_language');
    const en =
      'Fluminense beat Vitória 3-0 on matchday 34 of the Brasileirão Série A. With the win, Fluminense stays 4th with 57 points.';
    expect(detectLanguage(en)).toBe('en');
    expect(checkGeneratedText(en, { locale: 'en' }).map((x) => x.kind)).not.toContain('wrong_language');
    expect(checkGeneratedText(en, { locale: 'es-AR' }).map((x) => x.kind)).toContain('wrong_language');
  });

  it('"se for" em pt-BR não é inglês (o "for" não é marca de idioma)', () => {
    for (const pt of [
      'Se o Palmeiras for campeão, o Flamengo fica fora. Se for empate, decide nos pênaltis.',
      'Se o Santos for derrotado, cai.',
    ])
      expect(
        checkGeneratedText(pt, { locale: 'pt-BR' }).map((x) => x.kind),
        pt,
      ).not.toContain('wrong_language');
  });

  it('nomes próprios dos fatos não puxam o idioma (Vitória, São Paulo, Defensa y Justicia)', () => {
    const facts = new FactSheetBuilder()
      .name('Vitória', 'São Paulo', 'Brasileirão', 'Defensa y Justicia')
      .number(2, 1)
      .score(2, 1, { result: true })
      .build();
    const en = 'São Paulo beat Vitória 2-1 in the Brasileirão. Defensa y Justicia plays next.';
    expect(checkGeneratedText(en, { locale: 'en', facts }).map((x) => x.kind)).not.toContain(
      'wrong_language',
    );
  });

  it('inglês: termos proibidos', () => {
    expect(findForbiddenTerms('Palmeiras humiliated Corinthians.', 'en').map((h) => h.category)).toEqual([
      'rivalry',
    ]);
    expect(findForbiddenTerms('A bloodbath at the stadium.', 'en').map((h) => h.category)).toContain(
      'violence',
    );
    expect(findForbiddenTerms('Fluminense stays stable in 4th place with good shooting.', 'en')).toEqual([]);
  });

  it('checkGeneratedText junta tudo', () => {
    const v = checkGeneratedText('El Palmeiras necesita ganar y el partido es muy importante para los dos.', {
      locale: 'pt-BR',
      surface: 'tv',
    });
    expect(v.map((x) => x.kind)).toContain('wrong_language');
    expect(AGENT_LOCALES).toHaveLength(9);
  });
});
