import { ExternalLink, FileJson } from 'lucide-react';
import type { Metadata } from 'next';

import { C, docLink, docMetadata, DocPage, docText, Endpoint, P } from '@/components/docs/doc-blocks';
import { HeadingAnchor } from '@/components/docs/doc-toc';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { operationAnchor, PUBLIC_API_URL } from '@/lib/galaxie/request';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { getT } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import {
  groupByTag,
  openApiDocument,
  REFERENCE_TAGS,
  tagId,
  tagName,
  type Operation,
  type Schema,
} from '@/lib/openapi-reference';

export function generateMetadata(): Promise<Metadata> {
  return docMetadata('reference');
}

type Text = Dictionary['docs']['reference'];

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
    <div
      id={operationAnchor(method, route)}
      className="@container/op flex scroll-mt-20 flex-col gap-3 rounded-lg border p-4"
    >
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
              <div key={`${p.in}-${p.name}`} className="grid gap-1 px-3 py-2 @lg/op:grid-cols-[11rem_1fr] @lg/op:gap-3">
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
  const doc = openApiDocument();
  const groups = groupByTag(doc);
  const tagInfo = new Map((doc.tags ?? []).map((tag) => [tag.name, tag.description]));
  const total = groups.reduce((n, [, ops]) => n + ops.length, 0);
  // Descrição da seção no idioma da tela (tag desconhecida: o que o documento traz).
  const tagDescription = (tag: string) => {
    const key = REFERENCE_TAGS[tag as keyof typeof REFERENCE_TAGS];
    return key ? text.tags[key].description : tagInfo.get(tag)?.replace(/\s*\(docs\/[^)]*\)\.?$/, '.');
  };

  return (
    <DocPage
      href="/docs/referencia"
      title={t.code.docsNav.reference.label}
      wide
      toc={groups.map(([tag]) => ({ id: tagId(tag), title: tagName(tag, t) }))}
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
              {tagName(tag, t)} <span className="text-muted-foreground">{ops.length}</span>
            </a>
          ))}
        </nav>
      </div>

      {groups.map(([tag, ops]) => (
        <section key={tag} id={tagId(tag)} className="flex scroll-mt-20 flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="group/anchor flex items-center gap-2 text-xl font-semibold tracking-tight">
              <a href={`#${tagId(tag)}`}>{tagName(tag, t)}</a>
              <HeadingAnchor id={tagId(tag)} title={tagName(tag, t)} />
            </h2>
            {tagDescription(tag) ? <p className="text-muted-foreground text-xs">{tagDescription(tag)}</p> : null}
          </div>
          <div className="grid grid-cols-1 gap-3 @7xl/docs:grid-cols-2">
            {ops.map((o) => (
              <OperationCard key={`${o.method}-${o.route}`} {...o} text={text} />
            ))}
          </div>
        </section>
      ))}
    </DocPage>
  );
}
