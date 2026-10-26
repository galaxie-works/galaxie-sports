import { describe, expect, it } from 'vitest';

import { isEngaged } from './animated-sport-icon';

/** Gatilho falso: responde `matches` como o navegador, só para `:hover` e `:focus-within`. */
function trigger(state: { hover?: boolean; focusWithin?: boolean }) {
  return {
    matches: (selector: string) =>
      selector
        .split(',')
        .map((s) => s.trim())
        .some((s) => (s === ':hover' && !!state.hover) || (s === ':focus-within' && !!state.focusWithin)),
  };
}

describe('isEngaged', () => {
  it('reconhece hover ou foco que começou antes de a animação carregar', () => {
    expect(isEngaged(trigger({ hover: true }))).toBe(true);
    expect(isEngaged(trigger({ focusWithin: true }))).toBe(true);
  });

  it('sem hover nem foco, a animação fica parada', () => {
    expect(isEngaged(trigger({}))).toBe(false);
  });
});
