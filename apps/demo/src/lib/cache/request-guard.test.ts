import { describe, expect, it } from 'vitest';

import { BodyTooLargeError, clientAddress, isLoopback, readBodyWithLimit } from './request-guard';

describe('isLoopback / clientAddress', () => {
  it('só o próprio host', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('10.0.0.1')).toBe(false);
    expect(isLoopback('')).toBe(false);
    expect(isLoopback(null)).toBe(false);
  });

  it('a origem é o primeiro endereço do x-forwarded-for', () => {
    expect(clientAddress(new Headers({ 'x-forwarded-for': '203.0.113.9, 127.0.0.1' }))).toBe('203.0.113.9');
    expect(clientAddress(new Headers())).toBeNull();
  });
});

describe('readBodyWithLimit', () => {
  it('lê o corpo dentro do teto', async () => {
    expect(await readBodyWithLimit(new Request('http://x', { method: 'POST', body: 'olá' }), 10)).toBe('olá');
  });

  it('recusa Content-Length acima do teto ou inválido', async () => {
    const req = (len: string) =>
      new Request('http://x', { method: 'POST', body: 'abc', headers: { 'content-length': len } });
    await expect(readBodyWithLimit(req('100'), 10)).rejects.toBeInstanceOf(BodyTooLargeError);
    await expect(readBodyWithLimit(req('-1'), 10)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('recusa corpo maior que o teto mesmo sem Content-Length', async () => {
    await expect(
      readBodyWithLimit(new Request('http://x', { method: 'POST', body: 'x'.repeat(11) }), 10),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});
