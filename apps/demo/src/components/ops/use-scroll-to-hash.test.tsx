// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useScrollToHashOnMount } from './use-scroll-to-hash';

function Panel() {
  useScrollToHashOnMount();
  return <div id="AI_RIGHTS_MODEL">linha</div>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('useScrollToHashOnMount', () => {
  it('rola até a linha do #hash quando o painel monta', () => {
    const scroll = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scroll);
    window.history.replaceState(null, '', '/ajustes/ia#AI_RIGHTS_MODEL');
    const { getByText } = render(<Panel />);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(getByText('linha'));
  });

  it('sem #hash, não rola', () => {
    const scroll = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scroll);
    render(<Panel />);
    expect(scroll).not.toHaveBeenCalled();
  });
});
