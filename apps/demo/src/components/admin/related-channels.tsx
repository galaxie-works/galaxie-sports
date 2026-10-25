'use client';

import type { RelatedChannelSummary } from '@galaxie/db/related';
import { Eraser, Save, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { clearChannelRefusals, setChannelMode } from '@/app/[locale]/(app)/ajustes/videos/actions';
import { Badge } from '@/components/reui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

export type ChannelFilter = 'all' | 'blocked' | 'refused';

/** Linha da tabela (datas em ISO: vêm do servidor). */
export type ChannelRowData = Omit<RelatedChannelSummary, 'lastRefusedAt' | 'ruleAt'> & {
  lastRefusedAt: string | null;
  ruleAt: string | null;
};

type Mode = 'auto' | 'block' | 'allow';

function StatusBadge({ c }: { c: ChannelRowData }) {
  const { t } = useI18n();
  const T = t.relatedAdmin.status;
  if (c.rule === 'allow') return <Badge variant="success-light">{T.allowed}</Badge>;
  if (c.rule === 'block') return <Badge variant="destructive-light">{T.manualBlocked}</Badge>;
  if (c.blocked) return <Badge variant="warning-light">{T.autoBlocked}</Badge>;
  return <Badge variant="outline">{T.active}</Badge>;
}

function ChannelRow({ c, timeZone }: { c: ChannelRowData; timeZone: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const T = t.relatedAdmin;
  const f = useFormatters(timeZone);
  const current: Mode = c.rule ?? 'auto';
  const [mode, setMode] = useState<Mode>(current);
  const [pending, startTransition] = useTransition();
  const items = (['auto', 'block', 'allow'] as const).map((m) => ({ value: m, label: T.modes[m] }));

  const run = (action: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return void toast.error(res.error ?? T.errors.generic);
      toast.success(res.message);
      router.refresh();
    });

  return (
    <TableRow>
      <TableCell className="min-w-48">
        <span className="block font-medium">{c.title}</span>
        <span className="text-muted-foreground font-mono text-xs">{c.handle ?? c.channelId}</span>
        {c.sourceTier ? (
          <span className="text-muted-foreground ml-1 text-xs">
            · {t.media.tiers[c.sourceTier] ?? c.sourceTier}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="tabular-nums">{c.published}</TableCell>
      <TableCell>
        <span className={cn('tabular-nums', c.refused > 0 && 'font-medium')}>{c.refused}</span>
        {c.lastRefusedAt ? (
          <span className="text-muted-foreground block text-xs">
            {fill(T.lastRefused, { date: f.dateTime(c.lastRefusedAt) })}
          </span>
        ) : null}
      </TableCell>
      <TableCell>
        <StatusBadge c={c} />
        {c.rule && c.ruleBy && c.ruleAt ? (
          <span className="text-muted-foreground block pt-1 text-xs">
            {fill(T.ruleBy, { who: c.ruleBy, date: f.dateTime(c.ruleAt) })}
          </span>
        ) : null}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <Select items={items} value={mode} onValueChange={(v) => setMode((v as Mode) ?? 'auto')}>
            <SelectTrigger size="sm" className="w-36" aria-label={`${T.columns.control}: ${c.title}`}>
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
          <Button
            size="sm"
            variant={mode !== current ? 'default' : 'outline'}
            disabled={pending || mode === current}
            onClick={() => run(() => setChannelMode(c.channelId, mode, c.title))}
          >
            {pending ? <Spinner /> : <Save />}
            {t.lineup.admin.tenants.save}
          </Button>
          {c.refused > 0 ? (
            <AlertDialog>
              <AlertDialogTrigger render={<Button size="sm" variant="ghost" disabled={pending} />}>
                <Eraser /> {T.clear}
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{T.clear}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {fill(T.clearConfirm, { count: c.refused })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => run(() => clearChannelRefusals(c.channelId))}>
                    {T.clear}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Canais dos vídeos relacionados: recusas do player, estado (automático ou manual) e o controle por
 * canal. Busca e filtro ficam na URL.
 */
export function RelatedChannels({
  channels,
  q,
  filter,
  timeZone,
}: {
  channels: ChannelRowData[];
  q: string;
  filter: ChannelFilter;
  timeZone: string;
}) {
  const { t } = useI18n();
  const T = t.relatedAdmin;
  const href = (next: ChannelFilter) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (next !== 'all') p.set('filtro', next);
    const s = p.toString();
    return `/ajustes/videos${s ? `?${s}` : ''}`;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav className="bg-muted inline-flex w-fit gap-1 rounded-lg p-1" aria-label={T.columns.status}>
          {(['all', 'blocked', 'refused'] as const).map((id) => (
            <Link
              key={id}
              href={href(id)}
              aria-current={filter === id ? 'page' : undefined}
              className={cn(
                'text-muted-foreground hover:text-foreground rounded-md px-3 py-1 text-sm font-medium transition-colors',
                filter === id && 'bg-background text-foreground shadow-sm',
              )}
            >
              {T.filters[id]}
            </Link>
          ))}
        </nav>
        <form action="/ajustes/videos" className="flex items-center gap-2">
          {filter !== 'all' ? <input type="hidden" name="filtro" value={filter} /> : null}
          <Input
            name="q"
            defaultValue={q}
            placeholder={T.filters.search}
            aria-label={T.filters.search}
            className="h-8 w-56"
          />
          <Button type="submit" size="sm" variant="outline" aria-label={T.filters.search}>
            <Search />
          </Button>
        </form>
      </div>
      {channels.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{T.columns.channel}</TableHead>
                <TableHead>{T.columns.published}</TableHead>
                <TableHead>{T.columns.refused}</TableHead>
                <TableHead>{T.columns.status}</TableHead>
                <TableHead>{T.columns.control}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map((c) => (
                <ChannelRow key={`${c.channelId}:${c.rule ?? 'auto'}`} c={c} timeZone={timeZone} />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">{T.empty}</p>
      )}
    </div>
  );
}
