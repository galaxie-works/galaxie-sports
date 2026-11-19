import { describe, expect, it } from 'vitest';
import { docsBaseUrl, safeDocsReturn, signDocsPass, verifyDocsPass } from './docs-sso';

const SECRET = 'segredo-de-teste';

describe('passe do login das docs', () => {
  it('assina e confere', () => {
    const t = signDocsPass({ id: 'u1', role: 'admin' }, SECRET, 1_000_000);
    expect(verifyDocsPass(t, SECRET, 1_000_000)).toMatchObject({
      sub: 'u1',
      role: 'admin',
      aud: 'galaxie-docs',
    });
  });
  it('recusa passe vencido, de outro segredo ou adulterado', () => {
    const t = signDocsPass({ id: 'u1' }, SECRET, 0);
    expect(verifyDocsPass(t, SECRET, 61_000)).toBeNull();
    expect(verifyDocsPass(t, 'outro', 0)).toBeNull();
    const [body, sig] = t.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'u2', role: 'admin', aud: 'galaxie-docs', exp: 9e9 }),
    ).toString('base64url');
    expect(verifyDocsPass(`${forged}.${sig}`, SECRET, 0)).toBeNull();
    expect(verifyDocsPass(`${body}`, SECRET, 0)).toBeNull();
  });
  it('só devolve caminhos do próprio site', () => {
    expect(safeDocsReturn('/errors/invalid-key')).toBe('/errors/invalid-key');
    expect(safeDocsReturn('https://evil.test')).toBe('/');
    expect(safeDocsReturn('//evil.test')).toBe('/');
    expect(safeDocsReturn('/\\evil.test')).toBe('/');
    expect(safeDocsReturn(null)).toBe('/');
  });
  it('base pelo DOCS_URL, pelo DOCS_DOMAIN ou o padrão', () => {
    expect(docsBaseUrl({ DOCS_URL: 'http://localhost:3311/' })).toBe('http://localhost:3311');
    expect(docsBaseUrl({ DOCS_DOMAIN: 'docs.exemplo.test' })).toBe('https://docs.exemplo.test');
    expect(docsBaseUrl({})).toBe('https://docs.galaxiesports.com');
  });
});
