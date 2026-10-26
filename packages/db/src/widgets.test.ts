import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  generatePublishableKey,
  hashPublishableKey,
  isOriginAllowed,
  isPublishableKey,
  isWidgetKind,
  isLoopbackOrigin,
  normalizeAllowedOrigin,
  originsOutsideEnv,
  PUBLISHABLE_KEY_PREFIX,
  PUBLISHABLE_TEST_KEY_PREFIX,
  publishableKeyEnv,
} from './widgets.js';

describe('chave publicável', () => {
  it('gera gs_pk_live_ com 256 bits, prefixo visível e sha256 em hex', () => {
    const a = generatePublishableKey();
    const b = generatePublishableKey();
    expect(a.key).toMatch(/^gs_pk_live_[A-Za-z0-9_-]{43}$/);
    expect(a.key).not.toBe(b.key);
    expect(a.prefix.startsWith(PUBLISHABLE_KEY_PREFIX)).toBe(true);
    expect(a.key.startsWith(a.prefix)).toBe(true);
    expect(a.prefix).toHaveLength(PUBLISHABLE_KEY_PREFIX.length + 8);
    expect(a.keyHash).toBe(createHash('sha256').update(a.key).digest('hex'));
    expect(a.keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hash ignora espaços nas pontas e muda com qualquer caractere', () => {
    const { key, keyHash } = generatePublishableKey();
    expect(hashPublishableKey(` ${key}\n`)).toBe(keyHash);
    expect(hashPublishableKey(key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A'))).not.toBe(keyHash);
  });

  it('reconhece só o formato publicável (a chave secreta não passa)', () => {
    expect(isPublishableKey(generatePublishableKey().key)).toBe(true);
    expect(isPublishableKey(`gs_live_0123456789ab_${'a'.repeat(43)}`)).toBe(false);
    expect(isPublishableKey('gs_pk_live_curta')).toBe(false);
    expect(isPublishableKey(`gs_pk_test_${'a'.repeat(43)}`)).toBe(true);
    expect(isPublishableKey(`gs_pk_prod_${'a'.repeat(43)}`)).toBe(false);
  });

  it('publicável de teste: prefixo gs_pk_test_ e ambiente pelo prefixo', () => {
    const t = generatePublishableKey('test');
    expect(t.key).toMatch(/^gs_pk_test_[A-Za-z0-9_-]{43}$/);
    expect(t.prefix.startsWith(PUBLISHABLE_TEST_KEY_PREFIX)).toBe(true);
    expect(publishableKeyEnv(t.key)).toBe('test');
    expect(publishableKeyEnv(generatePublishableKey().key)).toBe('live');
    expect(publishableKeyEnv('gs_pk_live_curta')).toBeNull();
  });

  it('origens por ambiente: teste só localhost/127.0.0.1/[::1]; produção sem eles', () => {
    for (const o of [
      'http://localhost:3000',
      'https://localhost',
      'http://127.0.0.1:5173',
      'http://[::1]:8080',
    ])
      expect(isLoopbackOrigin(o), o).toBe(true);
    for (const o of ['https://app.exemplo.com', 'https://*.exemplo.com', 'http://localhost.exemplo.com'])
      expect(isLoopbackOrigin(o), o).toBe(false);
    expect(originsOutsideEnv('test', ['http://localhost:3000', 'https://app.exemplo.com'])).toEqual([
      'https://app.exemplo.com',
    ]);
    expect(originsOutsideEnv('live', ['http://localhost:3000', 'https://app.exemplo.com'])).toEqual([
      'http://localhost:3000',
    ]);
  });
});

describe('origens permitidas', () => {
  it('normaliza origens e curingas de subdomínio', () => {
    expect(normalizeAllowedOrigin('https://App.Exemplo.com/')).toBe('https://app.exemplo.com');
    expect(normalizeAllowedOrigin('https://app.exemplo.com:443')).toBe('https://app.exemplo.com');
    expect(normalizeAllowedOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeAllowedOrigin('https://*.exemplo.com')).toBe('https://*.exemplo.com');
    expect(normalizeAllowedOrigin('https://*.exemplo.com:8443')).toBe('https://*.exemplo.com:8443');
  });

  it('recusa origens inválidas e curingas largos demais', () => {
    for (const bad of [
      '*',
      'exemplo.com',
      'ftp://exemplo.com',
      'https://exemplo.com/app',
      'https://exemplo.com?x=1',
      'https://*.com',
      'https://*.localhost',
      'https://app.*.exemplo.com',
      'https://*exemplo.com',
      'https://*.10.0.0.1',
      'null',
    ])
      expect(normalizeAllowedOrigin(bad), bad).toBeNull();
  });

  it('aceita origem exata (esquema, host e porta)', () => {
    const allowed = ['https://app.exemplo.com', 'http://localhost:3000'];
    expect(isOriginAllowed('https://app.exemplo.com', allowed)).toBe(true);
    expect(isOriginAllowed('https://APP.exemplo.com', allowed)).toBe(true);
    expect(isOriginAllowed('http://localhost:3000', allowed)).toBe(true);
    expect(isOriginAllowed('http://app.exemplo.com', allowed)).toBe(false);
    expect(isOriginAllowed('https://app.exemplo.com:8443', allowed)).toBe(false);
    expect(isOriginAllowed('http://localhost:3001', allowed)).toBe(false);
    expect(isOriginAllowed('https://outra.exemplo.com', allowed)).toBe(false);
  });

  it('curinga cobre subdomínios de qualquer nível, mas não o domínio raiz nem sufixos parecidos', () => {
    const allowed = ['https://*.exemplo.com'];
    expect(isOriginAllowed('https://app.exemplo.com', allowed)).toBe(true);
    expect(isOriginAllowed('https://a.b.exemplo.com', allowed)).toBe(true);
    expect(isOriginAllowed('https://exemplo.com', allowed)).toBe(false);
    expect(isOriginAllowed('https://appexemplo.com', allowed)).toBe(false);
    expect(isOriginAllowed('https://exemplo.com.atacante.net', allowed)).toBe(false);
    expect(isOriginAllowed('http://app.exemplo.com', allowed)).toBe(false);
    expect(isOriginAllowed('https://app.exemplo.com:8443', allowed)).toBe(false);
  });

  it('origem ausente, opaca ou malformada nunca passa', () => {
    const allowed = ['https://app.exemplo.com'];
    for (const o of [undefined, null, '', 'null', 'https://app.exemplo.com/caminho', 'file://x'])
      expect(isOriginAllowed(o, allowed), String(o)).toBe(false);
  });
});

describe('tipos de widget', () => {
  it('valida os quatro tipos', () => {
    for (const k of ['match_card', 'live_list', 'standings', 'where_to_watch'])
      expect(isWidgetKind(k)).toBe(true);
    expect(isWidgetKind('bracket')).toBe(false);
    expect(isWidgetKind(undefined)).toBe(false);
  });
});
