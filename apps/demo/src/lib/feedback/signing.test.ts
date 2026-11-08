import { describe, expect, it } from 'vitest';

import { FEEDBACK_LINK_TTL_S, feedbackRef, signAttachmentPath, verifyAttachmentLink } from './signing';

const S = 'segredo-de-teste';
const KEY = '2026-11/0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.png';

describe('referências opacas', () => {
  it('estáveis, por tipo, e não mostram o id', () => {
    const u = feedbackRef(S, 'u', 'user-123');
    expect(u).toMatch(/^u_[0-9a-f]{12}$/);
    expect(feedbackRef(S, 'u', 'user-123')).toBe(u);
    expect(feedbackRef(S, 't', 'user-123')).not.toBe(u.replace('u_', 't_'));
    expect(feedbackRef('outro', 'u', 'user-123')).not.toBe(u);
    expect(u).not.toContain('123');
  });
});

describe('link assinado do anexo', () => {
  const path = signAttachmentPath(S, KEY, 1000);
  const url = new URL(`https://x${path}`);
  const e = url.searchParams.get('e');
  const s = url.searchParams.get('s');

  it('vale com a assinatura certa, dentro do prazo', () => {
    expect(url.pathname).toBe(`/api/feedback/anexo/${KEY}`);
    expect(Number(e)).toBe(1000 + FEEDBACK_LINK_TTL_S);
    expect(verifyAttachmentLink(S, KEY, e, s, 2000)).toBe(true);
  });

  it('recusa vencido, outra chave, outro prazo, outro segredo e chave fora do formato', () => {
    expect(verifyAttachmentLink(S, KEY, e, s, 1000 + FEEDBACK_LINK_TTL_S + 1)).toBe(false);
    expect(verifyAttachmentLink(S, KEY.replace('.png', '.jpg'), e, s, 2000)).toBe(false);
    expect(verifyAttachmentLink(S, KEY, String(Number(e) + 1), s, 2000)).toBe(false);
    expect(verifyAttachmentLink('outro', KEY, e, s, 2000)).toBe(false);
    expect(verifyAttachmentLink(S, `../${KEY}`, e, s, 2000)).toBe(false);
    expect(verifyAttachmentLink(S, KEY, null, s, 2000)).toBe(false);
    expect(verifyAttachmentLink(S, KEY, e, 'x', 2000)).toBe(false);
  });
});
