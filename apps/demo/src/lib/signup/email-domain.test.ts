import { describe, expect, it } from 'vitest';

import { emailDomain, isFreeEmailDomain, normalizeEmail } from './email-domain';

describe('domínio de e-mail do cadastro (PL2)', () => {
  it.each([
    'gmail.com',
    'googlemail.com',
    'hotmail.com.br',
    'outlook.com',
    'live.com',
    'msn.com',
    'yahoo.com.ar',
    'icloud.com',
    'me.com',
    'aol.com',
    'proton.me',
    'protonmail.com',
    'gmx.de',
    'zoho.com',
    'uol.com.br',
    'bol.com.br',
    'terra.com.br',
    'ig.com.br',
    'GMAIL.COM',
  ])('%s é provedor grátis', (domain) => {
    expect(isFreeEmailDomain(domain)).toBe(true);
  });

  it.each(['empresa.com.br', 'galaxie.works', 'mail.operadora.com', 'gmailcorp.com', 'meu-time.com'])(
    '%s é domínio de empresa',
    (domain) => {
      expect(isFreeEmailDomain(domain)).toBe(false);
    },
  );

  it('normaliza o e-mail e extrai o domínio', () => {
    expect(normalizeEmail('  Ana@Empresa.COM.br ')).toBe('ana@empresa.com.br');
    expect(emailDomain('ana@empresa.com.br')).toBe('empresa.com.br');
    expect(normalizeEmail('sem-arroba')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
});
