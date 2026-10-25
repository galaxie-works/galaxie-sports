'use client';

import { ExternalLink } from 'lucide-react';

import { Badge } from '@/components/reui/badge';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type { LineupStatus, RequestStatus, SourceView } from '@/lib/lineup/types';
import { cn } from '@/lib/utils';

export const STATUS_BADGE = {
  draft: 'outline',
  reviewed: 'info-light',
  approved: 'success-light',
  rejected: 'destructive-light',
} as const satisfies Record<LineupStatus, string>;

export const REQUEST_BADGE = {
  open: 'warning-light',
  accepted: 'success-light',
  rejected: 'outline',
} as const satisfies Record<RequestStatus, string>;

export function StatusBadge({ status }: { status: LineupStatus }) {
  const { t } = useI18n();
  return <Badge variant={STATUS_BADGE[status]}>{t.lineup.statuses[status]}</Badge>;
}

export function RequestBadge({ status }: { status: RequestStatus }) {
  const { t } = useI18n();
  return <Badge variant={REQUEST_BADGE[status]}>{t.lineup.requestStatuses[status]}</Badge>;
}

/** Logo do canal, da operadora ou do streaming; sem logo, as iniciais. */
export function ItemLogo({ name, url, className }: { name: string; url: string | null; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return url ? (
    <img
      src={url}
      alt=""
      aria-hidden
      className={cn('size-8 shrink-0 rounded-md object-contain', className)}
      loading="lazy"
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        'bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold',
        className,
      )}
    >
      {initials}
    </span>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Fonte mais recente do item: onde foi visto (link) e quando. */
export function SourceLine({
  sources,
  timeZone,
  className,
}: {
  sources: SourceView[];
  timeZone: string;
  className?: string;
}) {
  const { t } = useI18n();
  const f = useFormatters(timeZone);
  const last = [...sources].sort((a, b) => b.seenAt.localeCompare(a.seenAt))[0];
  if (!last)
    return <span className={cn('text-muted-foreground text-xs', className)}>{t.lineup.source.none}</span>;
  const seen = fill(t.lineup.source.seen, { date: f.date(last.seenAt) });
  return (
    <span className={cn('text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs', className)}>
      <span>{seen}</span>
      <span aria-hidden>·</span>
      {last.operator || !last.url || !/^https?:\/\//.test(last.url) ? (
        <span>
          {last.operator ? t.lineup.source.operator : (last.note ?? last.url ?? t.lineup.source.none)}
        </span>
      ) : (
        <a
          href={last.url}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-foreground inline-flex items-center gap-0.5 underline-offset-4 hover:underline"
        >
          {hostOf(last.url)}
          <ExternalLink className="size-3" />
        </a>
      )}
    </span>
  );
}

/** Rótulo e valor de um campo da grade (correção proposta ou mudança encontrada), no idioma da tela. */
export function useFieldText() {
  const { t } = useI18n();
  const label = (field: string) => (t.lineup.fields as Record<string, string>)[field] ?? field;
  const value = (field: string, v: unknown): string => {
    if (field === 'removed') return v ? t.lineup.fields.removed : '—';
    if (field === 'access' && (v === 'included' || v === 'addon' || v === 'unverified'))
      return t.lineup.access[v];
    return v === null || v === undefined || v === '' ? '—' : String(v);
  };
  /** "Campo: valor · Campo: valor" (tirar da grade vira só o rótulo). */
  const summary = (fields: Record<string, unknown>) =>
    Object.entries(fields)
      .filter(([k]) => k !== 'seen_at')
      .map(([k, v]) => (k === 'removed' ? label(k) : `${label(k)}: ${value(k, v)}`))
      .join(' · ');
  return { label, value, summary };
}
