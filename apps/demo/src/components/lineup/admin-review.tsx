'use client';

import { Check, CheckCheck, EyeOff, Undo2, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { decideLineupItem, dismissLineupItemChange } from '@/app/[locale]/(app)/ajustes/grades/actions';
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill, plural } from '@/lib/i18n/text';
import {
  ADMIN_TABS,
  STATUS_FILTERS,
  TARGET_TYPES,
  lineupFiltersQuery,
  type AdminTab,
  type ItemView,
  type LineupFilters,
  type LineupStatus,
  type StatusFilter,
} from '@/lib/lineup/types';
import { cn } from '@/lib/utils';

import { ItemLogo, SourceLine, StatusBadge, useFieldText } from './parts';
import { VerificationCell } from './verification';

const ALL = '__all';

export interface ReviewRow extends ItemView {
  planName: string | null;
  platform: { id: string; name: string; country: string };
  /** Plano: preço cheio provado, com a moeda. */
  price?: { amount: number; currency: string } | null;
}

/** Abas de Ajustes → Grades e ofertas (revisão, pedidos das operadoras, operadora de cada tenant). */
export function LineupAdminTabs({ active, open }: { active: AdminTab; open: number }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t.lineup.admin.title} className="flex flex-wrap gap-1 border-b">
      {ADMIN_TABS.map((tab) => (
        <Link
          key={tab}
          href={`/ajustes/grades?aba=${tab}`}
          aria-current={active === tab ? 'page' : undefined}
          className={cn(
            'text-muted-foreground hover:text-foreground -mb-px flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm font-medium',
            active === tab && 'border-primary text-foreground',
          )}
        >
          {t.lineup.admin.tabs[tab]}
          {tab === 'pedidos' && open ? (
            <span className="bg-warning/15 text-warning rounded-full px-1.5 text-xs tabular-nums">
              {open}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

function Filters({
  filters,
  countries,
  platforms,
}: {
  filters: LineupFilters;
  countries: string[];
  platforms: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const F = t.lineup.admin.filters;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const go = (patch: Partial<LineupFilters>) =>
    startTransition(() => router.replace(`${pathname}${lineupFiltersQuery({ ...filters, ...patch })}`));
  const countryName = (c: string) => (t.nav.countries as Record<string, string>)[c] ?? c;
  const statusName = (s: StatusFilter) => (s === 'pending' ? F.pending : t.lineup.statuses[s]);

  const select = (
    label: string,
    value: string | null,
    values: { value: string; label: string }[],
    onChange: (v: string | null) => void,
  ) => (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => onChange(v === ALL || v == null ? null : String(v))}
      items={[
        { value: ALL, label: `${label}: ${F.all}` },
        ...values.map((v) => ({ ...v, label: `${label}: ${v.label}` })),
      ]}
    >
      <SelectTrigger size="sm" aria-label={label} className="min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{`${label}: ${F.all}`}</SelectItem>
        {values.map((v) => (
          <SelectItem key={v.value} value={v.value}>
            {v.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {select(
        F.country,
        filters.country,
        countries.map((c) => ({ value: c, label: countryName(c) })),
        (country) => go({ country }),
      )}
      {select(
        F.platform,
        filters.platform,
        platforms.map((p) => ({ value: p.id, label: p.name })),
        (platform) => go({ platform }),
      )}
      {select(
        F.type,
        filters.type,
        TARGET_TYPES.map((x) => ({ value: x, label: t.lineup.types[x] })),
        (type) => go({ type: type as LineupFilters['type'] }),
      )}
      {select(
        F.status,
        filters.status,
        STATUS_FILTERS.map((s) => ({ value: s, label: statusName(s) })),
        (status) => go({ status: status as StatusFilter | null }),
      )}
      {filters.country || filters.platform || filters.type || filters.status !== 'pending' ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => startTransition(() => router.replace(`${pathname}?aba=revisao`))}
        >
          <X />
          {F.clear}
        </Button>
      ) : null}
      {pending ? <Spinner className="text-muted-foreground size-4" /> : null}
    </div>
  );
}

/** Mudança que a pesquisa encontrou num item já revisado ou aprovado: atual → novo. */
function PendingChange({ row }: { row: ReviewRow }) {
  const { t } = useI18n();
  const C = t.lineup.admin.change;
  const text = useFieldText();
  const change = row.pendingChange;
  if (!change) return null;
  const entries = Object.entries(change).filter(([k]) => k !== 'seen_at' && k !== 'removed');
  return (
    <div className="border-warning/40 bg-warning/5 mt-1.5 flex flex-col gap-0.5 rounded-md border px-2 py-1 text-xs">
      <span className="font-medium">{change.removed ? C.removed : C.title}</span>
      {entries.map(([k, v]) => (
        <span key={k} className="text-muted-foreground">
          {text.label(k)}:{' '}
          <span className="line-through">{text.value(k, (row.fields as Record<string, unknown>)[k])}</span> →{' '}
          <span className="text-foreground">{text.value(k, v)}</span>
        </span>
      ))}
      <span className="text-muted-foreground italic">{C.hint}</span>
    </div>
  );
}

function Actions({ row }: { row: ReviewRow }) {
  const router = useRouter();
  const { t } = useI18n();
  const A = t.lineup.admin;
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? t.lineup.errors.generic);
      toast.success(done);
      router.refresh();
    });
  const decide = (status: LineupStatus) =>
    run(() => decideLineupItem({ type: row.type, id: row.id }, status), A.decided[status]);
  const changed = row.pendingChange !== null;
  const button = (
    status: LineupStatus,
    label: string,
    icon: React.ReactNode,
    variant: 'default' | 'outline',
  ) => (
    <Button
      size="icon-sm"
      variant={variant}
      aria-label={`${label}: ${row.name}`}
      title={label}
      // Aprovar de novo um item aprovado com mudança encontrada aplica a mudança.
      disabled={pending || (row.status === status && !(status === 'approved' && changed))}
      onClick={() => decide(status)}
    >
      {icon}
    </Button>
  );
  return (
    <div className="flex items-center gap-1">
      {button('approved', A.actions.approve, <Check />, 'default')}
      {button('reviewed', A.actions.reviewed, <CheckCheck />, 'outline')}
      {button('draft', A.actions.draft, <Undo2 />, 'outline')}
      {button('rejected', A.actions.reject, <X />, 'outline')}
      {changed ? (
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={`${A.actions.dismiss}: ${row.name}`}
          title={A.actions.dismiss}
          disabled={pending}
          onClick={() =>
            run(() => dismissLineupItemChange({ type: row.type, id: row.id }), A.decided.dismissed)
          }
        >
          <EyeOff />
        </Button>
      ) : null}
      {pending ? <Spinner className="text-muted-foreground size-4" /> : null}
    </div>
  );
}

/** Revisão dos itens da grade: filtros, fonte e data, situação, mudança encontrada, última decisão e ações. */
export function LineupReview({
  rows,
  filters,
  countries,
  platforms,
  catalogEmpty,
  timeZone,
}: {
  rows: ReviewRow[];
  filters: LineupFilters;
  countries: string[];
  platforms: { id: string; name: string }[];
  catalogEmpty: boolean;
  timeZone: string;
}) {
  const { t, locale } = useI18n();
  const A = t.lineup.admin;
  const f = useFormatters(timeZone);
  return (
    <div className="flex flex-col gap-3">
      <Filters filters={filters} countries={countries} platforms={platforms} />
      {rows.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{A.table.item}</TableHead>
                <TableHead>{A.table.type}</TableHead>
                <TableHead>{A.table.platform}</TableHead>
                <TableHead>{A.table.source}</TableHead>
                <TableHead>{A.table.verification}</TableHead>
                <TableHead>{A.table.status}</TableHead>
                <TableHead>{A.table.decision}</TableHead>
                <TableHead>{A.table.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.type}:${row.id}`} className="align-top">
                  <TableCell className="max-w-80 whitespace-normal">
                    <div className="flex items-center gap-2">
                      <ItemLogo name={row.name} url={row.logoUrl} className="size-7" />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{row.name}</span>
                        {row.planName ? (
                          <span className="text-muted-foreground truncate text-xs">
                            {fill(A.table.inPlan, { plan: row.planName })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <PendingChange row={row} />
                  </TableCell>
                  <TableCell>{t.lineup.types[row.type]}</TableCell>
                  <TableCell className="text-sm">
                    {row.platform.name}
                    <span className="text-muted-foreground block text-xs">{row.platform.country}</span>
                  </TableCell>
                  <TableCell>
                    <SourceLine sources={row.sources} timeZone={timeZone} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {row.type === 'platform' ? (
                      <span className="text-muted-foreground text-xs">—</span>
                    ) : (
                      <VerificationCell
                        verification={row.verification}
                        price={row.price}
                        access={row.fields.access ?? null}
                        isPlan={row.type === 'plan'}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={row.status} />
                      {row.pendingChange ? <Badge variant="warning-light">{A.change.title}</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                    {row.reviewedBy && row.reviewedAt
                      ? fill(A.decidedBy, { who: row.reviewedBy, when: f.relative(row.reviewedAt) })
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Actions row={row} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-muted-foreground rounded-lg border p-6 text-center text-sm">
          {catalogEmpty ? A.emptyCatalog : A.empty}
        </p>
      )}
      <span className="text-muted-foreground text-sm">{plural(locale, rows.length, A.table.total)}</span>
    </div>
  );
}
