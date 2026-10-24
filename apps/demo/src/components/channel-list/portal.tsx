'use client';

import { CheckCheck, FileUp, ListChecks, Pencil, RefreshCw, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  confirmChannels,
  correctChannels,
  reprocessChannels,
  uploadChannels,
} from '@/app/[locale]/(app)/cliente/canais/actions';
import { EmptyState } from '@/components/app-shell/empty-state';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill, plural } from '@/lib/i18n/text';
import {
  stripStreamUrls,
  unmatchedChannels,
  type ChannelListView,
  type MatchKind,
  type RightView,
} from '@/lib/channel-list/types';

interface Props {
  view: ChannelListView | null;
  /** Mercados do tenant cobertos pelo onde assistir (país padrão da lista). */
  markets: string[];
  timeZone: string;
}

const AUTO = '__auto';
const KIND_BADGE: Record<MatchKind, 'success-light' | 'info-light' | 'warning-light' | 'outline'> = {
  exato: 'success-light',
  feed_generico: 'info-light',
  nome_divergente: 'warning-light',
  sem_canal_na_lista: 'outline',
};
const KIND_ORDER: MatchKind[] = ['exato', 'nome_divergente', 'feed_generico', 'sem_canal_na_lista'];

function useCountryName() {
  const { locale } = useI18n();
  return useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return (code: string) => names.of(code) ?? code;
  }, [locale]);
}

/** Roda a ação do servidor e atualiza a página (com o aviso de sucesso ou o erro). */
function useAction() {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const run = <R extends { ok: boolean; error?: string }>(
    action: () => Promise<R>,
    success: string | ((res: R) => string),
    after?: () => void,
  ) =>
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return void toast.error(res.error ?? t.channels.errors.generic);
      toast.success(typeof success === 'string' ? success : success(res));
      after?.();
      router.refresh();
    });
  return { pending, run };
}

// ─── envio ───────────────────────────────────────────────────────────────────────────────────────

