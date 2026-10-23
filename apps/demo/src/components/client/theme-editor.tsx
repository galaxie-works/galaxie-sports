'use client';

import { Check, Moon, Rows3, Rows4, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DEFAULT_THEMES, THEME_PRESET_IDS, THEME_PRESET_LABELS } from '@galaxie/widgets';

import { FONT_FAMILIES, RADIUS_MAX, fontLabel, toWidgetLocale } from '@/lib/builder/config';
import type { WidgetTheme } from '@/lib/builder/types';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

const COLOR_KEYS = ['primary', 'background', 'surface', 'foreground', 'mutedForeground', 'border'] as const;
type ColorKey = (typeof COLOR_KEYS)[number];

const HEX = /^#[0-9a-f]{6}$/i;

/** Opção escolhida nos grupos de densidade e modo (o padrão do toggle some no tema escuro). */
const PRESSED = 'data-[pressed]:border-primary/60 data-[pressed]:bg-primary/15 data-[pressed]:text-primary';

/** Seletor de cor nativo + campo hexadecimal (o campo só aplica quando a cor é válida). */
function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="border-input size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
        />
        <Input
          id={id}
          value={text}
          spellCheck={false}
          maxLength={7}
          className="font-mono text-xs uppercase"
          aria-invalid={!HEX.test(text)}
          onChange={(e) => {
            const next = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            setText(next);
            if (HEX.test(next)) onChange(next.toLowerCase());
          }}
        />
      </div>
    </Field>
  );
}

const sameTheme = (a: WidgetTheme, b: WidgetTheme) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Troca de modo: os neutros (fundo, superfície, textos e borda) vêm do primeiro tema pronto daquele modo;
 * a cor primária, o raio, a fonte e a densidade continuam os da operadora.
 */
function withMode(theme: WidgetTheme, mode: WidgetTheme['mode']): WidgetTheme {
  if (theme.mode === mode) return theme;
  const base = Object.values(DEFAULT_THEMES).find((p) => p.mode === mode);
  if (!base) return { ...theme, mode };
  const { background, surface, foreground, mutedForeground, border } = base;
  return { ...theme, mode, background, surface, foreground, mutedForeground, border };
}

/** Editor do tema: temas prontos, cores, raio, fonte, densidade e modo claro/escuro. */
export function ThemeEditor({
  value,
  onChange,
}: {
  value: WidgetTheme;
  onChange: (next: WidgetTheme) => void;
}) {
  const { locale, t } = useI18n();
  const e = t.client.editor;
  const set = <K extends keyof WidgetTheme>(key: K, v: WidgetTheme[K]) => onChange({ ...value, [key]: v });
  // a fonte salva entra na lista mesmo fora das sugestões
  const fonts = [...new Set([value.fontFamily, ...FONT_FAMILIES])].map((f) => ({
    value: f,
    label: fontLabel(f),
  }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{e.presets}</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEME_PRESET_IDS.map((id) => {
            const preset = DEFAULT_THEMES[id];
            const active = sameTheme(preset, value);
            return (
              <button
                key={id}
                type="button"
                onClick={() => onChange({ ...preset })}
                aria-pressed={active}
                className={cn(
                  'hover:border-primary/60 flex flex-col gap-2 rounded-lg border p-2 text-left text-xs transition-colors',
                  active && 'border-primary ring-primary/30 ring-2',
                )}
              >
                <span
                  className="flex h-10 items-center gap-1.5 rounded-md border px-2"
                  style={{ background: preset.background, borderColor: preset.border }}
                >
                  <span className="size-4 rounded-full" style={{ background: preset.primary }} />
                  <span className="h-2 flex-1 rounded-full" style={{ background: preset.surface }} />
                  <span className="h-2 w-4 rounded-full" style={{ background: preset.foreground }} />
                </span>
                <span className="flex items-center justify-between font-medium">
                  {THEME_PRESET_LABELS[id][toWidgetLocale(locale)]}
                  {active ? <Check className="text-primary size-3.5" aria-hidden /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {COLOR_KEYS.map((key: ColorKey) => (
          <ColorField
            key={key}
            id={`theme-${key}`}
            label={e.colors[key]}
            value={value[key]}
            onChange={(v) => set(key, v)}
          />
        ))}
      </div>

      <Field>
        <div className="flex items-center justify-between">
          <FieldLabel>{e.radius}</FieldLabel>
          <span className="text-muted-foreground text-xs tabular-nums">
            {fill(e.radiusValue, { n: value.radius })}
          </span>
        </div>
        <Slider
          aria-label={e.radius}
          min={0}
          max={RADIUS_MAX}
          step={1}
          value={value.radius}
          onValueChange={(v) => set('radius', Array.isArray(v) ? (v[0] ?? 0) : v)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="theme-font">{e.font}</FieldLabel>
          <Select
            items={fonts}
            value={value.fontFamily}
            onValueChange={(v) => v && set('fontFamily', String(v))}
          >
            <SelectTrigger id="theme-font" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fonts.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  <span style={{ fontFamily: f.value }}>{f.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>{e.density.label}</FieldLabel>
          <ToggleGroup
            variant="outline"
            value={[value.density]}
            onValueChange={(v) => v[0] && set('density', v[0] as WidgetTheme['density'])}
          >
            <ToggleGroupItem
              className={PRESSED}
              value="compact"
              aria-label={e.density.compact}
              title={e.density.compact}
            >
              <Rows4 />
            </ToggleGroupItem>
            <ToggleGroupItem
              className={PRESSED}
              value="comfortable"
              aria-label={e.density.comfortable}
              title={e.density.comfortable}
            >
              <Rows3 />
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel>{e.mode.label}</FieldLabel>
          <ToggleGroup
            variant="outline"
            value={[value.mode]}
            onValueChange={(v) => v[0] && onChange(withMode(value, v[0] as WidgetTheme['mode']))}
          >
            <ToggleGroupItem className={PRESSED} value="light" aria-label={e.mode.light} title={e.mode.light}>
              <Sun />
            </ToggleGroupItem>
            <ToggleGroupItem className={PRESSED} value="dark" aria-label={e.mode.dark} title={e.mode.dark}>
              <Moon />
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
      </div>
    </div>
  );
}
