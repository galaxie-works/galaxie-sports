import { ArrowRight, Blocks, KeyRound } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Progress } from '@/components/ui/progress';
import { getTenantUsage, type TenantInfo } from '@/lib/client/tenants';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';

type Texts = Dictionary['client']['overview'];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</span>
      <div className="flex flex-wrap gap-1.5 text-sm">{children}</div>
    </div>
  );
}

function List({ values, all }: { values: string[]; all: string }) {
  if (!values.length) return <Badge variant="outline">{all}</Badge>;
  return values.map((v) => (
    <Badge key={v} variant="secondary">
      {v}
    </Badge>
  ));
}

/** Visão geral do tenant: plano, módulos, esportes, mercados, limites e o uso consolidado. */
export async function TenantOverview({
  tenant,
  locale,
  t,
}: {
  tenant: TenantInfo;
  locale: Locale;
  t: Dictionary;
}) {
  const usage = await getTenantUsage(tenant.id, 30);
  const o: Texts = t.client.overview;
  const num = new Intl.NumberFormat(locale);
  const plan = o.plans[tenant.plan as keyof Texts['plans']] ?? tenant.plan;
  const sports = tenant.sports.map((s) => t.nav.sports[s as keyof Dictionary['nav']['sports']] ?? s);
  const markets = tenant.markets.map((m) => t.nav.countries[m as keyof Dictionary['nav']['countries']] ?? m);
  const max = Math.max(1, ...usage.days.map((d) => d.total));
  const quotaPercent = tenant.dailyRequestQuota
    ? Math.min(100, Math.round((usage.today / tenant.dailyRequestQuota) * 100))
    : null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Frame className="lg:col-span-2">
        <FramePanel className="flex flex-col gap-5">
          <FrameHeader className="p-0">
            <FrameTitle>{tenant.name}</FrameTitle>
            <FrameDescription>{tenant.slug}</FrameDescription>
          </FrameHeader>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={o.plan}>
              <Badge variant="primary-light">{plan}</Badge>
            </Field>
            <Field label={o.limits}>
              <span className="flex flex-col gap-0.5">
                <span>{fill(o.rate, { n: num.format(tenant.rateLimitPerMinute) })}</span>
                <span className="text-muted-foreground">
                  {tenant.dailyRequestQuota
                    ? fill(o.quota, { n: num.format(tenant.dailyRequestQuota) })
                    : o.noQuota}
                </span>
              </span>
            </Field>
            <div className="sm:col-span-2">
              <Field label={o.modules}>
                {tenant.modules.map((m) => (
                  <Badge key={m} variant="info-light">
                    {o.moduleNames[m as keyof Texts['moduleNames']] ?? m}
                  </Badge>
                ))}
              </Field>
            </div>
            <Field label={o.sports}>
              <List values={sports} all={o.all} />
            </Field>
            <Field label={o.markets}>
              <List values={markets} all={o.all} />
            </Field>
          </div>
        </FramePanel>
      </Frame>

      <Frame>
        <FramePanel className="flex flex-col gap-4">
          <FrameHeader className="p-0">
            <FrameTitle>{o.usage}</FrameTitle>
            <FrameDescription>{o.usageNote}</FrameDescription>
          </FrameHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-muted-foreground text-xs">{o.today}</div>
              <div className="text-2xl font-semibold tabular-nums">{num.format(usage.today)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">{o.last30}</div>
              <div className="text-2xl font-semibold tabular-nums">{num.format(usage.total)}</div>
            </div>
          </div>
          {quotaPercent !== null ? (
            <div className="flex flex-col gap-1.5">
              <Progress value={quotaPercent} />
              <span className="text-muted-foreground text-xs">
                {fill(o.quotaUsed, { percent: quotaPercent })}
              </span>
            </div>
          ) : null}
          {usage.days.length ? (
            <div className="flex h-20 items-end gap-0.5" role="img" aria-label={o.last30}>
              {usage.days.map((d) => (
                <div
                  key={d.day}
                  title={fill(o.dayUsage, { day: d.day, n: num.format(d.total) })}
                  className="bg-primary/70 hover:bg-primary min-w-1 flex-1 rounded-t-sm"
                  style={{ height: `${Math.max(4, (d.total / max) * 100)}%` }}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{o.noUsage}</p>
          )}
        </FramePanel>
      </Frame>

      <Frame className="lg:col-span-3">
        <FramePanel className="flex flex-col gap-3">
          <FrameTitle>{o.next}</FrameTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                { href: '/cliente/chaves', icon: KeyRound, text: o.nextKeys, label: t.client.nav.keys },
                { href: '/cliente/builder', icon: Blocks, text: o.nextBuilder, label: t.client.nav.builder },
              ] as const
            ).map(({ href, icon: Icon, text, label }) => (
              <Link
                key={href}
                href={href}
                className="hover:bg-muted/60 group flex items-center gap-3 rounded-lg border p-3 transition-colors"
              >
                <Icon className="text-primary size-5 shrink-0" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-muted-foreground text-xs">{text}</span>
                </span>
                <ArrowRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </FramePanel>
      </Frame>
    </div>
  );
}
