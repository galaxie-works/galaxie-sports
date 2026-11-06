'use client';

import { Palette, Plus } from 'lucide-react';
import Link from 'next/link';

import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { fontLabel } from '@/lib/builder/config';
import type { BrandThemeItem } from '@/lib/builder/types';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/** Amostra das cores do tema (fundo, primária, superfície e texto), como nos temas prontos do editor. */
export function ThemeSwatch({ theme }: { theme: BrandThemeItem['theme'] }) {
  return (
    <span
      className="flex h-12 items-center gap-1.5 border px-3"
      style={{ background: theme.background, borderColor: theme.border, borderRadius: theme.radius }}
    >
      <span className="size-5 rounded-full" style={{ background: theme.primary }} />
      <span className="h-2.5 flex-1 rounded-full" style={{ background: theme.surface }} />
      <span className="h-2.5 w-6 rounded-full" style={{ background: theme.foreground }} />
    </span>
  );
}

/** Aba Temas: os temas da marca do tenant (editar) e o botão de criar um novo. */
export function BrandThemesPanel({ themes }: { themes: BrandThemeItem[] }) {
  const { t } = useI18n();
  const th = t.client.themes;
  const e = t.client.editor;
  const usage = (n: number) => (n === 0 ? th.widgetsNone : n === 1 ? th.widgetsOne : fill(th.widgets, { n }));
  return (
    <Frame>
      <FramePanel className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <FrameHeader className="p-0">
            <FrameTitle>{th.title}</FrameTitle>
            <FrameDescription>{th.description}</FrameDescription>
          </FrameHeader>
          <Button size="sm" nativeButton={false} render={<Link href="/cliente/temas/novo" />}>
            <Plus />
            {th.new}
          </Button>
        </div>
        {themes.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {themes.map((x) => (
              <Link
                key={x.id}
                href={`/cliente/temas/${x.id}`}
                className="hover:border-primary/60 flex flex-col gap-3 rounded-lg border p-4 transition-colors"
              >
                <ThemeSwatch theme={x.theme} />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{x.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {e.mode[x.theme.mode]} · {fontLabel(x.theme.fontFamily)} ·{' '}
                    {fill(e.radiusValue, { n: x.theme.radius })}
                  </span>
                  <span className="text-muted-foreground text-xs">{usage(x.widgetCount)}</span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
            <Palette className="text-muted-foreground size-6" aria-hidden />
            <span className="font-medium">{th.empty}</span>
            <span className="text-muted-foreground max-w-md text-sm">{th.emptyHint}</span>
          </div>
        )}
      </FramePanel>
    </Frame>
  );
}