function UploadCard({ markets, replacing }: { markets: string[]; replacing: boolean }) {
  const { t, locale } = useI18n();
  const U = t.channels.upload;
  const countryName = useCountryName();
  const { pending, run } = useAction();
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [file, setFile] = useState<{ name: string; content: string; lines: number } | null>(null);
  const [text, setText] = useState('');
  const [country, setCountry] = useState<string>(markets.length === 1 ? markets[0]! : AUTO);

  const content = mode === 'file' ? (file?.content ?? '') : text;
  const items = [
    { value: AUTO, label: U.countryAuto },
    ...markets.map((m) => ({ value: m, label: `${countryName(m)} (${m})` })),
  ];

  const onFile = async (f: File | undefined) => {
    if (!f) return setFile(null);
    // as URLs de stream nem saem do navegador: só as linhas #EXT do M3U seguem para o servidor
    const content = stripStreamUrls(await f.text());
    const lines = content
      .split(/\r?\n/)
      .filter((l) => /^#EXTINF/i.test(l.trim()) || (l.trim() && !l.startsWith('#'))).length;
    setFile({ name: f.name, content, lines });
  };

  const submit = () =>
    run(
      () =>
        uploadChannels({
          content,
          ...(mode === 'file' && /^\s*#EXT/im.test(content) ? { format: 'm3u' as const } : {}),
          defaultCountry: country === AUTO ? null : country,
        }),
      (res) =>
        [
          U.sent,
          res.duplicates ? plural(locale, res.duplicates, U.duplicates, { count: res.duplicates }) : '',
          res.truncated ? plural(locale, res.truncated, U.truncated, { count: res.truncated }) : '',
        ]
          .filter(Boolean)
          .join(' '),
      () => {
        setFile(null);
        setText('');
      },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileUp className="size-4" />
          {replacing ? U.replaceTitle : U.title}
        </CardTitle>
        <CardDescription>{U.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'file' | 'paste')}>
          <TabsList>
            <TabsTrigger value="file">{U.file}</TabsTrigger>
            <TabsTrigger value="paste">{U.paste}</TabsTrigger>
          </TabsList>
          <TabsContent value="file" className="pt-3">
            <Field>
              <FieldLabel htmlFor="channel-list-file">{U.fileLabel}</FieldLabel>
              <Input
                id="channel-list-file"
                type="file"
                accept=".m3u,.m3u8,.txt,text/plain,audio/x-mpegurl,application/vnd.apple.mpegurl"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              {file ? (
                <FieldDescription>
                  {fill(U.fileChosen, { name: file.name, count: file.lines })}
                </FieldDescription>
              ) : null}
            </Field>
          </TabsContent>
          <TabsContent value="paste" className="pt-3">
            <Field>
              <FieldLabel htmlFor="channel-list-text">{U.pasteLabel}</FieldLabel>
              <Textarea
                id="channel-list-text"
                rows={8}
                value={text}
                placeholder={U.pastePlaceholder}
                onChange={(e) => setText(e.target.value)}
                className="font-mono text-xs"
              />
            </Field>
          </TabsContent>
        </Tabs>
        <Field>
          <FieldLabel htmlFor="channel-list-country">{U.country}</FieldLabel>
          <Select items={items} value={country} onValueChange={(v) => setCountry(String(v ?? AUTO))}>
            <SelectTrigger id="channel-list-country" className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{U.countryHint}</FieldDescription>
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">{U.privacy}</p>
          <Button onClick={submit} disabled={pending || !content.trim()}>
            {pending ? <Spinner /> : <ListChecks />}
            {U.submit}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── correção ────────────────────────────────────────────────────────────────────────────────────

function CorrectDialog({ right, view }: { right: RightView; view: ChannelListView }) {
  const { t, locale } = useI18n();
  const C = t.channels.correct;
  const countryName = useCountryName();
  const { pending, run } = useAction();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set(right.channels));
  const [term, setTerm] = useState('');

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    const list = q ? view.channels.filter((c) => c.name.toLowerCase().includes(q)) : view.channels;
    // marcados primeiro; a lista pode ter milhares de canais, o diálogo mostra os 200 primeiros
    return [...list.filter((c) => selected.has(c.idx)), ...list.filter((c) => !selected.has(c.idx))].slice(
      0,
      200,
    );
  }, [term, view.channels, selected]);

  const toggle = (idx: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  const save = (channels: number[] | null) =>
    run(
      () => correctChannels({ country: right.country, broadcasterId: right.broadcasterId, channels }),
      C.saved,
      () => setOpen(false),
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setSelected(new Set(right.channels));
      }}
    >
      <DialogTrigger render={<Button size="xs" variant="ghost" aria-label={`${C.trigger}: ${right.name}`} />}>
        <Pencil />
        {C.trigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {fill(C.title, { name: right.name, country: countryName(right.country) })}
          </DialogTitle>
          <DialogDescription>{C.description}</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="rounded-lg border">
          <CommandInput placeholder={C.search} value={term} onValueChange={setTerm} />
          <CommandList className="max-h-72">
            <CommandEmpty>{C.empty}</CommandEmpty>
            <CommandGroup>
              {shown.map((c) => (
                <CommandItem key={c.idx} value={String(c.idx)} onSelect={() => toggle(c.idx)}>
                  <Checkbox checked={selected.has(c.idx)} tabIndex={-1} aria-hidden />
                  <span className="truncate">{c.name}</span>
                  {c.group ? (
                    <span className="text-muted-foreground ml-auto truncate text-xs">{c.group}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <p className="text-muted-foreground text-xs">
          {plural(locale, selected.size, C.selected, { count: selected.size })}
        </p>
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex gap-2">
            {right.origin === 'cliente' ? (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => save(null)}>
                {C.undo}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" disabled={pending} onClick={() => save([])}>
              {C.none}
            </Button>
          </div>
          <Button size="sm" disabled={pending} onClick={() => save([...selected].sort((a, b) => a - b))}>
            {pending ? <Spinner /> : null}
            {C.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── revisão ─────────────────────────────────────────────────────────────────────────────────────

function KindBadge({ kind }: { kind: MatchKind }) {
  const { t } = useI18n();
  return (
    <Badge variant={KIND_BADGE[kind]} title={t.channels.kindHints[kind]}>
      {t.channels.kinds[kind]}
    </Badge>
  );
}

function CountryTable({ rights, view }: { rights: RightView[]; view: ChannelListView }) {
  const { t, locale } = useI18n();
  const T = t.channels.table;
  const [showAll, setShowAll] = useState(false);
  const withChannel = rights.filter((r) => r.match !== 'sem_canal_na_lista');
  const without = rights.filter((r) => r.match === 'sem_canal_na_lista');
  const rows = showAll ? [...withChannel, ...without] : withChannel;
  return (
    <div className="flex flex-col gap-2">
      {rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{T.broadcaster}</TableHead>
              <TableHead>{T.match}</TableHead>
              <TableHead>{T.channels}</TableHead>
              <TableHead className="text-right">{T.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.country}:${r.broadcasterId}`}>
                <TableCell className="align-top">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{r.name}</span>
                    {r.access === 'streaming' ? (
                      <span className="text-muted-foreground text-xs">{T.streaming}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex flex-col items-start gap-1">
                    <KindBadge kind={r.match} />
                    <span className="text-muted-foreground text-xs">{t.channels.origin[r.origin]}</span>
                  </div>
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap gap-1">
                      {r.channels.map((i) => (
                        <Badge key={i} variant="outline" className="font-mono font-normal">
                          {view.channels[i]?.name ?? `#${i}`}
                        </Badge>
                      ))}
                    </div>
                    {r.note ? <span className="text-muted-foreground text-xs">{r.note}</span> : null}
                  </div>
                </TableCell>
                <TableCell className="text-right align-top">
                  <CorrectDialog right={r} view={view} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground py-4 text-sm">{T.empty}</p>
      )}
      {without.length ? (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowAll((v) => !v)}>
          {showAll ? T.hideEmpty : plural(locale, without.length, T.showAll, { count: without.length })}
        </Button>
      ) : null}
    </div>
  );
}

function ReviewCard({ view, timeZone }: { view: ChannelListView; timeZone: string }) {
  const { t, locale } = useI18n();
  const S = t.channels.summary;
  const fmt = useFormatters(timeZone);
  const countryName = useCountryName();
  const { pending, run } = useAction();
  const counts = KIND_ORDER.map((k) => [k, view.rights.filter((r) => r.match === k).length] as const);
  const countries = view.markets.filter((m) => view.rights.some((r) => r.country === m));
  const byCountry = (c: string) =>
    view.rights
      .filter((r) => r.country === c)
      .sort(
        (a, b) => KIND_ORDER.indexOf(a.match) - KIND_ORDER.indexOf(b.match) || a.name.localeCompare(b.name),
      );
  const linked = (c: string) => view.rights.filter((r) => r.country === c && r.channels.length).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {S.title}
          <Badge variant={view.status === 'confirmed' ? 'success-light' : 'warning-light'} radius="full">
            {S.status[view.status]}
          </Badge>
          <Badge variant={view.aiStatus === 'failed' ? 'destructive-light' : 'outline'} radius="full">
            <Sparkles className="size-3" />
            {S.ai[view.aiStatus]}
          </Badge>
        </CardTitle>
        <CardDescription className="flex flex-col gap-1">
          <span>{S.description}</span>
          <span className="text-xs">
            {plural(locale, view.channels.length, S.channels, { count: view.channels.length })} ·{' '}
            {fill(S.processedAt, { date: fmt.dayTime(view.processedAt) })}
            {view.confirmedAt ? ` · ${fill(S.confirmedAt, { date: fmt.dayTime(view.confirmedAt) })}` : ''}
          </span>
        </CardDescription>
        <CardAction className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(reprocessChannels, S.reprocessed)}
          >
            <RefreshCw />
            {S.reprocess}
          </Button>
          <Button
            size="sm"
            disabled={pending || view.status === 'confirmed'}
            onClick={() => run(confirmChannels, S.confirmed)}
          >
            {pending ? <Spinner /> : <CheckCheck />}
            {S.confirm}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {counts.map(([k, n]) => (
            <span key={k} className="flex items-center gap-1.5 text-sm">
              <KindBadge kind={k} />
              <span className="text-muted-foreground tabular-nums">{n}</span>
            </span>
          ))}
        </div>
        {view.aiStatus === 'pending' ? (
          <Alert variant="info">
            <AlertDescription>{S.aiPending}</AlertDescription>
          </Alert>
        ) : null}
        {view.aiStatus === 'failed' && view.aiNote ? (
          <Alert variant="warning">
            <AlertDescription>{view.aiNote}</AlertDescription>
          </Alert>
        ) : null}
        {view.confirmedAt ? <p className="text-muted-foreground text-xs">{S.confirmedNote}</p> : null}
        {countries.length ? (
          <Tabs defaultValue={countries[0]}>
            <TabsList className="max-w-full overflow-x-auto">
              {countries.map((c) => (
                <TabsTrigger key={c} value={c}>
                  {countryName(c)}
                  <span className="text-muted-foreground tabular-nums">{linked(c)}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            {countries.map((c) => (
              <TabsContent key={c} value={c} className="pt-2">
                <CountryTable rights={byCountry(c)} view={view} />
              </TabsContent>
            ))}
          </Tabs>
        ) : null}
      </CardContent>
    </Card>
  );
}

function UnmatchedCard({ view }: { view: ChannelListView }) {
  const { t, locale } = useI18n();
  const U = t.channels.unmatched;
  const list = unmatchedChannels(view);
  if (!list.length) return null;
  return (
    <Card size="sm">
      <Collapsible>
        <CardHeader>
          <CardTitle>
            <CollapsibleTrigger className="hover:underline">
              {plural(locale, list.length, U.title, { count: list.length })}
            </CollapsibleTrigger>
          </CardTitle>
          <CardDescription>{U.description}</CardDescription>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            <ul className="flex flex-wrap gap-1">
              {list.slice(0, 500).map((c) => (
                <li key={c.idx}>
                  <Badge variant="outline" className="font-mono font-normal">
                    {c.name}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/** Aba "Minha lista de canais": envio, revisão do casamento por país, correção e confirmação. */
export function ChannelListPortal({ view, markets, timeZone }: Props) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4">
      {view ? (
        <>
          <ReviewCard view={view} timeZone={timeZone} />
          <UnmatchedCard view={view} />
        </>
      ) : (
        <EmptyState title={t.channels.empty.title} description={t.channels.empty.description} />
      )}
      <UploadCard markets={markets} replacing={!!view} />
    </div>
  );
}
