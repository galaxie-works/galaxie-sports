import { describe, expect, it } from 'vitest';

import { CONTENT_SECURITY_POLICY, securityHeaders } from './security-headers';

const asMap = (production: boolean) =>
  new Map(securityHeaders({ production }).map((h) => [h.key.toLowerCase(), h.value]));

describe('cabeçalhos de segurança', () => {
  it('sempre: só a própria demo em iframe, nosniff e Referrer-Policy', () => {
    for (const production of [true, false]) {
      const h = asMap(production);
      expect(h.get('content-security-policy')).toBe("frame-ancestors 'self'");
      expect(h.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(h.get('x-content-type-options')).toBe('nosniff');
      expect(h.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    }
  });

  it('produção: HSTS e a CSP completa em observação; dev sem eles', () => {
    expect(asMap(true).get('strict-transport-security')).toMatch(/^max-age=\d+$/);
    expect(asMap(true).get('content-security-policy-report-only')).toBe(CONTENT_SECURITY_POLICY);
    expect(asMap(false).has('strict-transport-security')).toBe(false);
    expect(asMap(false).has('content-security-policy-report-only')).toBe(false);
  });

  it('a CSP cobre o player do YouTube sem cookies e não abre plugins nem base externa', () => {
    const directives = new Map(
      CONTENT_SECURITY_POLICY.split('; ').map((d) => {
        const [name, ...values] = d.split(' ');
        return [name!, values];
      }),
    );
    expect(directives.get('frame-src')).toContain('https://www.youtube-nocookie.com');
    expect(directives.get('script-src')).toContain('https://www.youtube.com');
    expect(directives.get('script-src')).not.toContain("'unsafe-eval'");
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'self'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'self'"]);
  });
});
