import { describe, expect, it } from 'vitest';

import { canManageOrganization } from './permissions';

describe('canManageOrganization', () => {
  it('a equipe Galaxie sempre cuida da organização', () => {
    expect(canManageOrganization({ role: 'admin', memberRole: null, memberSource: null })).toBe(true);
    expect(canManageOrganization({ role: 'support', memberRole: null, memberSource: null })).toBe(true);
  });

  it('só o Dono vindo da organização cuida dela; Dono de uma marca só, não', () => {
    expect(canManageOrganization({ role: 'client', memberRole: 'owner', memberSource: 'organization' })).toBe(
      true,
    );
    expect(canManageOrganization({ role: 'client', memberRole: 'owner', memberSource: 'tenant' })).toBe(
      false,
    );
    expect(canManageOrganization({ role: 'client', memberRole: 'admin', memberSource: 'organization' })).toBe(
      false,
    );
    expect(canManageOrganization({ role: 'client', memberRole: null, memberSource: null })).toBe(false);
  });
});
