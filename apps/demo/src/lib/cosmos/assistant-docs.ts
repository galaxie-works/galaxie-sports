/**
 * Base de conhecimento do assistente da Cosmos: os guias públicos da documentação (/docs), no idioma da tela, em
 * trechos por subseção, e o contrato da API (OpenAPI), um trecho por operação. A busca (por palavras e por
 * significado) fica em `@galaxie/cosmos` (`searchKnowledge`).
 */
import type { DocChunk } from '@galaxie/cosmos';

import { operationAnchor } from '@/lib/galaxie/request';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { groupByTag, type OpenApiDoc, type Schema } from '@/lib/openapi-reference';

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
      out.push({ title, href, text: text.slice(0, CHUNK_MAX) });
    }
  }
  return out;
}

const REFERENCE_HREF = '/docs/referencia';
const CHUNK_MAX = 1500;

const typeOf = (s: Schema | undefined): string =>
  !s ? '' : s.$ref ? s.$ref.split('/').pop()! : Array.isArray(s.type) ? s.type.join('|') : (s.type ?? '');

/**
 * Trechos do contrato da API: um por operação, com método, rota, resumo, descrição, parâmetros e respostas. O
 * contrato é publicado em pt-BR; o assistente responde no idioma da tela.
 */
export function apiChunks(doc: OpenApiDoc): DocChunk[] {
  const out: DocChunk[] = [];
  for (const [tag, ops] of groupByTag(doc))
    for (const { method, route, op } of ops) {
      const params = (op.parameters ?? []).map(
        (p) =>
          `${p.name} (${p.in}${p.required ? ', required' : ''}${p.schema ? `, ${typeOf(p.schema)}` : ''})${p.description ? `: ${clean(p.description)}` : ''}`,
      );
      const responses = Object.entries(op.responses ?? {}).map(
        ([code, r]) => `${code}${r.description ? `: ${clean(r.description)}` : ''}`,
      );
      const text = [
        `${method.toUpperCase()} ${route}`,
        op.summary ? clean(op.summary) : '',
        op.description ? clean(op.description) : '',
        params.length ? `parameters: ${params.join('; ')}` : '',
        responses.length ? `responses: ${responses.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      out.push({
        title: `${tag} · ${method.toUpperCase()} ${route}${op.summary ? ` (${clean(op.summary)})` : ''}`,
        href: `${REFERENCE_HREF}#${operationAnchor(method, route)}`,
        text: text.slice(0, CHUNK_MAX),
      });
    }
  return out;
}
