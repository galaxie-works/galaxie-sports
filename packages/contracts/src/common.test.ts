import { describe, expect, it } from 'vitest';
import { LocaleQuery } from './common.js';

describe('LocaleQuery.tz', () => {
  const ok = (tz: string) => LocaleQuery.safeParse({ tz }).success;

  it('aceita nomes IANA, em qualquer grafia', () => {
    for (const tz of ['UTC', 'America/Sao_Paulo', 'america/sao_paulo', 'Etc/GMT+3', 'US/Eastern'])
      expect(ok(tz)).toBe(true);
  });

  it('recusa offsets fixos (o Intl aceita milhares de grafias e cada uma reteria um formatador na API)', () => {
    for (const tz of ['+01', '+0100', '+01:00', '-03:00']) expect(ok(tz)).toBe(false);
  });

  it('recusa fuso inexistente', () => {
    expect(ok('Mars/Olympus_Mons')).toBe(false);
  });
});
