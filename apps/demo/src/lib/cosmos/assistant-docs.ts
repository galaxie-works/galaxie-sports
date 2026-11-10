/**
 * Base de conhecimento do assistente da Cosmos (#1003): os guias públicos da documentação (/docs), no idioma da
 * tela, em trechos por subseção. Busca por palavras nesta etapa (sem embeddings), em `@galaxie/cosmos`.
 */
import type { DocChunk } from '@galaxie/cosmos';

import type { Dictionary } from '@/lib/i18n/dictionary';

/** Guia da documentação → rota da página. */
const GUIDES = {
  start: '/docs',
  auth: '/docs/autenticacao',
  concepts: '/docs/conceitos',
  modules: '/docs/modulos-e-planos',
  realtime: '/docs/tempo-real',
  reference: '/docs/referencia',
} as const;

const clean = (s: string) =>
  s
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(clean(value));
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

/** Trechos da documentação: um por subseção de cada guia, com o título dela quando houver. */
export function docChunks(docs: Dictionary['docs']): DocChunk[] {
  const out: DocChunk[] = [];
  for (const [guide, href] of Object.entries(GUIDES)) {
    const section = (docs as unknown as Record<string, unknown>)[guide];
    if (!section || typeof section !== 'object') continue;
    for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
      const text = strings(value).join(' ');
      if (text.length < 20) continue;
      const title =
        value && typeof value === 'object' && typeof (value as { title?: unknown }).title === 'string'
          ? clean((value as { title: string }).title)
          : `${guide} · ${key}`;
      out.push({ title, href, text: text.slice(0, 1500) });
    }
  }
  return out;
}
