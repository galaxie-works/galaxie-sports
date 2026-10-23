'use client';

import { SCHEDULED_JOBS, scheduleKey, settingDef, type SettingSection } from '@galaxie/runtime-config';
import { Activity, Bot, Gauge, Play, RefreshCw, Server, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { checkAiCreditNow, runJobNow } from '@/app/[locale]/(app)/ajustes/operacao/actions';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
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
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill, plural } from '@/lib/i18n/text';
import type { JobStatus, OpsSetting, OpsSnapshot } from '@/lib/ops/types';

import { displayValue, formatDuration, settingText } from './format';
import { SettingRow, useOpsAction } from './setting-row';

const TABS = ['status', 'live', 'schedule', 'ai', 'wtw', 'related', 'provider', 'assets', 'history'] as const;
type Tab = (typeof TABS)[number];

interface Ctx {
  snapshot: OpsSnapshot;
  timeZone: string;
}

export function OpsPanel({ snapshot, timeZone }: Ctx) {
  const { t } = useI18n();
  const T = t.ops;
  const f = useFormatters(timeZone);
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [tab, setTab] = useState<Tab>('status');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground max-w-3xl text-sm">{T.page.description}</p>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {fill(T.page.generatedAt, { when: f.time(snapshot.generatedAt) })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={() => startRefresh(() => router.refresh())}
          >
            {refreshing ? <Spinner /> : <RefreshCw />}
            {T.page.refresh}
          </Button>
        </div>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="h-auto flex-wrap justify-start">
          {TABS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {T.tabs[id]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="status" className="mt-4">
          <StatusTab snapshot={snapshot} timeZone={timeZone} />
        </TabsContent>
        {(['live', 'ai', 'wtw', 'related', 'assets'] as const).map((s) => (
          <TabsContent key={s} value={s} className="mt-4">
            <SectionCard section={s} snapshot={snapshot} timeZone={timeZone} />
          </TabsContent>
        ))}
        <TabsContent value="schedule" className="mt-4">
          <ScheduleTab snapshot={snapshot} timeZone={timeZone} />
        </TabsContent>
        <TabsContent value="provider" className="mt-4 flex flex-col gap-4">
          <SectionCard section="provider" snapshot={snapshot} timeZone={timeZone} />
          <SectionCard section="credentials" snapshot={snapshot} timeZone={timeZone} />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <HistoryTab snapshot={snapshot} timeZone={timeZone} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const effective = (snapshot: OpsSnapshot, key: string) =>
  snapshot.settings.find((s) => s.key === key)?.value ?? null;

function SecretsList({ settings }: { settings: OpsSetting[] }) {
  const { t } = useI18n();
  if (!settings.length) return null;
  return (
    <div className="grid grid-cols-1 gap-2 px-4 py-4 sm:grid-cols-2">
      {settings.map((s) => {
        const def = settingDef(s.key)!;
        return (
          <div key={s.key} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm">{settingText(t.ops, def).label}</span>
              <code className="text-muted-foreground truncate font-mono text-[11px]">
                {s.key} · {def.services.map((x) => t.ops.services[x]).join(', ')}
              </code>
            </div>
            <Badge variant={s.configured ? 'success-light' : 'warning-light'}>
              {s.configured ? t.ops.secrets.configured : t.ops.secrets.missing}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

function SectionCard({ section, snapshot, timeZone }: Ctx & { section: SettingSection }) {
  const { t } = useI18n();
  const T = t.ops;
  const settings = snapshot.settings.filter((s) => s.section === section);
  const editable = settings.filter((s) => settingDef(s.key)!.type !== 'secret');
  const secrets = settings.filter((s) => settingDef(s.key)!.type === 'secret');
  const inheritPlan = effective(snapshot, 'APISPORTS_PLAN');
  return (
    <Frame>
      <FramePanel className="p-0">
        <FrameHeader className="px-4 pt-4">
          <FrameTitle>{T.sections[section].title}</FrameTitle>
          <FrameDescription>{T.sections[section].description}</FrameDescription>
        </FrameHeader>
        {editable.map((s) => (
          <SettingRow
            key={`${s.key}:${s.source}:${s.value}`}
            setting={s}
            timeZone={timeZone}
            now={snapshot.generatedAt}
            inheritPlan={inheritPlan}
          />
        ))}
        <SecretsList settings={secrets} />
      </FramePanel>
    </Frame>
  );
}

// ── Status ────────────────────────────────────────────────────────────────────────────────────

function StatusTab({ snapshot, timeZone }: Ctx) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ServicesCard snapshot={snapshot} timeZone={timeZone} />
      <CreditCard snapshot={snapshot} timeZone={timeZone} />
      <QuotaCard snapshot={snapshot} timeZone={timeZone} />
      <LlmCard snapshot={snapshot} timeZone={timeZone} />
      <div className="xl:col-span-2">
        <JobsOverview snapshot={snapshot} timeZone={timeZone} />
      </div>
    </div>
  );
}

function CardShell({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Frame>
      <FramePanel className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icon className="text-muted-foreground size-4" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold">{title}</span>
              {description ? <span className="text-muted-foreground text-xs">{description}</span> : null}
            </div>
          </div>
          {action}
        </div>
        {children}
      </FramePanel>
    </Frame>
  );
}

function ServicesCard({ snapshot, timeZone }: Ctx) {
  const { t } = useI18n();
  const T = t.ops;
  const f = useFormatters(timeZone);
  const now = Date.parse(snapshot.generatedAt);
  return (
    <CardShell icon={Server} title={T.status.services}>
      <div className="flex flex-col divide-y">
        {snapshot.services.map((s) => (
          <div key={s.service} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>{T.services[s.service]}</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">
                {s.reportedAt
                  ? fill(s.service === 'api' ? T.status.startedAt : T.status.reported, {
                      when: f.relative(s.reportedAt, now),
                    })
                  : T.status.never}
              </span>
              <Badge variant={s.alive ? 'success-light' : 'destructive-light'} radius="full">
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                {s.alive ? T.status.alive : T.status.offline}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </CardShell>
  );
}

function CreditCard({ snapshot, timeZone }: Ctx) {
  const { t } = useI18n();
  const T = t.ops;
  const f = useFormatters(timeZone);
  const { pending, run } = useOpsAction();
  const c = snapshot.credit;
  const codes = T.status.creditCodes;
  return (
    <CardShell
      icon={ShieldCheck}
      title={T.status.credit}
      action={
        <Button
          variant="outline"
          size="sm"
          disabled={pending || snapshot.creditPending}
          onClick={() => run(() => checkAiCreditNow(), T.feedback.queued)}
        >
          {pending ? <Spinner /> : <RefreshCw />}
          {T.actions.checkCredit}
        </Button>
      }
    >
      {c ? (
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={c.status === 'pass' ? 'success-light' : 'warning-light'}>
              {c.status === 'pass' ? T.status.creditPass : T.status.creditWarn}
            </Badge>
            <span className="text-muted-foreground text-xs">
              {fill(T.status.creditChecked, {
                provider: c.provider ?? '',
                model: c.model ?? '',
                when: f.relative(c.checkedAt, Date.parse(snapshot.generatedAt)),
              })}
            </span>
          </div>
          <p className="text-xs">
            {fill(codes[c.code as keyof typeof codes] ?? codes.http, {
              http: c.http ?? '',
              error: c.error ?? '',
            })}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{T.status.creditNever}</p>
      )}
      {snapshot.creditPending ? (
        <p className="text-muted-foreground text-xs">{T.status.creditPending}</p>
      ) : null}
    </CardShell>
  );
}

function QuotaCard({ snapshot, timeZone }: Ctx) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const f = useFormatters(timeZone);
  const n = (v: number) => f.number(v);
  return (
    <CardShell
      icon={Gauge}
      title={T.status.quota}
      description={fill(T.status.quotaDay, { day: snapshot.dayUtc })}
    >
      {snapshot.quota.every((q) => q.totalUsed === 0 && q.providerUsed === null) ? (
        <p className="text-muted-foreground text-sm">{T.status.noQuota}</p>
      ) : null}
      <div className="flex flex-col gap-4">
        {snapshot.quota.map((q) => {
          const used = Math.max(q.totalUsed, q.providerUsed ?? 0);
          const pct = q.dailyLimit ? Math.min(100, (used / q.dailyLimit) * 100) : 0;
          const plan = settingDef('APISPORTS_PLAN')!;
          return (
            <div key={q.api} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">
                  {T.apis[q.api as keyof typeof T.apis] ?? q.api}
                  {q.plan ? (
                    <span className="text-muted-foreground font-normal">
                      {' '}
                      · {displayValue(T, plan, q.plan, { locale })}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs tabular-nums">
                  {q.dailyLimit
                    ? fill(T.status.quotaUsed, { used: n(used), limit: n(q.dailyLimit) })
                    : fill(T.status.quotaNoLimit, { used: n(used) })}
                </span>
              </div>
              <Progress value={pct} />
              <div className="text-muted-foreground flex flex-wrap gap-x-3 text-[11px]">
                {(['DAILY', 'LIVE', 'BOOTSTRAP', 'ADHOC'] as const).map((p) => (
                  <span key={p}>
                    {T.status.priorities[p]} {n(q.used[p] ?? 0)}
                    {q.planned[p] !== undefined
                      ? ` (${fill(T.status.planned, { n: n(q.planned[p]!) })})`
                      : ''}
                  </span>
                ))}
                {q.providerUsed !== null && q.providerLimit !== null ? (
                  <span>
                    {fill(T.status.quotaProvider, { used: n(q.providerUsed), limit: n(q.providerLimit) })}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </CardShell>
  );
}

function LlmCard({ snapshot, timeZone }: Ctx) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const f = useFormatters(timeZone);
  const { totals, byAgent, budget } = snapshot.llm;
  const tokens = totals.inputTokens + totals.outputTokens;
  const usd = (v: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);
  return (
    <CardShell
      icon={Bot}
      title={T.status.llm}
      description={fill(T.status.quotaDay, { day: snapshot.dayUtc })}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium tabular-nums">
            {budget
              ? fill(T.status.llmTokens, { used: f.number(tokens), budget: f.number(budget) })
              : fill(T.status.llmTokensUnlimited, { used: f.number(tokens) })}
          </span>
          <span className="text-xs tabular-nums">
            {fill(T.status.llmCost, { cost: usd(totals.costUsd), calls: f.number(totals.calls) })}
          </span>
        </div>
        {budget ? <Progress value={Math.min(100, (tokens / budget) * 100)} /> : null}
        {totals.errors ? (
          <span className="text-destructive text-xs">
            {plural(locale, totals.errors, T.status.llmErrors)}
          </span>
        ) : null}
      </div>
      {byAgent.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{T.status.agent}</TableHead>
              <TableHead className="text-right">{T.status.tokensColumn}</TableHead>
              <TableHead className="text-right">{T.status.costColumn}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byAgent.map((a) => (
              <TableRow key={a.agent}>
                <TableCell className="font-mono text-xs">{a.agent}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {f.number(a.inputTokens + a.outputTokens)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{usd(a.costUsd)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground text-sm">{T.status.llmNone}</p>
      )}
    </CardShell>
  );
}

// ── Jobs ──────────────────────────────────────────────────────────────────────────────────────

const RUN_VARIANT = {
  ok: 'success-light',
  error: 'destructive-light',
  running: 'info-light',
} as const;

function LastRun({ job, timeZone, now }: { job: JobStatus; timeZone: string; now: string }) {
  const { t, locale } = useI18n();
  const T = t.ops.jobs;
  const f = useFormatters(timeZone);
  const at = Date.parse(now);
  const last = job.last;
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant={last ? (RUN_VARIANT[last.status as keyof typeof RUN_VARIANT] ?? 'secondary') : 'secondary'}
        >
          {last ? (T.status[last.status as keyof typeof T.status] ?? last.status) : T.status.never}
        </Badge>
        {last ? (
          <span className="text-muted-foreground">
            {f.relative(last.startedAt, at)}
            {last.durationMs !== null
              ? ` · ${fill(T.duration, { duration: formatDuration(locale, last.durationMs) })}`
              : ''}
            {last.trigger ? ` · ${T.triggers[last.trigger as keyof typeof T.triggers] ?? last.trigger}` : ''}
          </span>
        ) : null}
        {job.errors24h ? (
          <span className="text-destructive">{plural(locale, job.errors24h, T.errors24h)}</span>
        ) : null}
        {job.queued ? (
          <Badge variant="warning-light">
            {fill(T.queued, {
              status: t.ops.history.requestStatus[job.queued.status as 'pending'] ?? job.queued.status,
            })}
          </Badge>
        ) : null}
      </div>
      {last?.status === 'error' && job.lastOkAt ? (
        <span className="text-muted-foreground">
          {fill(T.lastOk, { when: f.relative(job.lastOkAt, at) })}
        </span>
      ) : null}
      {last?.error ? (
        <code className="text-destructive font-mono text-[11px] break-all">{last.error}</code>
      ) : null}
    </div>
  );
}

function RunNowButton({ job }: { job: JobStatus }) {
  const { t } = useI18n();
  const T = t.ops;
  const { pending, run } = useOpsAction();
  const label = T.jobs.names[job.name as keyof typeof T.jobs.names]?.label ?? job.name;
  if (!job.runNow) return null;
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button variant="outline" size="sm" disabled={pending || Boolean(job.queued)} />}
      >
        {pending ? <Spinner /> : <Play />}
        {T.actions.runNow}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{fill(T.actions.runNowTitle, { name: label })}</AlertDialogTitle>
          <AlertDialogDescription>
            {fill(T.actions.runNowBody, { service: T.services[job.service] })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{T.actions.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={() => run(() => runJobNow(job.name), T.feedback.queued)}>
            {T.actions.runNow}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function JobsOverview({ snapshot, timeZone }: Ctx) {
  const { t } = useI18n();
  const T = t.ops;
  return (
    <CardShell icon={Activity} title={T.jobs.title}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{T.jobs.columns.job}</TableHead>
            <TableHead>{T.jobs.columns.schedule}</TableHead>
            <TableHead>{T.jobs.columns.last}</TableHead>
            <TableHead className="text-right">{T.jobs.columns.actions}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.jobs.map((job) => {
            const cron = effective(snapshot, scheduleKey(job.name));
            return (
              <TableRow key={job.name}>
                <TableCell className="align-top">
                  <div className="flex flex-col">
                    <span className="text-sm">
                      {T.jobs.names[job.name as keyof typeof T.jobs.names]?.label ?? job.name}
                    </span>
                    <span className="text-muted-foreground font-mono text-[11px]">
                      {job.name} · {T.services[job.service]}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="align-top font-mono text-xs">
                  {cron === 'off' || !cron ? T.jobs.off : cron}
                </TableCell>
                <TableCell className="max-w-md align-top whitespace-normal">
                  <LastRun job={job} timeZone={timeZone} now={snapshot.generatedAt} />
                </TableCell>
                <TableCell className="text-right align-top">
                  <RunNowButton job={job} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </CardShell>
  );
}

function ScheduleTab({ snapshot, timeZone }: Ctx) {
  const { t } = useI18n();
  const T = t.ops;
  const others = snapshot.settings.filter((s) => s.section === 'schedule' && !settingDef(s.key)!.job);
  return (
    <div className="flex flex-col gap-4">
      {(['ingestor', 'agents'] as const).map((service) => (
        <Frame key={service}>
          <FramePanel className="p-0">
            <FrameHeader className="px-4 pt-4">
              <FrameTitle>
                {T.sections.schedule.title} · {T.services[service]}
              </FrameTitle>
              <FrameDescription>{T.sections.schedule.description}</FrameDescription>
            </FrameHeader>
            {SCHEDULED_JOBS.filter((j) => j.service === service).map((j) => {
              const setting = snapshot.settings.find((s) => s.key === scheduleKey(j.name))!;
              const job = snapshot.jobs.find((x) => x.name === j.name)!;
              return (
                <SettingRow
                  key={`${setting.key}:${setting.source}:${setting.value}`}
                  setting={setting}
                  timeZone={timeZone}
                  now={snapshot.generatedAt}
                  aside={<LastRun job={job} timeZone={timeZone} now={snapshot.generatedAt} />}
                  actions={<RunNowButton job={job} />}
                />
              );
            })}
          </FramePanel>
        </Frame>
      ))}
      {others.length ? (
        <Frame>
          <FramePanel className="p-0">
            {others.map((s) => (
              <SettingRow
                key={`${s.key}:${s.source}:${s.value}`}
                setting={s}
                timeZone={timeZone}
                now={snapshot.generatedAt}
              />
            ))}
          </FramePanel>
        </Frame>
      ) : null}
    </div>
  );
}

// ── Histórico ─────────────────────────────────────────────────────────────────────────────────

function HistoryTab({ snapshot, timeZone }: Ctx) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const f = useFormatters(timeZone);
  const show = (key: string, v: string | null) => {
    const def = settingDef(key);
    return def ? displayValue(T, def, v, { locale }) : (v ?? T.values.empty);
  };
  const label = (key: string) => {
    const def = settingDef(key);
    return def ? settingText(T, def).label : key;
  };
  return (
    <div className="flex flex-col gap-4">
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="px-4 pt-4">
            <FrameTitle>{T.history.title}</FrameTitle>
            <FrameDescription>{T.history.description}</FrameDescription>
          </FrameHeader>
          {snapshot.history.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{T.history.when}</TableHead>
                  <TableHead>{T.history.who}</TableHead>
                  <TableHead>{T.history.what}</TableHead>
                  <TableHead>{T.history.change}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="pl-4 text-xs whitespace-nowrap">
                      {f.dateTime(h.changedAt)}
                    </TableCell>
                    <TableCell className="text-xs">{h.changedBy}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm">{label(h.key)}</span>
                        <code className="text-muted-foreground font-mono text-[11px]">{h.key}</code>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs whitespace-normal">
                      {h.action === 'reset'
                        ? fill(T.history.reset, { from: show(h.key, h.oldValue) })
                        : fill(T.history.set, {
                            from: h.oldValue === null ? T.history.base : show(h.key, h.oldValue),
                            to: show(h.key, h.newValue),
                          })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground px-4 pb-4 text-sm">{T.history.empty}</p>
          )}
        </FramePanel>
      </Frame>
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="px-4 pt-4">
            <FrameTitle>{T.history.requests}</FrameTitle>
          </FrameHeader>
          {snapshot.requests.length ? (
            <Table>
              <TableBody>
                {snapshot.requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-4 text-xs whitespace-nowrap">
                      {f.dateTime(r.requestedAt)}
                    </TableCell>
                    <TableCell className="text-xs">{r.requestedBy}</TableCell>
                    <TableCell className="font-mono text-xs">{r.job}</TableCell>
                    <TableCell className="text-xs">
                      {T.history.requestStatus[r.status as keyof typeof T.history.requestStatus] ?? r.status}
                      {r.detail
                        ? ` · ${T.history.requestDetail[r.detail as keyof typeof T.history.requestDetail] ?? r.detail}`
                        : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground px-4 pb-4 text-sm">{T.history.requestsEmpty}</p>
          )}
        </FramePanel>
      </Frame>
    </div>
  );
}
