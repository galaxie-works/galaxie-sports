import { buildOpenApiDocument } from '@galaxie/contracts';
import { ExternalLink, FileJson } from 'lucide-react';
import type { Metadata } from 'next';

import { C, docLink, docMetadata, DocPage, docText, Endpoint, P } from '@/components/docs/doc-blocks';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { operationAnchor, PUBLIC_API_URL } from '@/lib/galaxie/request';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { getT } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

export function generateMetadata(): Promise<Metadata> {
  return docMetadata('reference');
}

type Text = Dictionary['docs']['reference'];

// ─── leitura do documento OpenAPI (o mesmo que a API serve em /openapi.json) ─────────────────────

interface Schema {
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

interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  description?: string;
  schema?: Schema;
}

interface Operation {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: Schema }> }>;
}

type Doc = {
  info: { version: string };
  tags?: { name: string; description?: string }[];
  paths: Record<string, Record<string, Operation>>;
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/**
 * Seções pela tag do OpenAPI (em pt-BR, como a API publica), na ordem da página, com a chave do nome e
 * da descrição traduzidos em `t.docs.reference.tags`. Tags fora daqui vão para o fim, com o nome e a
 * descrição do documento.
 */
const TAGS: Record<string, keyof Text['tags']> = {
  Catálogo: 'catalog',
  Eventos: 'events',
  'Times e pessoas': 'teams',
  Semântica: 'semantic',
  'Onde assistir': 'whereToWatch',
  Multiesporte: 'multisport',
  'Tempo real': 'realtime',
  Espelho: 'mirror',
  Conta: 'account',
  Outros: 'other',
};

const TAG_ORDER = Object.keys(TAGS);

/** Parâmetros comuns a todas as rotas /v1 (descritos no topo, não em cada operação). */
const COMMON = new Set(['locale', 'tz']);

const refName = (ref: string) => ref.split('/').at(-1) ?? ref;

/** Rótulo curto do tipo: `Event`, `Event[]`, `{ data: Event[], next_cursor }`… */
function typeLabel(schema: Schema | undefined, depth = 0): string {
  if (!schema) return '—';
  if (schema.$ref) return refName(schema.$ref);
  const type = Array.isArray(schema.type) ? schema.type.filter((t) => t !== 'null').join(' | ') : schema.type;
  if (type === 'array') return `${typeLabel(schema.items, depth + 1)}[]`;
  if (schema.properties) {
    if (depth > 0) return 'object';
    const keys = Object.entries(schema.properties);
    const shown = keys.slice(0, 4).map(([k, v]) => (v.$ref || v.type === 'array' ? `${k}: ${typeLabel(v, 1)}` : k));
    return `{ ${shown.join(', ')}${keys.length > 4 ? ', …' : ''} }`;
  }
  return type ?? 'object';
}

/** Restrições e valores de um parâmetro, numa linha. */
function paramHints(schema: Schema | undefined, text: Text): string[] {
  if (!schema) return [];
  const hints: string[] = [];
  if (schema.enum?.length) hints.push(schema.enum.join(' · '));
  if (schema.minimum !== undefined || schema.maximum !== undefined) {
    hints.push(`${schema.minimum ?? '…'}–${schema.maximum ?? '…'}`);
  }
  if (schema.default !== undefined) hints.push(fill(text.default, { value: String(schema.default) }));
  if (schema.example !== undefined && !schema.enum) hints.push(fill(text.example, { value: String(schema.example) }));
  return hints;
}

function groupByTag(doc: Doc) {
  const groups = new Map<string, { method: string; route: string; op: Operation }[]>();
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

const tagId = (tag: string) =>
  `tag-${tag
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}`;

function OperationCard({
  method,
  route,
  op,
  text,
}: {
  method: string;
  route: string;
  op: Operation;
  text: Text;
}) {
  const all = op.parameters ?? [];
  // locale/tz (e o Accept-Language) valem para todas as rotas /v1: explicados uma vez no topo da página.
  const localized = all.some((p) => p.in === 'query' && p.name === 'locale');
  const params = all.filter(
    (p) => !(p.in === 'header' && p.name === 'accept-language') && !(p.in === 'query' && COMMON.has(p.name)),
  );
  const body = op.requestBody?.content?.['application/json']?.schema;
  const responses = Object.entries(op.responses ?? {});
  const ok = responses.filter(([status]) => status.startsWith('2'));
  const others = responses.filter(([status]) => !status.startsWith('2')).map(([status]) => status);
  return (
    <div id={operationAnchor(method, route)} className="flex scroll-mt-20 flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Endpoint method={method} route={route} />
          {localized ? (
            <Badge variant="outline" size="sm" className="font-mono">
              locale · tz
            </Badge>
          ) : null}
        </div>
        {op.summary ? <span className="text-sm font-medium">{op.summary}</span> : null}
        {op.description ? <P className="text-xs">{op.description}</P> : null}
      </div>

      {params.length ? (
        <dl className="divide-y rounded-md border text-xs">
          {params.map((p) => {
            const hints = paramHints(p.schema, text);
            return (
              <div key={`${p.in}-${p.name}`} className="grid gap-1 px-3 py-2 sm:grid-cols-[12rem_1fr] sm:gap-3">
                <dt className="flex flex-wrap items-center gap-1.5">
                  <code className="font-mono">{p.name}</code>
                  <span className="text-muted-foreground">{p.in === 'path' ? text.path : p.in}</span>
                  {p.required ? (
                    <Badge variant="warning-light" size="xs">
                      {text.required}
                    </Badge>
                  ) : null}
                </dt>
                <dd className="text-muted-foreground flex flex-col gap-0.5">
                  {p.description ?? p.schema?.description ?? <span>{typeLabel(p.schema)}</span>}
                  {hints.length ? <span className="font-mono text-[0.6875rem]">{hints.join(' · ')}</span> : null}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}

      {body ? (
        <p className="text-muted-foreground text-xs">
          {text.body} <C>{typeLabel(body)}</C>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {ok.map(([status, r]) => {
          const schema = Object.values(r.content ?? {})[0]?.schema;
          return (
            <span key={status} className="text-muted-foreground">
              <span className="text-success font-mono">{status}</span>{' '}
              {schema ? <C>{typeLabel(schema)}</C> : r.description}
            </span>
          );
        })}
        {others.length ? (
          <span className="text-muted-foreground font-mono" title={text.errors}>
            {others.join(' · ')}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default async function ReferencePage() {
  const t = await getT();
  const text = t.docs.reference;
  const doc = buildOpenApiDocument() as unknown as Doc;
  const groups = groupByTag(doc);
  const tagInfo = new Map((doc.tags ?? []).map((tag) => [tag.name, tag.description]));
  const total = groups.reduce((n, [, ops]) => n + ops.length, 0);
  // Nome e descrição da seção no idioma da tela (tag desconhecida: o que o documento traz).
  const tagName = (tag: string) => {
    const key = TAGS[tag];
    return key ? text.tags[key].name : tag;
  };
  const tagDescription = (tag: string) => {
    const key = TAGS[tag];
    return key ? text.tags[key].description : tagInfo.get(tag)?.replace(/\s*\(docs\/[^)]*\)\.?$/, '.');
  };

  return (
    <DocPage
      href="/docs/referencia"
      title={t.code.docsNav.reference.label}
      wide
      lead={fill(text.lead, { total, version: doc.info.version })}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={`${PUBLIC_API_URL}/docs`} target="_blank" rel="noreferrer" />}
          >
            <ExternalLink aria-hidden /> {text.interactive}
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={`${PUBLIC_API_URL}/openapi.json`} target="_blank" rel="noreferrer" />}
          >
            <FileJson aria-hidden /> openapi.json
          </Button>
        </div>
        <P className="text-xs">{docText(text.external)}</P>
        <P className="text-xs">{docText(text.common, { a: docLink('/docs/conceitos#locales') })}</P>
        <P className="text-xs">{text.specLanguage}</P>
        <nav aria-label={text.sections} className="flex flex-wrap gap-1.5">
          {groups.map(([tag, ops]) => (
            <a
              key={tag}
              href={`#${tagId(tag)}`}
              className="hover:bg-accent rounded-full border px-3 py-1 text-xs transition-colors"
            >
              {tagName(tag)} <span className="text-muted-foreground">{ops.length}</span>
            </a>
          ))}
        </nav>
      </div>

      {groups.map(([tag, ops]) => (
        <section key={tag} id={tagId(tag)} className="flex scroll-mt-20 flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-semibold tracking-tight">{tagName(tag)}</h2>
            {tagDescription(tag) ? <p className="text-muted-foreground text-xs">{tagDescription(tag)}</p> : null}
          </div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {ops.map((o) => (
              <OperationCard key={`${o.method}-${o.route}`} {...o} text={text} />
            ))}
          </div>
        </section>
      ))}
    </DocPage>
  );
}
