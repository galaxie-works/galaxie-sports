'use client';

import { WIDGET_OPTIONS, type WidgetKind, type WidgetOptionSpec, type WidgetOptions } from '@galaxie/widgets';

import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { compareAlpha, sortByLabel } from '@/lib/alphabetical';
import { toWidgetLocale } from '@/lib/builder/config';
import { useI18n } from '@/lib/i18n/client';

import { EntityPicker, type EntityValue } from './entity-picker';

/** Rótulo da entidade escolhida numa opção (time a destacar, campeonato do filtro), só para exibir. */
export type OptionEntities = Record<string, EntityValue>;

/** Há opções para este tipo de widget? */
export const hasWidgetOptions = (kind: WidgetKind) => (WIDGET_OPTIONS[kind] ?? []).length > 0;

/**
 * Opções de conteúdo do widget, desenhadas a partir de `WIDGET_OPTIONS`: primeiro as escolhas (quantidade,
 * temporada, filtros), depois os campos liga/desliga em ordem alfabética. Valor igual ao padrão sai do
 * rascunho, para o widget salvo ficar como era.
 */
export function WidgetOptionsEditor({
  kind,
  value,
  entities,
  onChange,
}: {
  kind: WidgetKind;
  value: WidgetOptions;
  entities: OptionEntities;
  onChange: (next: WidgetOptions, entities: OptionEntities) => void;
}) {
  const { t, locale } = useI18n();
  const o = t.client.editor.options;
  const wl = toWidgetLocale(locale);
  const specs = WIDGET_OPTIONS[kind] ?? [];
  const label = (s: WidgetOptionSpec) => s.label[wl];
  const choices = specs.filter((s) => s.type !== 'boolean');
  const toggles = sortByLabel(
    specs.filter((s) => s.type === 'boolean').map((spec) => ({ spec, label: label(spec) })),
  );

  const put = (key: string, v: string | number | boolean | undefined, entity?: EntityValue | null) => {
    const next = { ...value };
    const spec = specs.find((s) => s.key === key);
    if (v === undefined || v === '' || (spec && 'default' in spec && spec.default === v)) delete next[key];
    else next[key] = v;
    const ents = { ...entities };
    if (entity) ents[key] = entity;
    else if (entity === null) delete ents[key];
    onChange(next, ents);
  };

  return (
    <div className="flex flex-col gap-5">
      {choices.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {choices.map((spec) => (
            <Choice
              key={spec.key}
              spec={spec}
              label={label(spec)}
              hint={spec.hint?.[wl]}
              value={value[spec.key]}
              entity={entities[spec.key] ?? null}
              texts={o}
              locale={wl}
              onChange={(v, entity) => put(spec.key, v, entity)}
            />
          ))}
        </div>
      ) : null}
      {toggles.length ? (
        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium">{o.fields}</span>
          <div className="grid gap-3 sm:grid-cols-2">
            {toggles.map(({ spec, label: text }) => {
              if (spec.type !== 'boolean') return null;
              const id = `opt-${kind}-${spec.key}`;
              const hint = [spec.hint?.[wl], spec.extraCall ? o.extra : null].filter(Boolean).join(' ');
              return (
                <Field key={spec.key} orientation="horizontal" className="items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <FieldLabel htmlFor={id}>{text}</FieldLabel>
                    {hint ? <FieldDescription>{hint}</FieldDescription> : null}
                  </div>
                  <Switch
                    id={id}
                    checked={
                      typeof value[spec.key] === 'boolean' ? (value[spec.key] as boolean) : spec.default
                    }
                    onCheckedChange={(checked) => put(spec.key, checked)}
                  />
                </Field>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Choice({
  spec,
  label,
  hint,
  value,
  entity,
  texts,
  locale,
  onChange,
}: {
  spec: WidgetOptionSpec;
  label: string;
  hint: string | undefined;
  value: string | number | boolean | undefined;
  entity: EntityValue | null;
  texts: { all: string; none: string };
  locale: 'pt-BR' | 'es' | 'en';
  onChange: (v: string | number | undefined, entity?: EntityValue | null) => void;
}) {
  const id = `opt-${spec.key}`;
  const description = hint ? <FieldDescription>{hint}</FieldDescription> : null;
  switch (spec.type) {
    case 'number':
      return (
        <Field>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            id={id}
            type="number"
            min={spec.min}
            max={spec.max}
            value={typeof value === 'number' ? value : spec.default}
            onChange={(ev) => {
              const n = Number(ev.target.value);
              onChange(
                Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, Math.round(n))) : undefined,
              );
            }}
          />
          {description}
        </Field>
      );
    case 'season':
      return (
        <Field>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            id={id}
            inputMode="numeric"
            maxLength={4}
            placeholder="2026"
            value={typeof value === 'number' ? String(value) : ''}
            onChange={(ev) => {
              const v = ev.target.value.replace(/\D/g, '');
              onChange(v.length === 4 ? Number(v) : undefined);
            }}
          />
          {description}
        </Field>
      );
    case 'region':
      return (
        <Field>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            id={id}
            maxLength={2}
            value={typeof value === 'string' ? value : ''}
            onChange={(ev) => {
              const v = ev.target.value.replace(/[^A-Za-z]/g, '').toUpperCase();
              onChange(v || undefined);
            }}
          />
          {description}
        </Field>
      );
    case 'enum': {
      const items = spec.values.map((v) => ({ value: v.value, label: v.label[locale] }));
      return (
        <Field>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Select
            items={items}
            value={typeof value === 'string' ? value : spec.default}
            onValueChange={(v) => v && onChange(String(v))}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description}
        </Field>
      );
    }
    case 'multi': {
      const picked = new Set(typeof value === 'string' && value ? value.split(',') : []);
      const items = [...spec.values]
        .map((v) => ({ value: v.value, label: v.label[locale] }))
        .sort((a, b) => compareAlpha(a.label, b.label));
      const toggle = (v: string, on: boolean) => {
        const next = new Set(picked);
        if (on) next.add(v);
        else next.delete(v);
        onChange(next.size ? [...next].sort().join(',') : undefined);
      };
      return (
        <Field className="sm:col-span-2">
          <FieldLabel>{label}</FieldLabel>
          <div className="grid gap-2 sm:grid-cols-2">
            {items.map((item) => (
              <label key={item.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={picked.has(item.value)}
                  onCheckedChange={(on) => toggle(item.value, !!on)}
                />
                {item.label}
              </label>
            ))}
          </div>
          <FieldDescription>{picked.size ? null : texts.all}</FieldDescription>
        </Field>
      );
    }
    case 'team':
    case 'competition':
      return (
        <Field className="sm:col-span-2">
          <FieldLabel>{label}</FieldLabel>
          <EntityPicker
            types={[spec.type]}
            value={
              entity ?? (typeof value === 'string' ? { type: spec.type, id: value, label: value } : null)
            }
            onChange={(v) => onChange(v?.id, v)}
          />
          <FieldDescription>{hint ?? (value ? null : texts.none)}</FieldDescription>
        </Field>
      );
    case 'boolean':
      return null;
  }
}
