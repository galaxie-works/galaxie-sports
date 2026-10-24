'use client';

import { ExternalLink, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { participantHref } from '@/lib/navigation';
import type {
  QualityLink,
  QualityResultRow,
  QualitySeverity,
  QualitySnapshot,
  QualityStatus,
} from '@/lib/ops/types';

const SEVERITY_ORDER: QualitySeverity[] = ['critical', 'high', 'medium', 'low'];
const ALL = '__all__';

const STATUS_BADGE: Record<
  QualityStatus,
  'success-light' | 'destructive-light' | 'warning-light' | 'info-light'
> = {
  pass: 'success-light',
  fail: 'destructive-light',
  skipped: 'info-light',
  error: 'warning-light',
};

/** Página ou item da falha (a demo é a mesma do cliente; grades e países abrem o painel/página certos). */
export function qualityHref(link: QualityLink | null): string | null {
  if (!link) return null;
  switch (link.type) {
    case 'participant':
      return participantHref({ id: link.id, name: link.name ?? '' }, link.kind);
    case 'event':
      return `/eventos/${link.id}`;
    case 'person':
      return `/pessoas/${link.id}`;
    case 'competition':
      return `/competicoes/${link.id}`;
    case 'country':
      return `/paises/${link.id}`;
    case 'platform':
      return `/ajustes/grades?aba=revisao&plataforma=${link.id}&status=todos`;
    default:
      return null;
  }
}

/** Soma de séries alinhadas pela execução mais recente (a tendência de um esporte). */
export function sumTrends(series: readonly number[][]): number[] {
  const len = Math.max(0, ...series.map((s) => s.length));
  return Array.from({ length: len }, (_, i) =>
    series.reduce((acc, s) => acc + (s[s.length - len + i] ?? 0), 0),
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 64;
  const h = 18;
  const max = Math.max(1, ...values);
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - 1 - (v / max) * (h - 2)).toFixed(1)}`)
    .join(' ');
  const last = values.at(-1)!;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      aria-hidden
      className={last > 0 ? 'text-destructive' : 'text-success'}
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function Trend({ values }: { values: number[] }) {
  const { t } = useI18n();
  const T = t.ops.quality.trend;
  const [prev, last] = values.slice(-2);
  const text =
    values.length < 2 || prev === undefined || last === undefined
      ? T.first
      : last > prev
        ? fill(T.up, { n: last - prev })
        : last < prev
          ? fill(T.down, { n: prev - last })
          : T.same;
  return (
    <div className="flex items-center gap-2">
      <Sparkline values={values} />
      <span className="text-muted-foreground sr-only text-xs whitespace-nowrap sm:not-sr-only">{text}</span>
    </div>
  );
}

export function QualityTab({
  quality,
  timeZone,
  action,
}: {
  quality: QualitySnapshot | null;
  timeZone: string;
  action?: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const T = t.ops.quality;
  const f = useFormatters(timeZone);
  const [ruleFilter, setRuleFilter] = useState<string>(ALL);

  const sportName = (s: string) =>
    (T.sports as Record<string, string>)[s] ?? (t.nav.sports as Record<string, string>)[s] ?? s;
  const rules = useMemo(() => new Map((quality?.rules ?? []).map((r) => [r.id, r])), [quality]);
  const describe = (id: string) => {
    const d = rules.get(id)?.description;
    return d?.[locale] ?? d?.[locale.startsWith('es') ? 'es' : locale] ?? d?.['pt-BR'] ?? id;
  };

  const results = useMemo(
    () =>
      [...(quality?.results ?? [])].sort(
        (a, b) =>
          SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
          Number(b.status === 'fail') - Number(a.status === 'fail') ||
          a.ruleId.localeCompare(b.ruleId) ||
          a.sport.localeCompare(b.sport),
      ),
    [quality],
  );
  const bySport = useMemo(() => {
    const m = new Map<string, QualityResultRow[]>();
    for (const r of results) m.set(r.sport, [...(m.get(r.sport) ?? []), r]);
    return [...m].sort(
      (a, b) =>
        b[1].reduce((n, r) => n + r.failed, 0) - a[1].reduce((n, r) => n + r.failed, 0) ||
        a[0].localeCompare(b[0]),
    );
  }, [results]);

  if (!quality)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{T.title}</EmptyTitle>
          <EmptyDescription>{T.unavailable}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );

  const failures = quality.failures.filter(
    (x) => ruleFilter === ALL || `${x.ruleId}|${x.sport}` === ruleFilter,
  );
  const count = (s: QualityStatus) => results.filter((r) => r.status === s).length;
  const kpis: [string, number, string][] = [
    [T.kpi.results, results.length, ''],
    [T.kpi.passing, count('pass'), 'text-success'],
    [T.kpi.failing, count('fail'), count('fail') ? 'text-destructive' : ''],
    [T.kpi.skipped, count('skipped') + count('error'), ''],
    [T.kpi.failures, results.reduce((n, r) => n + r.failed, 0), ''],
  ];
  const filterItems = [
    { value: ALL, label: `${T.failures.filterRule}: ${T.failures.all}` },
    ...results
      .filter((r) => r.failed > 0)
      .map((r) => ({
        value: `${r.ruleId}|${r.sport}`,
        label: `${r.ruleId} · ${sportName(r.sport)} (${r.failed})`,
      })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Frame>
        <FramePanel className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <ShieldCheck className="text-muted-foreground mt-0.5 size-4" />
              <div className="flex max-w-3xl flex-col gap-1">
                <span className="text-sm font-semibold">{T.title}</span>
                <span className="text-muted-foreground text-xs">{T.description}</span>
                <span className="text-muted-foreground text-xs">
                  {quality.lastRun
                    ? fill(T.lastRun, {
                        when: f.dayTime(quality.lastRun.startedAt),
                        trigger:
                          (T.triggers as Record<string, string>)[quality.lastRun.trigger] ??
                          quality.lastRun.trigger,
                      })
                    : T.never}
                </span>
              </div>
            </div>
            {action}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {kpis.map(([label, value, tone]) => (
              <div key={label} className="flex flex-col rounded-md border px-3 py-2">
                <span className="text-muted-foreground text-xs">{label}</span>
                <span className={`text-lg font-semibold tabular-nums ${tone}`}>{f.number(value)}</span>
              </div>
            ))}
          </div>
        </FramePanel>
      </Frame>

      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="px-4 pt-4">
            <FrameTitle>{T.bySport.title}</FrameTitle>
          </FrameHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{T.bySport.sport}</TableHead>
                <TableHead className="text-right">{T.bySport.ok}</TableHead>
                <TableHead className="text-right">{T.bySport.failing}</TableHead>
                <TableHead className="text-right">{T.bySport.failed}</TableHead>
                <TableHead>{T.bySport.trend}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bySport.map(([sport, rows]) => (
                <TableRow key={sport}>
                  <TableCell className="text-sm">{sportName(sport)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rows.filter((r) => r.status === 'pass').length}/{rows.length}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rows.filter((r) => r.status === 'fail').length}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.number(rows.reduce((n, r) => n + r.failed, 0))}
                  </TableCell>
                  <TableCell>
                    <Trend values={sumTrends(rows.map((r) => r.trend))} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </FramePanel>
      </Frame>

      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="px-4 pt-4">
            <FrameTitle>{T.byRule.title}</FrameTitle>
          </FrameHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{T.byRule.rule}</TableHead>
                <TableHead>{T.byRule.sport}</TableHead>
                <TableHead>{T.byRule.status}</TableHead>
                <TableHead className="text-right">{T.byRule.failed}</TableHead>
                <TableHead>{T.byRule.trend}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => {
                const origin = rules.get(r.ruleId)?.origin;
                return (
                  <TableRow key={`${r.ruleId}|${r.sport}`}>
                    <TableCell className="max-w-md align-top whitespace-normal">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm">{describe(r.ruleId)}</span>
                        <span className="text-muted-foreground font-mono text-[11px]">
                          {r.ruleId} · {T.severity[r.severity]}
                        </span>
                        {origin ? (
                          <span className="text-muted-foreground text-[11px]">
                            {fill(T.origin, { origin })}
                          </span>
                        ) : null}
                        {r.detail ? (
                          <code className="text-muted-foreground text-[11px] break-all">{r.detail}</code>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm">{sportName(r.sport)}</TableCell>
                    <TableCell className="align-top">
                      <Badge variant={STATUS_BADGE[r.status]}>{T.status[r.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right align-top tabular-nums">
                      <span className={r.failed ? 'text-destructive font-medium' : ''}>
                        {f.number(r.failed)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {' '}
                        {fill(T.byRule.ofChecked, { n: f.number(r.checked) })}
                      </span>
                    </TableCell>
                    <TableCell className="align-top">
                      <Trend values={r.trend} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </FramePanel>
      </Frame>

      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
            <div className="flex flex-col gap-1">
              <FrameTitle>{T.failures.title}</FrameTitle>
              <FrameDescription>
                {T.failures.description}{' '}
                {quality.failuresTotal > quality.failures.length
                  ? fill(T.failures.shown, {
                      shown: f.number(quality.failures.length),
                      total: f.number(quality.failuresTotal),
                    })
                  : null}
              </FrameDescription>
            </div>
            <Select
              items={filterItems}
              value={ruleFilter}
              onValueChange={(v) => setRuleFilter(String(v ?? ALL))}
            >
              <SelectTrigger size="sm" aria-label={T.failures.filterRule} className="max-w-full min-w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {filterItems.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FrameHeader>
          {failures.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{T.failures.item}</TableHead>
                  <TableHead>{T.failures.current}</TableHead>
                  <TableHead>{T.failures.expected}</TableHead>
                  <TableHead>{T.failures.since}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failures.map((x, i) => {
                  const href = qualityHref(x.link);
                  return (
                    <TableRow key={`${x.ruleId}|${x.sport}|${i}`}>
                      <TableCell className="max-w-xs align-top whitespace-normal">
                        <div className="flex flex-col gap-0.5">
                          {href ? (
                            <Link
                              href={href}
                              className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline"
                            >
                              {x.label}
                              <ExternalLink className="size-3" />
                            </Link>
                          ) : (
                            <span className="text-sm">{x.label}</span>
                          )}
                          <span className="text-muted-foreground font-mono text-[11px]">
                            {x.ruleId} · {sportName(x.sport)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-destructive max-w-xs align-top text-xs break-words whitespace-normal">
                        {x.current ?? '—'}
                      </TableCell>
                      <TableCell className="max-w-xs align-top text-xs break-words whitespace-normal">
                        {x.expected ?? '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground align-top text-xs whitespace-nowrap">
                        {f.date(x.firstSeenAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground px-4 pb-4 text-sm">{T.failures.empty}</p>
          )}
        </FramePanel>
      </Frame>
    </div>
  );
}
