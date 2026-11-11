'use client';

import { SPONSOR_CATEGORIES, type SponsorIssue } from '@galaxie/engage';
import { Archive, Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { archiveSponsorAction, saveSponsorAction } from '@/app/[locale]/(app)/cliente/patrocinadores/actions';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

export interface SponsorView {
  id: string;
  name: string;
  category: string;
  linkUrl: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  countries: string[];
  startsAt: string | null;
  endsAt: string | null;
  archivedAt: string | null;
  version: number;
}

export interface SponsorReportView {
  sponsorId: string;
  surface: 'chat_room' | 'prediction_campaign' | 'reward';
  surfaceId: string;
  impressions: number;
  days: number;
}

type Status = 'active' | 'scheduled' | 'ended' | 'archived';

function statusOf(s: SponsorView, now: number): Status {
  if (s.archivedAt) return 'archived';
  if (s.startsAt && now < Date.parse(s.startsAt)) return 'scheduled';
  if (s.endsAt && now >= Date.parse(s.endsAt)) return 'ended';
  return 'active';
}

const STATUS_BADGE: Record<Status, 'success-light' | 'info-light' | 'secondary' | 'outline'> = {
  active: 'success-light',
  scheduled: 'info-light',
  ended: 'secondary',
  archived: 'outline',
};

/**
 * Cliente → Engajamento → Patrocinadores (#1021): cadastro (tabela, criação e edição com versão), arquivamento e
 * as impressões dos últimos 30 dias. As regras ficam em `@galaxie/engage` e o servidor confere de novo ao gravar.
 */
export function SponsorsPanel({
  sponsors,
  report,
  max,
  now,
  timeZone,
}: {
  sponsors: SponsorView[];
  report: SponsorReportView[];
  max: number;
  now: string;
  timeZone: string;
}) {
  const { t } = useI18n();
  const T = t.sponsors;
  const f = useFormatters(timeZone);
  const [editing, setEditing] = useState<SponsorView | 'new' | null>(null);
  const [archiving, setArchiving] = useState<SponsorView | null>(null);
  const nowMs = Date.parse(now);
  const active = sponsors.filter((s) => !s.archivedAt).length;
  const names = new Map(sponsors.map((s) => [s.id, s.name]));
  const window = (s: SponsorView) =>
    s.startsAt || s.endsAt
      ? `${s.startsAt ? f.date(s.startsAt) : '…'} – ${s.endsAt ? f.date(s.endsAt) : '…'}`
      : T.list.always;

  return (
    <div className="flex flex-col gap-4">
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="flex flex-row flex-wrap items-start justify-between gap-4 p-4">
            <div className="flex flex-col gap-1">
              <FrameTitle>{T.list.title}</FrameTitle>
              <FrameDescription>{T.list.description}</FrameDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">
                {fill(T.list.count, { count: active, max })}
              </span>
              <Button size="sm" disabled={active >= max} onClick={() => setEditing('new')}>
                <Plus />
                {T.list.add}
              </Button>
            </div>
          </FrameHeader>
          {sponsors.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{T.list.name}</TableHead>
                  <TableHead>{T.list.category}</TableHead>
                  <TableHead>{T.list.countries}</TableHead>
                  <TableHead>{T.list.window}</TableHead>
                  <TableHead>{T.list.status}</TableHead>
                  <TableHead className="sr-only">{T.list.edit}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sponsors.map((s) => {
                  const status = statusOf(s, nowMs);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-xs">
                        {T.categories[s.category as keyof typeof T.categories] ?? s.category}
                      </TableCell>
                      <TableCell className="text-xs">
                        {s.countries.length ? s.countries.join(', ') : T.list.allCountries}
                      </TableCell>
                      <TableCell className="text-xs">{window(s)}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE[status]}>{T.list[status]}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {status !== 'archived' ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditing(s)}
                              aria-label={`${T.list.edit}: ${s.name}`}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setArchiving(s)}
                              aria-label={`${T.list.archive}: ${s.name}`}
                            >
                              <Archive />
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground p-4 text-sm">{T.list.empty}</p>
          )}
        </FramePanel>
      </Frame>

      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="p-4">
            <FrameTitle>{T.report.title}</FrameTitle>
            <FrameDescription>{T.report.description}</FrameDescription>
          </FrameHeader>
          {report.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{T.report.sponsor}</TableHead>
                  <TableHead>{T.report.surface}</TableHead>
                  <TableHead>{T.report.surfaceId}</TableHead>
                  <TableHead className="text-right">{T.report.impressions}</TableHead>
                  <TableHead className="text-right">{T.report.days}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.map((r) => (
                  <TableRow key={`${r.sponsorId}:${r.surface}:${r.surfaceId}`}>
                    <TableCell className="font-medium">
                      {names.get(r.sponsorId) ?? T.report.removed}
                    </TableCell>
                    <TableCell className="text-xs">{T.surfaces[r.surface]}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{r.surfaceId}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {f.number(r.impressions)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{f.number(r.days)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground p-4 text-sm">{T.report.empty}</p>
          )}
        </FramePanel>
      </Frame>

      {editing ? (
        <SponsorDialog
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.version}`}
          current={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {archiving ? <ArchiveDialog sponsor={archiving} onClose={() => setArchiving(null)} /> : null}
    </div>
  );
}

const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
/** Data do campo (`YYYY-MM-DD`) como começo do dia em UTC. */
const isoOf = (day: string) => (day ? `${day}T00:00:00.000Z` : null);

function SponsorDialog({ current, onClose }: { current: SponsorView | null; onClose: () => void }) {
  const { t } = useI18n();
  const T = t.sponsors;
  const F = T.form;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(current?.name ?? '');
  const [category, setCategory] = useState(current?.category ?? '');
  const [linkUrl, setLinkUrl] = useState(current?.linkUrl ?? '');
  const [logoLightUrl, setLogoLightUrl] = useState(current?.logoLightUrl ?? '');
  const [logoDarkUrl, setLogoDarkUrl] = useState(current?.logoDarkUrl ?? '');
  const [countries, setCountries] = useState(current?.countries.join(', ') ?? '');
  const [startsAt, setStartsAt] = useState(dayOf(current?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(dayOf(current?.endsAt ?? null));
  const [issues, setIssues] = useState<SponsorIssue[]>([]);
  const issue = (field: SponsorIssue['field']) => {
    const i = issues.find((x) => x.field === field);
    return i ? T.issues[i.code] : null;
  };

  const submit = () =>
    start(async () => {
      const r = await saveSponsorAction({
        id: current?.id ?? null,
        version: current?.version ?? null,
        sponsor: {
          name,
          category,
          linkUrl,
          logoLightUrl,
          logoDarkUrl,
          countries: countries
            .split(/[\s,;]+/)
            .map((c) => c.trim())
            .filter(Boolean),
          startsAt: isoOf(startsAt),
          endsAt: isoOf(endsAt),
        },
      });
      setIssues(r.issues ?? []);
      if (!r.ok) return void toast.error(r.error ?? T.errors.generic);
      toast.success(fill(F.saved, { name: name.trim() }));
      onClose();
      router.refresh();
    });

  const text = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    field: SponsorIssue['field'],
    opts: { type?: string; optional?: boolean; maxLength?: number } = {},
  ) => {
    const error = issue(field);
    return (
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          type={opts.type ?? 'text'}
          value={value}
          maxLength={opts.maxLength ?? 2000}
          aria-invalid={error ? true : undefined}
          onChange={(e) => set(e.target.value)}
        />
        {error ? (
          <FieldError>{error}</FieldError>
        ) : opts.optional ? (
          <FieldDescription>{F.optional}</FieldDescription>
        ) : null}
      </Field>
    );
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{current ? fill(F.editTitle, { name: current.name }) : F.createTitle}</DialogTitle>
          <DialogDescription>{F.description}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          {text('sponsor-name', F.name, name, setName, 'name', { maxLength: 80 })}
          <Field data-invalid={issue('category') ? true : undefined}>
            <FieldLabel htmlFor="sponsor-category">{F.category}</FieldLabel>
            <Select value={category} onValueChange={(v) => setCategory(v ?? '')}>
              <SelectTrigger id="sponsor-category" aria-invalid={issue('category') ? true : undefined}>
                <SelectValue placeholder={F.category} />
              </SelectTrigger>
              <SelectContent>
                {SPONSOR_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {T.categories[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {issue('category') ? <FieldError>{issue('category')}</FieldError> : null}
          </Field>
          {text('sponsor-link', F.linkUrl, linkUrl, setLinkUrl, 'linkUrl', { type: 'url', optional: true })}
          <div className="grid gap-4 sm:grid-cols-2">
            {text('sponsor-logo-light', F.logoLightUrl, logoLightUrl, setLogoLightUrl, 'logoLightUrl', {
              type: 'url',
              optional: true,
            })}
            {text('sponsor-logo-dark', F.logoDarkUrl, logoDarkUrl, setLogoDarkUrl, 'logoDarkUrl', {
              type: 'url',
              optional: true,
            })}
          </div>
          {text('sponsor-countries', F.countries, countries, setCountries, 'countries', {
            optional: true,
            maxLength: 400,
          })}
          <div className="grid gap-4 sm:grid-cols-2">
            {text('sponsor-starts', F.startsAt, startsAt, setStartsAt, 'startsAt', {
              type: 'date',
              optional: true,
            })}
            {text('sponsor-ends', F.endsAt, endsAt, setEndsAt, 'endsAt', { type: 'date', optional: true })}
          </div>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {F.cancel}
          </Button>
          <Button onClick={submit} disabled={pending || name.trim().length < 2 || !category}>
            {pending ? <Spinner /> : null}
            {F.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveDialog({ sponsor, onClose }: { sponsor: SponsorView; onClose: () => void }) {
  const { t } = useI18n();
  const A = t.sponsors.archive;
  const router = useRouter();
  const [pending, start] = useTransition();

  const confirm = () =>
    start(async () => {
      const r = await archiveSponsorAction({ id: sponsor.id, version: sponsor.version });
      if (!r.ok) return void toast.error(r.error ?? t.sponsors.errors.generic);
      toast.success(fill(A.done, { name: sponsor.name }));
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{fill(A.title, { name: sponsor.name })}</DialogTitle>
          <DialogDescription>{A.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {A.cancel}
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? <Spinner /> : null}
            {A.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
