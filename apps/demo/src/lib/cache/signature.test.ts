import { describe, expect, it } from 'vitest';

import { bodyMatches, signRevalidate, verifyRevalidate, verifyRevalidateHeader } from './signature';

const SECRET = 'segredo-de-teste';
const NOW = 1_800_000_000_000;
const UNIX = NOW / 1000;
const BODY = JSON.stringify({ tags: ['f1_editorial'] });

describe('assinatura da revalidação', () => {
  it('aceita a assinatura do mesmo corpo e segredo dentro da janela', () => {
    expect(verifyRevalidate(signRevalidate(SECRET, UNIX, BODY), SECRET, BODY, NOW)).toBe(true);
    expect(verifyRevalidate(signRevalidate(SECRET, UNIX - 200, BODY), SECRET, BODY, NOW)).toBe(true);
  });

  it('recusa outro corpo, outro segredo, fora da janela ou sem header', () => {
    const header = signRevalidate(SECRET, UNIX, BODY);
    expect(verifyRevalidate(header, SECRET, JSON.stringify({ tags: ['event'] }), NOW)).toBe(false);
    expect(verifyRevalidate(header, 'outro', BODY, NOW)).toBe(false);
    expect(verifyRevalidate(signRevalidate(SECRET, UNIX - 301, BODY), SECRET, BODY, NOW)).toBe(false);
    expect(verifyRevalidate(null, SECRET, BODY, NOW)).toBe(false);
    expect(verifyRevalidate(header, undefined, BODY, NOW)).toBe(false);
    expect(verifyRevalidate('abc.def', SECRET, BODY, NOW)).toBe(false);
  });

  it('o header sozinho já recusa quem não tem o segredo (antes de ler o corpo)', () => {
    const header = signRevalidate(SECRET, UNIX, BODY);
    const signed = verifyRevalidateHeader(header, SECRET, NOW);
    expect(signed).not.toBeNull();
    expect(bodyMatches(signed!.digest, BODY)).toBe(true);
    expect(bodyMatches(signed!.digest, `${BODY} `)).toBe(false);
    expect(verifyRevalidateHeader(header, 'outro', NOW)).toBeNull();
    // resumo trocado no header: o HMAC não bate
    const [ts, , mac] = header.split('.');
    expect(verifyRevalidateHeader(`${ts}.${'0'.repeat(64)}.${mac}`, SECRET, NOW)).toBeNull();
    expect(verifyRevalidateHeader(`${header}.extra`, SECRET, NOW)).toBeNull();
  });
});
