'use client';

import { ImageUp, Search, Undo2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { revertCrest, uploadCrest } from '@/app/[locale]/(app)/ajustes/escudos/actions';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  CREST_ACCEPT,
  CREST_KIND_FILTERS,
  CREST_MAX_MB,
  CREST_MIN_PX,
  type CrestKindFilter,
  type CrestRow,
} from '@/lib/crests/types';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

/** Escudo sobre fundo claro ou escuro (o mesmo arquivo nos dois temas), para conferir antes e depois. */
function Swatch({ url, dark, label }: { url: string | null; dark: boolean; label: string }) {
  return (
    <figure className="flex flex-col items-center gap-1">
      <div
        className={cn(
          'flex size-16 items-center justify-center rounded-md border p-2',
          dark ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-200 bg-white',
        )}
      >
        {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : null}
      </div>
      <figcaption className="text-muted-foreground text-xs">{label}</figcaption>
    </figure>
  );
}

function SourceBadge({ source }: { source: CrestRow['source'] }) {
  const { t } = useI18n();
  const S = t.crests.source;
  if (source === 'panel') return <Badge variant="success-light">{S.panel}</Badge>;
  if (source === 'acervo') return <Badge variant="info-light">{S.acervo}</Badge>;
  if (source === 'provider') return <Badge variant="secondary">{S.provider}</Badge>;
  return <Badge variant="warning-light">{S.none}</Badge>;
}

/** Uma linha: o escudo de hoje nos dois fundos, a prévia do arquivo escolhido, enviar e voltar. */
function CrestItem({
  row,
  storageEnabled,
  timeZone,
}: {
  row: CrestRow;
  storageEnabled: boolean;
  timeZone: string;
}) {
  const { t } = useI18n();
  const f = useFormatters(timeZone);
  const C = t.crests;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = `crest-${row.type}-${row.id}`;

  const choose = (next: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : null);
    setError(null);
  };
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void setError(res.error ?? C.errors.generic);
      toast.success(fill(done, { name: row.name }));
      choose(null);
      if (input.current) input.current.value = '';
      router.refresh();
    });
  };
  const upload = () => {
    if (!file) return;
    const form = new FormData();
    form.set('targetType', row.type);
    form.set('targetId', row.id);
    form.set('file', file);
    run(() => uploadCrest(form), C.uploaded);
  };

  return (
    <li className="flex flex-col gap-3 border-b py-4 last:border-b-0 md:flex-row md:items-start md:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.name}</span>
          <span className="text-muted-foreground text-xs">
            {row.type === 'team' ? C.kinds.team : C.kinds.competition}
            {row.country ? ` · ${row.country}` : ''}
          </span>
          <SourceBadge source={row.source} />
        </div>
        {row.lastUpload ? (
          <p className="text-muted-foreground text-xs">
            {fill(C.lastUpload, { who: row.lastUpload.by, date: f.dateTime(row.lastUpload.at) })}
          </p>
        ) : null}
        {error ? (
          <Alert variant="destructive" className="mt-2">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      <div className="flex gap-3">
        <Swatch url={row.logoUrl} dark={false} label={C.today} />
        <Swatch url={row.logoUrl} dark label={C.todayDark} />
        {preview ? (
          <>
            <Swatch url={preview} dark={false} label={C.new} />
            <Swatch url={preview} dark label={C.newDark} />
          </>
        ) : null}
      </div>
      {storageEnabled ? (
        <div className="flex flex-col gap-2 md:w-64">
          <label htmlFor={id} className="sr-only">
            {fill(C.file, { name: row.name })}
          </label>
          <Input
            ref={input}
            id={id}
            type="file"
            accept={CREST_ACCEPT}
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={!file || pending} onClick={upload}>
              {pending ? <Spinner /> : <ImageUp />}
              {C.upload}
            </Button>
            {row.canRevert ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => revertCrest({ type: row.type, id: row.id }), C.reverted)}
              >
                <Undo2 />
                {C.revert}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Ajustes → Escudos: achar o time ou a competição, conferir o escudo de hoje, escolher o arquivo novo (a
 * prévia aparece nos dois fundos antes de enviar) e enviar. Vale na hora; Voltar desfaz o último envio.
 */
export function CrestAdmin({
  rows,
  query,
  kind,
  searching,
  storageEnabled,
  timeZone,
}: {
  rows: CrestRow[];
  query: string;
  kind: CrestKindFilter;
  searching: boolean;
  storageEnabled: boolean;
  timeZone: string;
}) {
  const { t } = useI18n();
  const C = t.crests;
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState(query);
  const [filter, setFilter] = useState<CrestKindFilter>(kind);
  const [pending, startTransition] = useTransition();

  const go = (q: string, k: CrestKindFilter) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (k !== 'all') params.set('tipo', k);
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        role="search"
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          go(text, filter);
        }}
      >
        <Input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={C.search.placeholder}
          aria-label={C.search.label}
          className="sm:max-w-sm"
          autoFocus
        />
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[filter]}
          onValueChange={(next) => {
            const v = next[0] as CrestKindFilter | undefined;
            if (!v || !CREST_KIND_FILTERS.includes(v)) return;
            setFilter(v);
            if (text.trim().length >= 2) go(text, v);
          }}
        >
          {CREST_KIND_FILTERS.map((k) => (
            <ToggleGroupItem key={k} value={k}>
              {C.filters[k]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Spinner /> : <Search />}
          {C.search.submit}
        </Button>
      </form>

      <p className="text-muted-foreground text-xs">{fill(C.hint, { mb: CREST_MAX_MB, min: CREST_MIN_PX })}</p>
      {!storageEnabled ? (
        <Alert>
          <AlertDescription>{C.unavailable}</AlertDescription>
        </Alert>
      ) : null}

      {rows.length ? (
        <section className="flex flex-col">
          <h2 className="text-sm font-medium">
            {searching ? fill(C.results, { count: rows.length }) : C.recent}
          </h2>
          <ul>
            {rows.map((row) => (
              <CrestItem
                key={`${row.type}:${row.id}`}
                row={row}
                storageEnabled={storageEnabled}
                timeZone={timeZone}
              />
            ))}
          </ul>
        </section>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{searching ? C.empty.title : C.empty.startTitle}</EmptyTitle>
            <EmptyDescription>
              {searching ? fill(C.empty.description, { query }) : C.empty.startDescription}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
