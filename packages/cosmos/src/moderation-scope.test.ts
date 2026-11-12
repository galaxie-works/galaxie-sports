import { describe, expect, it } from 'vitest';

import { reservationScope } from './moderation-run.js';

describe('escopo da reserva da moderação', () => {
  it('sala e comunidade no formato da cota por sala; sem lugar, o módulo', () => {
    expect(reservationScope({ room: 'r1', community: null, module: 'chat' })).toBe('chat:r1');
    expect(reservationScope({ room: null, community: 'c1', module: 'communities' })).toBe('community:c1');
    expect(reservationScope({ room: null, community: null, module: 'profile' })).toBe('moderation.profile');
  });
});
