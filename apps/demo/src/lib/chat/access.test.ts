import { describe, expect, it } from 'vitest';

import { hasLiveChat } from './access';

describe('painel do chat: quem age no tenant (#1392)', () => {
  it('cliente só com o módulo; a equipe Galaxie em qualquer tenant', () => {
    const without = { modules: ['core_data'] };
    const withChat = { modules: ['core_data', 'live_chat'] };
    expect(hasLiveChat({ role: 'client', tenant: without })).toBe(false);
    expect(hasLiveChat({ role: 'client', tenant: withChat })).toBe(true);
    expect(hasLiveChat({ role: 'admin', tenant: without })).toBe(true);
    expect(hasLiveChat({ role: 'support', tenant: without })).toBe(true);
  });
});
