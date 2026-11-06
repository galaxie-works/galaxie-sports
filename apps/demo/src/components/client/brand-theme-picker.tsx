'use client';

import { Palette, RotateCcw, Save } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { saveBrandThemeAction } from '@/app/[locale]/(app)/cliente/actions';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverDescription, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { NAME_MAX, themeOverridesOf } from '@/lib/builder/config';
import type { BrandThemeItem, WidgetTheme } from '@/lib/builder/types';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/** Valor do seletor para "tema só deste widget" (o Select não aceita null como item). */
const NONE = '__none__';

/**
 * Tema da marca do widget: escolher um tema salvo (o widget passa a segui-lo) ou ficar com um tema só dele.
 * Ligado a um tema, o que a operadora mudar no editor abaixo vira ajuste só deste widget, e dá para voltar ao
 * tema da marca. Sem tema, dá para salvar o tema atual como um tema da marca novo.
 */
export function BrandThemePicker({
  themes,
  value,
  theme,
  onChange,
  onCreated,
}: {
  themes: BrandThemeItem[];
  value: string | null;
  /** Tema efetivo do widget (o que o editor abaixo mostra). */
  theme: WidgetTheme;
  onChange: (brandThemeId: string | null, theme: WidgetTheme) => void;
  onCreated: (item: BrandThemeItem) => void;
}) {
  const { t } = useI18n();
  const e = t.client.editor;
  const bt = e.brandTheme;
  const brand = themes.find((x) => x.id === value) ?? null;
  const overrides = brand ? (Object.keys(themeOverridesOf(theme, brand.theme)) as (keyof WidgetTheme)[]) : [];
  const label = (key: keyof WidgetTheme) =>
    key === 'radius' || key === 'density' || key === 'mode'
      ? bt[key]
      : key === 'fontFamily'
        ? bt.font
        : e.colors[key].toLowerCase();
  const items = [{ value: NONE, label: bt.none }, ...themes.map((x) => ({ value: x.id, label: x.name }))];

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [pending, startTransition] = useTransition();

  function create() {
    startTransition(async () => {
      const res = await saveBrandThemeAction({ id: null, name, theme });
      if (!res.ok || !res.theme) return void toast.error(res.error ?? t.client.errors.generic);
      onCreated(res.theme);
      onChange(res.theme.id, res.theme.theme);
      setOpen(false);
      setName('');
      toast.success(fill(bt.savedAs, { name: res.theme.name }));
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor="widget-brand-theme">{bt.label}</FieldLabel>
          <Link
            href="/cliente/temas"
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
          >
            {bt.manage}
          </Link>
        </div>
        <Select
          items={items}
          value={value ?? NONE}
          onValueChange={(v) => {
            const next = themes.find((x) => x.id === v);
            // ao escolher um tema da marca, o widget assume o tema inteiro (sem ajustes);
            // ao desligar, fica com o visual de agora
            onChange(next ? next.id : null, next ? { ...next.theme } : theme);
          }}
        >
          <SelectTrigger id="widget-brand-theme" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((x) => (
              <SelectItem key={x.value} value={x.value}>
                {x.value === NONE ? null : <Palette className="text-muted-foreground" aria-hidden />}
                {x.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>{brand ? fill(bt.linkedHint, { name: brand.name }) : bt.noneHint}</FieldDescription>
      </Field>

      {brand && overrides.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            {fill(bt.overrides, { list: overrides.map(label).join(', ') })}
          </span>
          <Button variant="outline" size="sm" onClick={() => onChange(brand.id, { ...brand.theme })}>
            <RotateCcw />
            {bt.reset}
          </Button>
        </div>
      ) : null}

      {!brand ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={<Button variant="outline" size="sm" className="self-start" />}>
            <Save />
            {bt.saveAs}
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-80 max-w-[90vw] flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="new-brand-theme-name">{bt.saveAsName}</FieldLabel>
              <Input
                id="new-brand-theme-name"
                maxLength={NAME_MAX}
                value={name}
                onChange={(ev) => setName(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' && name.trim() && !pending) create();
                }}
              />
            </Field>
            <PopoverDescription className="text-xs">{bt.saveAsHint}</PopoverDescription>
            <Button size="sm" onClick={create} disabled={pending || !name.trim()}>
              {pending ? <Spinner /> : null}
              {bt.saveAsConfirm}
            </Button>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
