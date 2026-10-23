import { describe, expect, it } from 'vitest';

import { getDictionary } from './i18n/dictionary';
import { sessionLabel } from './race-session';

describe('nome da sessão de corrida', () => {
  const en = getDictionary('en').sport;
  const pt = getDictionary('pt-BR').sport;

  it('sai no idioma da tela, não no espanhol da API', () => {
    expect(sessionLabel({ type: 'race', number: null, name: 'Carrera' }, en)).toBe('Race');
    expect(sessionLabel({ type: 'qualifying', number: 3, name: 'Clasificación - Q3' }, en)).toBe(
      'Qualifying · Q3',
    );
    expect(sessionLabel({ type: 'practice', number: 2, name: 'Práctica 2' }, pt)).toBe('Treino livre 2');
    expect(sessionLabel({ type: 'practice', number: null, name: 'Práctica' }, pt)).toBe('Treino livre');
    expect(sessionLabel(null, pt)).toBeNull();
  });
});
