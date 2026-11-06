'use client';

import {
  DEFAULT_THEMES,
  GalaxieWidgetProvider,
  MatchCard,
  StandingsTable,
  WIDGET_CATALOG,
  createPreviewFetch,
} from '@galaxie/widgets';
import { ArrowLeft, Info, Plus, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { deleteBrandThemeAction, saveBrandThemeAction } from '@/app/[locale]/(app)/cliente/actions';
import { Alert, AlertDescription } from '@/components/reui/alert';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { NAME_MAX } from '@/lib/builder/config';
import type { BrandThemeItem, WidgetTheme } from '@/lib/builder/types';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { ThemeEditor } from './theme-editor';

/** Prévia do tema em dois widgets com dados de exemplo (card do jogo e tabela). */
export function BrandThemePreview({ theme }: { theme: WidgetTheme }) {
  const { locale } = useI18n();
  const sampleFetch = useMemo(() => createPreviewFetch(), []);
  return (
    <div
      className="rounded-lg border p-4 transition-colors"
      style={{ background: theme.background, borderColor: theme.border }}
    >
      <GalaxieWidgetProvider
        baseUrl="/api/galaxie"
        publishableKey=""
        fetch={sampleFetch}
        theme={theme}
        locale={locale === 'es-AR' ? 'es' : locale}
        market="BR"
      >
        <div className="flex flex-col gap-4">
          <MatchCard {...WIDGET_CATALOG.match_card.exampleProps} />
          <StandingsTable {...WIDGET_CATALOG.standings.exampleProps} limit={6} />
        </div>
      </GalaxieWidgetProvider>
    </div>
  );
}

/** Criar ou editar um tema da marca: nome, tema (o mesmo editor do widget) e a prévia ao lado. */
export function BrandThemeEditor({ initial }: { initial: BrandThemeItem | null }) {
  const router = useRouter();
  const { t } = useI18n();
  const th = t.client.themes;
  const [name, setName] = useState(initial?.name ?? '');
  const [theme, setTheme] = useState<WidgetTheme>(initial?.theme ?? { ...DEFAULT_THEMES.dark });
  const [pending, startTransition] = useTransition();
  const [deleting, startDelete] = useTransition();
  const snapshot = (n: string, x: WidgetTheme) => JSON.stringify({ n: n.trim(), x });
  const [saved, setSaved] = useState(initial ? snapshot(initial.name, initial.theme) : null);
  const dirty = saved !== snapshot(name, theme);
  const linked = initial?.widgetCount ?? 0;

  function save() {
    startTransition(async () => {
      const res = await saveBrandThemeAction({ id: initial?.id ?? null, name, theme });
      if (!res.ok || !res.theme) return void toast.error(res.error ?? t.client.errors.generic);
      setSaved(snapshot(res.theme.name, res.theme.theme));
      if (!initial) {
        toast.success(th.created);
        return router.replace(`/cliente/temas/${res.theme.id}`);
      }
      toast.success(res.widgetsUpdated ? fill(th.savedWidgets, { n: res.widgetsUpdated }) : th.saved);
      router.refresh();
    });
  }

  function remove() {
    if (!initial) return;
    startDelete(async () => {
      const res = await deleteBrandThemeAction(initial.id);
      if (!res.ok) return void toast.error(res.error ?? t.client.errors.generic);
      toast.success(th.deleted);
      router.replace('/cliente/temas');
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/cliente/temas" />}>
          <ArrowLeft />
          {th.back}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {initial ? (
            <>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={`/cliente/builder/novo?tema=${initial.id}`} />}
              >
                <Plus />
                {th.useInWidget}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="ghost" size="sm" disabled={deleting} />}>
                  {deleting ? <Spinner /> : <Trash2 />}
                  {th.delete}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{fill(th.deleteTitle, { name: initial.name })}</AlertDialogTitle>
                    <AlertDialogDescription>{th.deleteBody}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{th.cancel}</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={remove}>
                      {th.deleteConfirm}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : null}
          <Button onClick={save} disabled={pending || !name.trim() || (!!initial && !dirty)}>
            {pending ? <Spinner /> : <Save />}
            {initial ? th.save : th.saveNew}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
        <Frame>
          <FramePanel className="flex flex-col gap-5">
            <Field>
              <FieldLabel htmlFor="brand-theme-name">{th.name}</FieldLabel>
              <Input
                id="brand-theme-name"
                maxLength={NAME_MAX}
                placeholder={th.namePlaceholder}
                value={name}
                onChange={(ev) => setName(ev.target.value)}
              />
            </Field>
            <ThemeEditor value={theme} onChange={setTheme} />
            {linked > 0 ? (
              <Alert>
                <Info />
                <AlertDescription>{fill(th.linkedNote, { n: linked })}</AlertDescription>
              </Alert>
            ) : null}
          </FramePanel>
        </Frame>

        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-18 lg:self-start">
          <Frame>
            <FramePanel className="flex flex-col gap-3">
              <FrameHeader className="p-0">
                <FrameTitle>{th.preview}</FrameTitle>
                <FrameDescription>{th.previewNote}</FrameDescription>
              </FrameHeader>
              <BrandThemePreview theme={theme} />
            </FramePanel>
          </Frame>
        </div>
      </div>
    </div>
  );
}
