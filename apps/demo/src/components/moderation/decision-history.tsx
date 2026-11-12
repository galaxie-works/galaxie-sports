'use client';

import { History } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/reui/badge';
import { ExplainEmpty, SettingsSection } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { decideCase, moreDecisions } from '@/lib/moderation/queue-actions';
import type { DecisionItem } from '@/lib/moderation/queue-data';
import { HISTORY_FILTERS, type HistoryFilterKey, type HistoryFilters } from '@/lib/moderation/queue-utils';

/**
 * Histórico de decisões (#999): a auditoria da base (#953), automática e humana, com a régua da hora e o custo, e os
 * filtros por módulo, categoria, ação e quem decidiu. Os filtros ficam na URL; "Carregar mais" pede a próxima página
 * ao servidor com os mesmos filtros.
 */
export function DecisionHistory({
  items: first,
  next: firstNext,
  filters,
}: {
  items: DecisionItem[];
  next: string | null;
  filters: HistoryFilters;
}) {
  const { t, locale } = useI18n();
  const T = t.moderation.history;
  const Q = t.moderation.queue;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [items, setItems] = useState(first);
  const [next, setNext] = useState(firstNext);
  const [pending, startTransition] = useTransition();
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });

  const labels: Record<HistoryFilterKey, Record<string, string>> = {
    module: Q.modules,
    category: T.categories,
    action: T.actions,
    actorKind: T.actorKinds,
  };

  const setFilter = (key: HistoryFilterKey, value: string) => {
    const p = new URLSearchParams(search.toString());
    if (value === 'all') p.delete(key);
    else p.set(key, value);
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  const more = () =>
    next &&
    startTransition(async () => {
      const r = await moreDecisions({ before: next, ...filters });
      if (!r) {
        toast.error(T.loadError);
        return;
      }
      setItems((cur) => [...cur, ...r.items]);
      setNext(r.next);
    });

  // desfaz um fechamento automático (Cosmos ou filtro): o conteúdo volta e as punições dele caem
  const undo = (d: DecisionItem) =>
    d.caseId &&
    startTransition(async () => {
      const r = await decideCase({ caseId: d.caseId!, decision: 'undo' });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(Q.done);
      setItems((cur) => cur.map((x) => (x.caseId === d.caseId ? { ...x, undoable: false } : x)));
      router.refresh();
    });

  const actor = (d: DecisionItem) =>
    d.actorKind === 'person' ? (d.who ?? T.someone) : (T.actorKinds as Record<string, string>)[d.actorKind];

  return (
    <SettingsSection title={T.title} description={T.description}>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(HISTORY_FILTERS) as HistoryFilterKey[]).map((key) => (
          <Select
            key={key}
            value={filters[key] ?? 'all'}
            onValueChange={(v) => setFilter(key, String(v ?? 'all'))}
          >
            <SelectTrigger aria-label={T.filters[key]} className="w-44">
              <SelectValue>
                {(v: string) => (v === 'all' ? `${T.filters[key]}: ${T.all}` : (labels[key][v] ?? v))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{T.all}</SelectItem>
              {HISTORY_FILTERS[key].map((v) => (
                <SelectItem key={v} value={v}>
                  {labels[key][v] ?? v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
      </div>
      {items.length === 0 ? (
        <ExplainEmpty icon={History} title={T.title} description={T.empty} className="rounded-xl border" />
      ) : (
        <ol className="flex flex-col divide-y rounded-lg border text-sm">
          {items.map((d) => (
            <li key={d.id} className="flex flex-col gap-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {(T.actions as Record<string, string>)[d.action] ?? T.actions.other}
                </span>
                <Badge variant={d.actorKind === 'person' ? 'secondary' : 'info-light'}>{actor(d)}</Badge>
                {d.category ? (
                  <Badge variant="warning-light">
                    {(T.categories as Record<string, string>)[d.category] ?? d.category}
                  </Badge>
                ) : null}
                <span className="text-muted-foreground ml-auto text-xs">{when.format(new Date(d.at))}</span>
              </div>
              <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {d.module ? <span>{(Q.modules as Record<string, string>)[d.module] ?? d.module}</span> : null}
                {d.room ? <span>{fill(Q.place.room, { name: d.room })}</span> : null}
                {d.community ? <span>{fill(Q.place.community, { name: d.community })}</span> : null}
                {d.subject ? <span>{fill(T.about, { name: d.subject })}</span> : null}
                {d.level !== null ? <span>{fill(T.level, { level: d.level })}</span> : null}
                {d.step ? (
                  <span>{(Q.suggestion.steps as Record<string, string>)[d.step] ?? d.step}</span>
                ) : null}
                {d.credits ? <span>{fill(T.credits, { credits: d.credits })}</span> : null}
              </div>
              {d.reason ? <p className="text-xs">{d.reason}</p> : null}
              {d.undoable ? (
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => undo(d)}>
                    {Q.decisions.undo}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {next ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={more} disabled={pending}>
            {T.more}
          </Button>
        </div>
      ) : null}
    </SettingsSection>
  );
}
