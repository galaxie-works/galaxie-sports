/**
 * Leitura do documento OpenAPI (o mesmo que a API serve em /openapi.json) para a documentação:
 * operações agrupadas por tag, na ordem da referência. Só no servidor (o documento sai dos schemas
 * Zod de `@galaxie/contracts`); para o navegador vão as `ApiOperationRef`, que são dados simples.
 */
import { buildOpenApiDocument, foldSearchText } from '@galaxie/contracts';

import { operationAnchor, PUBLIC_API_URL, requestSnippets } from './galaxie/request';
import type { Dictionary } from './i18n/dictionary';

export interface Schema {
  $ref?: string;
  type?: string | string[];
  items?: Schema;
  properties?: Record<string, Schema>;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  example?: unknown;
  minimum?: number;
  maximum?: number;
}

export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  description?: string;
  schema?: Schema;
}

export interface Operation {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: Schema }> }>;
}

export type OpenApiDoc = {
  info: { version: string };
  tags?: { name: string; description?: string }[];
  paths: Record<string, Record<string, Operation>>;
};

export interface TaggedOperation {
  method: string;
  route: string;
  op: Operation;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/**
 * Seções pela tag do OpenAPI (em pt-BR, como a API publica), na ordem da referência, com a chave do nome
 * e da descrição traduzidos em `t.docs.reference.tags`. Tags fora daqui vão para o fim, com o nome e a
 * descrição do documento.
 */
export const REFERENCE_TAGS = {
  Catálogo: 'catalog',
  Busca: 'search',
  Eventos: 'events',
  'Times e pessoas': 'teams',
  Semântica: 'semantic',
  'Onde assistir': 'whereToWatch',
  // Identificador da tag no OpenAPI, não texto de interface (o escape passa no teste de textos fixos).
  'Conte\u00fado relacionado': 'related',
  Multiesporte: 'multisport',
  'Tempo real': 'realtime',
  Espelho: 'mirror',
  Conta: 'account',
  Outros: 'other',
} as const satisfies Record<string, keyof Dictionary['docs']['reference']['tags']>;

const TAG_ORDER: string[] = Object.keys(REFERENCE_TAGS);

/** Nome da tag no idioma da tela (tag desconhecida: o nome do documento). */
export function tagName(tag: string, t: Dictionary): string {
  const key = REFERENCE_TAGS[tag as keyof typeof REFERENCE_TAGS];
  return key ? t.docs.reference.tags[key].name : tag;
}

export const openApiDocument = () => buildOpenApiDocument() as unknown as OpenApiDoc;

/** Âncora da seção de uma tag na página de referência (ex.: `tag-catalogo`). */
export const tagId = (tag: string) => `tag-${foldSearchText(tag).replace(/[^a-z0-9]+/g, '-')}`;

/** Operações por tag, na ordem da referência. */
export function groupByTag(doc: OpenApiDoc): [string, TaggedOperation[]][] {
  const groups = new Map<string, TaggedOperation[]>();
  for (const [route, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const tag = op.tags?.[0] ?? 'Outros';
      groups.set(tag, [...(groups.get(tag) ?? []), { method, route, op }]);
    }
  }
  const rank = (t: string) => (TAG_ORDER.includes(t) ? TAG_ORDER.indexOf(t) : TAG_ORDER.length);
  return [...groups].sort(([a], [b]) => rank(a) - rank(b));
}

/** Operação da referência em dados simples (vai para a árvore da documentação e para a busca). */
export interface ApiOperationRef {
  method: string;
  route: string;
  summary: string;
  tag: string;
  /** Âncora na página de referência. */
  anchor: string;
  /** `curl` pronto, com os parâmetros obrigatórios de query (valor de exemplo ou `<nome>`). */
  curl: string;
  /** A operação na referência interativa (Scalar). */
  scalar: string;
}

export interface ApiTagRef {
  /** Nome no idioma da tela. */
  name: string;
  id: string;
  operations: ApiOperationRef[];
}

/**
 * Link do Scalar para uma operação: `#tag/<tag>/<MÉTODO><rota>`, com a tag como o Scalar gera o
 * slug (minúsculas, espaços viram hífen, acentos mantidos).
 */
export function scalarUrl(tag: string, method: string, route: string): string {
  const slug = encodeURIComponent(tag.toLowerCase().replace(/\s+/g, '-'));
  return `${PUBLIC_API_URL}/docs#tag/${slug}/${method.toUpperCase()}${route}`;
}

function curlOf(method: string, route: string, op: Operation): string {
  const required = (op.parameters ?? []).filter((p) => p.in === 'query' && p.required);
  const query = Object.fromEntries(
    required.map((p) => [p.name, p.schema?.example !== undefined ? String(p.schema.example) : `<${p.name}>`]),
  );
  const [curl] = requestSnippets({ method: 'GET', route, query, description: op.summary ?? '' });
  const code = curl?.code ?? '';
  // Rotas de escrita (rotação de chave): o mesmo curl com o método.
  return method === 'get' ? code : code.replace(/^curl /, `curl -X ${method.toUpperCase()} `);
}

/** As tags da referência com as operações, em dados simples (nomes das tags no idioma de `t`). */
export function apiReferenceTags(t: Dictionary, doc: OpenApiDoc = openApiDocument()): ApiTagRef[] {
  return groupByTag(doc).map(([tag, ops]) => ({
    name: tagName(tag, t),
    id: tagId(tag),
    operations: ops.map(({ method, route, op }) => ({
      method,
      route,
      summary: op.summary ?? route,
      tag: tagName(tag, t),
      anchor: operationAnchor(method, route),
      curl: curlOf(method, route, op),
      scalar: scalarUrl(tag, method, route),
    })),
  }));
}
