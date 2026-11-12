import { searchDocs } from '@galaxie/cosmos';
import { describe, expect, it } from 'vitest';

import { LOCALES } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionary';
import { openApiDocument } from '@/lib/openapi-reference';

import { apiChunks, docChunks } from './assistant-docs';

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

  it('contrato da API: um trecho por operação, com âncora da referência e parâmetros', () => {
    const chunks = apiChunks(openApiDocument());
    expect(chunks.length).toBeGreaterThan(20);
    for (const c of chunks) {
      expect(c.href).toMatch(/^\/docs\/referencia#[a-z0-9-]+$/);
      expect(c.text).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \//);
      expect(c.text.length).toBeLessThanOrEqual(1500);
    }
    expect(chunks.some((c) => c.text.includes('parameters:'))).toBe(true);
  });

  it('a busca por palavras acha a operação da API', () => {
    const chunks = apiChunks(openApiDocument());
    const route = chunks[0]!.text.split('\n')[0]!.split(' ')[1]!;
    const word = route
      .split('/')
      .filter((w) => w.length > 3 && !w.startsWith('{'))
      .pop()!;
    const hits = searchDocs(`endpoint ${word}`, chunks);
    expect(hits.some((h) => h.text.includes(word))).toBe(true);
  });
});
