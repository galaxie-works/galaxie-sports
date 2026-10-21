import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseTopics, validateWebhookUrl, WebhookInputError } from './admin.js';
import { generateWebhookSecret, signWebhook, verifyWebhookSignature } from './signature.js';
import { retryDelayMs } from './worker.js';

describe('assinatura HMAC-SHA256', () => {
  const secret = generateWebhookSecret();
  const body = JSON.stringify({ id: '1', topic: 'event.score_changed' });

  it('assina t.corpo e verifica em tempo constante', () => {
    const header = signWebhook(secret, body, 1_800_000_000);
    const v1 = createHmac('sha256', secret).update(`1800000000.${body}`).digest('hex');
    expect(header).toBe(`t=1800000000,v1=${v1}`);
    expect(verifyWebhookSignature(secret, body, header, { nowSec: 1_800_000_010 })).toBe(true);
  });

  it('rejeita corpo alterado, segredo errado, timestamp fora da janela e header malformado', () => {
    const header = signWebhook(secret, body, 1_800_000_000);
    const now = { nowSec: 1_800_000_000 };
    expect(verifyWebhookSignature(secret, `${body} `, header, now)).toBe(false);
    expect(verifyWebhookSignature(generateWebhookSecret(), body, header, now)).toBe(false);
    expect(verifyWebhookSignature(secret, body, header, { nowSec: 1_800_000_301 })).toBe(false);
    expect(verifyWebhookSignature(secret, body, 'v1=abc', now)).toBe(false);
    expect(verifyWebhookSignature(secret, body, undefined, now)).toBe(false);
  });

  it('segredos são únicos e com prefixo', () => {
    expect(generateWebhookSecret()).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});

describe('retentativas', () => {
  it('dobram a cada falha, com teto e jitter de ±20%', () => {
    const mid = () => 0.5;
    expect([1, 2, 3, 4].map((a) => retryDelayMs(a, 10_000, 3_600_000, mid))).toEqual([
      10_000, 20_000, 40_000, 80_000,
    ]);
    expect(retryDelayMs(20, 10_000, 3_600_000, mid)).toBe(3_600_000);
    expect(retryDelayMs(1, 10_000, 3_600_000, () => 0)).toBe(8_000);
    expect(retryDelayMs(1, 10_000, 3_600_000, () => 1)).toBe(12_000);
  });
});

describe('validação do cadastro', () => {
  it('exige https (http só em localhost ou com --allow-http) e URL sem credenciais', () => {
    expect(validateWebhookUrl('https://cliente.example/hooks')).toBe('https://cliente.example/hooks');
    expect(validateWebhookUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x');
    expect(() => validateWebhookUrl('http://cliente.example/x')).toThrow(WebhookInputError);
    expect(validateWebhookUrl('http://cliente.example/x', true)).toBe('http://cliente.example/x');
    expect(() => validateWebhookUrl('https://u:p@cliente.example/x')).toThrow(WebhookInputError);
    expect(() => validateWebhookUrl('ftp://cliente.example')).toThrow(WebhookInputError);
  });

  it('aceita nomes curtos e completos de tópico', () => {
    expect(parseTopics(['score', 'where_to_watch.changed', 'score'])).toEqual([
      'event.score_changed',
      'where_to_watch.changed',
    ]);
    expect(() => parseTopics(['odds'])).toThrow(WebhookInputError);
  });
});
