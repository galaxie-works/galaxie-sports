import { describe, expect, it } from 'vitest';

import { FeedbackLimiter } from './limiter';
import { checkFeedbackText, maskEmail, maskHalf, sniffImage, titleSnippet } from './rules';

describe('mascaramento', () => {
  it('esconde metade do usuário (o fim) e metade do domínio (o começo)', () => {
    expect(maskEmail('wagner@galaxie.works')).toBe('wag***@*******.works');
    expect(maskEmail('ana@x.io')).toBe('a**@**io');
  });

  it('tenant com metade escondida, contando caracteres e não bytes', () => {
    expect(maskHalf('Portal Esporte')).toBe('Portal ' + '*'.repeat(7));
    expect(maskHalf('São')).toBe('S**');
    expect(maskHalf('x')).toBe('*');
    expect(maskHalf('')).toBe('');
  });

  it('e-mail sem @ é mascarado inteiro pela metade', () => {
    expect(maskEmail('semarroba')).toBe('sema*****');
  });
});

describe('título', () => {
  it('primeiros 50 caracteres numa linha, com reticências quando corta', () => {
    expect(titleSnippet('curto\n\n  demais')).toBe('curto demais');
    const long = 'a'.repeat(60);
    expect(titleSnippet(long)).toBe(`${'a'.repeat(50)}…`);
  });
});

describe('conferências', () => {
  it('assunto e mensagem', () => {
    expect(checkFeedbackText('nope', 'mensagem longa o bastante')).toBe('subject');
    expect(checkFeedbackText('bug', 'curta')).toBe('message');
    expect(checkFeedbackText('bug', 'x'.repeat(4001))).toBe('tooLong');
    expect(checkFeedbackText('content', 'o escudo do time está errado')).toBeNull();
  });

  it('imagem pela assinatura, não pela extensão', () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(new TextEncoder().encode('<svg></svg>'))).toBeNull();
  });
});

describe('teto por usuário', () => {
  it('passa até o teto na janela e devolve a reserva de envio que falhou', () => {
    const l = new FeedbackLimiter(2, 1000, 100, 10_000);
    expect(l.take('u', 0)).toBe(true);
    expect(l.take('u', 1)).toBe(true);
    expect(l.take('u', 2)).toBe(false);
    l.release('u', 1);
    expect(l.take('u', 3)).toBe(true);
    expect(l.take('outro', 3)).toBe(true);
    expect(l.take('u', 1500)).toBe(true);
  });
});

describe('teto do dia para todos', () => {
  it('para no total do dia mesmo com usuários diferentes', () => {
    const l = new FeedbackLimiter(5, 1000, 2, 10_000);
    expect(l.take('a', 0)).toBe(true);
    expect(l.take('b', 1)).toBe(true);
    expect(l.take('c', 2)).toBe(false);
    expect(l.take('c', 10_001)).toBe(true);
  });
});
