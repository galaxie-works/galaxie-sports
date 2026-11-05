import { describe, expect, it } from 'vitest';
import { devDatabaseWarning, isDevDatabaseUrl } from './dev-database.js';

describe('URL do Postgres de dev', () => {
  it('reconhece o host do NAS e a porta 5433', () => {
    expect(isDevDatabaseUrl('postgres://galaxie:x@192.168.1.34:5433/galaxie_sports')).toBe(true);
    expect(isDevDatabaseUrl('postgresql://galaxie:x@192.168.1.34/galaxie_sports')).toBe(true);
    expect(isDevDatabaseUrl('postgres://galaxie:x@localhost:5433/galaxie_sports')).toBe(true);
  });

  it('produção, localhost na porta padrão e URL inválida não são dev', () => {
    expect(isDevDatabaseUrl('postgres://galaxie:x@postgres:5432/galaxie_sports')).toBe(false);
    expect(isDevDatabaseUrl('postgres://galaxie:x@localhost:5432/galaxie_sports')).toBe(false);
    expect(isDevDatabaseUrl('postgres://galaxie:x@127.0.0.1/galaxie_sports')).toBe(false);
    expect(isDevDatabaseUrl('não é url')).toBe(false);
    expect(isDevDatabaseUrl(undefined)).toBe(false);
    expect(isDevDatabaseUrl('')).toBe(false);
  });

  it('o aviso nomeia o arquivo e só sai no dev', () => {
    const aviso = devDatabaseWarning(
      'postgres://g:x@192.168.1.34:5433/galaxie_sports',
      'o manifesto do acervo',
    );
    expect(aviso).toContain('DEV');
    expect(aviso).toContain('O manifesto do acervo é gerado contra a PRODUÇÃO');
    expect(devDatabaseWarning('postgres://g:x@postgres:5432/galaxie_sports', 'o manifesto')).toBeUndefined();
  });
});
