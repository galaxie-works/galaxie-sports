import { searchDocs } from '@galaxie/cosmos';
import { describe, expect, it } from 'vitest';

import { LOCALES } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionary';

import { docChunks } from './assistant-docs';

describe('base de conhecimento do assistente', () => {
  it.each(LOCALES)('%s: trechos dos guias públicos, sem marcação, com rota', (locale) => {
    const chunks = docChunks(getDictionary(locale).docs);
    expect(chunks.length).toBeGreaterThan(10);
    for (const c of chunks) {
      expect(c.href.startsWith('/docs')).toBe(true);
      expect(c.text).not.toMatch(/<c>|<b>/);
    }
  });

  it('acha o guia de webhooks pela pergunta', () => {
    const hits = searchDocs('como assinar o webhook com HMAC', docChunks(getDictionary('pt-BR').docs));
    expect(hits[0]?.href).toBe('/docs/tempo-real');
  });
});
