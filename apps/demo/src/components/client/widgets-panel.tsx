'use client';

import { CalendarDays, Plus, Radio, Table2, Tv, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { archiveWidgetAction } from '@/app/[locale]/(app)/cliente/actions';
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
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { WIDGET_CATALOG } from '@galaxie/widgets';

import { WIDGET_KINDS, toWidgetLocale } from '@/lib/builder/config';
import type { WidgetEntityType, WidgetKind } from '@/lib/builder/types';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

export const KIND_ICONS: Record<WidgetKind, LucideIcon> = {
  match_card: CalendarDays,
  live_list: Radio,
  standings: Table2,
  where_to_watch: Tv,
};

/** Nome e descrição do tipo de widget no idioma da tela (vêm do catálogo de `@galaxie/widgets`). */
export function useKindTexts() {
  const { locale } = useI18n();
  const wl = toWidgetLocale(locale);
  return (kind: WidgetKind) => ({
    name: WIDGET_CATALOG[kind].name[wl],
    description: WIDGET_CATALOG[kind].description[wl],
  });
}

export interface WidgetRow {
  id: string;
  kind: WidgetKind;
  name: string;
  version: number;
  updatedAt: string;
  entity: { type: WidgetEntityType; id: string } | null;
}

function ArchiveButton({ row }: { row: WidgetRow }) {
  const router = useRouter();
  const { t } = useI18n();
  const b = t.client.builder;
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" disabled={pending} />}>
        {pending ? <Spinner /> : null}
        {b.archive}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{fill(b.archiveTitle, { name: row.name })}</AlertDialogTitle>
          <AlertDialogDescription>{b.archiveDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{b.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              startTransition(async () => {
                const res = await archiveWidgetAction(row.id);
                if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
                toast.success(b.archived);
                router.refresh();
              })
            }
          >
            {b.archive}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Builder: o catálogo (para começar um widget) e os widgets salvos do tenant (editar e arquivar). */
export function WidgetsPanel({ widgets, timeZone }: { widgets: WidgetRow[]; timeZone: string }) {
  const { t } = useI18n();
  const f = useFormatters(timeZone);
  const kindTexts = useKindTexts();
  const b = t.client.builder;
  return (
    <div className="flex flex-col gap-4">
      <Frame>
        <FramePanel className="flex flex-col gap-4">
          <FrameHeader className="p-0">
            <FrameTitle>{b.catalog}</FrameTitle>
            <FrameDescription>{b.description}</FrameDescription>
          </FrameHeader>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {WIDGET_KINDS.map((kind) => {
              const Icon = KIND_ICONS[kind];
              const texts = kindTexts(kind);
              return (
                <div key={kind} className="flex flex-col gap-3 rounded-lg border p-4">
                  <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-md">
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <span className="font-medium">{texts.name}</span>
                    <span className="text-muted-foreground text-sm">{texts.description}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link href={`/cliente/builder/novo?tipo=${kind}`} />}
                  >
                    <Plus />
                    {b.create}
                  </Button>
                </div>
              );
            })}
          </div>
        </FramePanel>
      </Frame>

      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="p-4">
            <FrameTitle>{b.saved}</FrameTitle>
            <FrameDescription>{b.savedDescription}</FrameDescription>
          </FrameHeader>
          {widgets.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{b.columns.name}</TableHead>
                  <TableHead>{b.columns.kind}</TableHead>
                  <TableHead>{b.columns.entity}</TableHead>
                  <TableHead>{b.columns.version}</TableHead>
                  <TableHead>{b.columns.updated}</TableHead>
                  <TableHead className="pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {widgets.map((w) => {
                  const Icon = KIND_ICONS[w.kind];
                  return (
                    <TableRow key={w.id}>
                      <TableCell className="pl-4 font-medium">
                        <Link href={`/cliente/builder/${w.id}`} className="hover:underline">
                          {w.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm">
                          <Icon className="text-muted-foreground size-4" aria-hidden />
                          {kindTexts(w.kind).name}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {w.entity ? b.entityTypes[w.entity.type] : b.noEntity}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{fill(b.version, { n: w.version })}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {f.relative(w.updatedAt)}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            nativeButton={false}
                            render={<Link href={`/cliente/builder/${w.id}`} />}
                          >
                            {b.edit}
                          </Button>
                          <ArchiveButton row={w} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground px-4 pb-6 text-sm">{b.empty}</p>
          )}
        </FramePanel>
      </Frame>
    </div>
  );
}
