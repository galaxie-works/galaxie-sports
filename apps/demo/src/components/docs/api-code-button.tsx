'use client';

import { useQuery } from '@tanstack/react-query';
import { BookOpen, Code } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/reui/badge';
import { CopyButton } from '@/components/sport/copy-button';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  API_KEY_PLACEHOLDER,
  operationAnchor,
  PUBLIC_API_URL,
  requestPath,
  requestQuery,
  requestSearch,
  requestSnippets,
  requestUrl,
  type ApiRequest,
} from '@/lib/galaxie/request';

import { CodeTabs } from './code-tabs';

/** Até quantos itens de cada lista o exemplo de resposta mostra. */
const SAMPLE_ITEMS = 2;
const SAMPLE_DEPTH = 6;
const SAMPLE_STRING = 120;

/** Resposta enxuta: listas cortadas (com a contagem do que ficou de fora) e textos longos encurtados. */
function trimSample(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    const head = value.slice(0, SAMPLE_ITEMS).map((v) => trimSample(v, depth + 1));
    return value.length > SAMPLE_ITEMS ? [...head, `… +${value.length - SAMPLE_ITEMS} itens`] : head;
  }
  if (value && typeof value === 'object') {
    if (depth >= SAMPLE_DEPTH) return '{…}';
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimSample(v, depth + 1)]));
  }
  if (typeof value === 'string' && value.length > SAMPLE_STRING) return `${value.slice(0, SAMPLE_STRING - 1)}…`;
  return value;
}

interface LiveResponse {
  status: number;
  etag: string | null;
  cacheControl: string | null;
  body: unknown;
}

/** Lê a resposta real pela rota da demo (`/api/galaxie/*`, que injeta a chave no servidor). */
async function fetchLive(req: ApiRequest): Promise<LiveResponse> {
  const res = await fetch(`/api/galaxie${requestPath(req)}${requestSearch(req)}`, {
    headers: { accept: 'application/json' },
  });
  return {
    status: res.status,
    etag: res.headers.get('etag'),
    cacheControl: res.headers.get('cache-control'),
    body: await res.json().catch(() => null),
  };
}

function Row({ name, value, hint }: { name: string; value: string; hint?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,6.5rem)_1fr] sm:grid-cols-[10rem_1fr] gap-3 py-1.5">
      <dt className="text-muted-foreground truncate font-mono text-xs" title={name}>
        {name}
      </dt>
      <dd className="min-w-0 font-mono text-xs break-all">
        {value}
        {hint ? <span className="text-muted-foreground font-sans"> · {hint}</span> : null}
      </dd>
    </div>
  );
}

function ResponseSample({ req, enabled }: { req: ApiRequest; enabled: boolean }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['ver-codigo', requestPath(req), requestSearch(req)],
    queryFn: () => fetchLive(req),
    enabled,
  });

  if (isError) {
    return <p className="text-muted-foreground text-xs">Não foi possível ler a resposta agora.</p>;
  }
  if (isPending || !data) return <Skeleton className="h-48" />;

  return (
    <div className="flex flex-col gap-2">
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
        <Badge variant={data.status < 400 ? 'success-light' : 'destructive-light'} size="sm">
          HTTP {data.status}
        </Badge>
        {data.etag ? <span>etag: {data.etag}</span> : null}
        {data.cacheControl ? <span>cache-control: {data.cacheControl}</span> : null}
      </div>
      <CodeTabs
        examples={[
          {
            label: 'JSON',
            language: 'json',
            code: JSON.stringify(trimSample(data.body), null, 2),
          },
        ]}
        title="Resposta resumida (dados reais desta página)"
        maxLines={18}
      />
    </div>
  );
}

/**
 * Botão "Ver código" das seções: abre um painel com a requisição exata que produz os dados da seção
 * (método, caminho com os IDs da página, query e headers), os exemplos em curl/TypeScript/Python e um
 * trecho da resposta real.
 */
export function ApiCodeButton({ request, labeled = false }: { request: ApiRequest; labeled?: boolean }) {
  const [open, setOpen] = useState(false);
  const path = requestPath(request);
  const query = requestQuery(request);
  const url = requestUrl(request);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          labeled ? (
            <Button variant="outline" size="xs" title="Ver a requisição da API que gera esta página" />
          ) : (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Ver código"
              title="Ver código"
              className="text-muted-foreground"
            />
          )
        }
      >
        <Code aria-hidden />
        {labeled ? <span className="hidden sm:inline">Ver código</span> : null}
      </SheetTrigger>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <Code className="text-primary size-4" aria-hidden /> Como obter estes dados
          </SheetTitle>
          <SheetDescription>{request.description}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
          <section className="flex flex-col gap-2">
            <div className="bg-muted/50 flex items-center gap-2 rounded-lg border px-2 py-1.5">
              <Badge size="sm" className="font-mono">
                {request.method}
              </Badge>
              <code className="min-w-0 flex-1 truncate font-mono text-xs" title={url}>
                {path}
              </code>
              <CopyButton value={url} label="Copiar URL" />
            </div>
            <dl className="divide-y">
              <Row name="URL base" value={PUBLIC_API_URL} />
              {Object.entries(request.params ?? {}).map(([k, v]) => (
                <Row key={k} name={`{${k}}`} value={String(v)} hint="caminho" />
              ))}
              {query.map(([k, v]) => (
                <Row key={k} name={k} value={v} hint="query" />
              ))}
              <Row name="x-galaxie-key" value={API_KEY_PLACEHOLDER} hint="header (sua chave)" />
            </dl>
            {request.note ? <p className="text-muted-foreground text-xs">{request.note}</p> : null}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Exemplo</h3>
            <CodeTabs examples={requestSnippets(request)} />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Resposta</h3>
            <ResponseSample req={request} enabled={open} />
          </section>

          <Link
            href={`/docs/referencia#${operationAnchor(request.method, request.route)}`}
            onClick={() => setOpen(false)}
            className="text-primary flex items-center gap-1.5 text-xs hover:underline"
          >
            <BookOpen className="size-3.5" aria-hidden /> Ver {request.route} na referência da API
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
