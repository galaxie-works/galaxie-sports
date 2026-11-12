import { describe, expect, it } from 'vitest';

import {
  attachmentTokens,
  estimateTaskCredits,
  IMAGE_TOKENS,
  parseModelJson,
  PDF_PAGE_TOKENS,
  pdfPages,
} from './task-run.js';

describe('parseModelJson', () => {
  it('objeto direto, embrulhado em cerca de código ou com texto em volta; o resto é null', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('Aqui está:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseModelJson('[1,2]')).toBeNull();
    expect(parseModelJson('nada')).toBeNull();
  });
});

describe('reserva com anexos', () => {
  const pdf = (pages: number) =>
    Buffer.from(
      `%PDF-1.7\n1 0 obj << /Type /Pages /Count ${pages} >>\n` +
        Array.from({ length: pages }, (_, i) => `${i + 2} 0 obj << /Type /Page /Parent 1 0 R >>`).join('\n'),
      'latin1',
    ).toString('base64');

  it('conta as páginas do PDF (sem confundir com /Pages) e uma imagem por arquivo', () => {
    expect(pdfPages(pdf(3))).toBe(3);
    expect(pdfPages(Buffer.from('sem páginas').toString('base64'))).toBe(1);
    expect(
      attachmentTokens([
        { mediaType: 'application/pdf', data: pdf(2) },
        { mediaType: 'image/jpeg', data: 'AA' },
      ]),
    ).toBe(2 * PDF_PAGE_TOKENS + IMAGE_TOKENS);
  });

  it('a reserva cresce com os anexos', () => {
    const base = {
      model: 'claude-haiku-4-5',
      system: 's',
      message: 'm',
      maxOutputTokens: 100,
      minCredits: 0,
      multiplier: 1,
      settings: { creditUsd: 0.01 } as Parameters<typeof estimateTaskCredits>[0]['settings'],
    };
    expect(
      estimateTaskCredits({ ...base, attachments: [{ mediaType: 'application/pdf', data: pdf(10) }] }),
    ).toBeGreaterThan(estimateTaskCredits(base));
  });
});
