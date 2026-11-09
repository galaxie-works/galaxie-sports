'use client';

import {
  CHANNEL_GUIDE_MAX_CHANNELS,
  WIDGET_OPTIONS,
  parseChannelNames,
  sportProfile,
  widgetOptionsFor,
  type WidgetKind,
  type WidgetOptionSpec,
  type WidgetOptions,
} from '@galaxie/widgets';

import { ArrowDown, ArrowUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { compareAlpha, sortByLabel } from '@/lib/alphabetical';
import { toWidgetLocale } from '@/lib/builder/config';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { EntityPicker, type EntityValue } from './entity-picker';
import { LookupPicker, type LookupValue } from './lookup-picker';

/** Rótulo da entidade escolhida numa opção (time a destacar, campeonato do filtro), só para exibir. */
export type OptionEntities = Record<string, EntityValue | LookupValue>;

/** Há opções para este tipo de widget? */
export const hasWidgetOptions = (kind: WidgetKind) => (WIDGET_OPTIONS[kind] ?? []).length > 0;

/**
 * Opções de conteúdo do widget, desenhadas a partir de `WIDGET_OPTIONS`: primeiro as escolhas (quantidade,
 * temporada, filtros), depois os campos liga/desliga em ordem alfabética. Valor igual ao padrão sai do
 * rascunho, para o widget salvo ficar como era. Com `sport`, só as opções que valem para ele (gols e
 * cartões só no futebol, parciais só nos outros), com o rótulo na unidade do placar.
 */
export function WidgetOptionsEditor({
  kind,
  sport,
  value,
  channels = [],
  entities,
  onChange,
}: {
  kind: WidgetKind;
  /** Esporte do widget (null = todos os esportes ou não se aplica). */
  sport?: string | null;
  value: WidgetOptions;
  /** Canais da lista confirmada do tenant (opções `type: 'channels'`). */
  channels?: readonly string[];
  entities: OptionEntities;
  onChange: (next: WidgetOptions, entities: OptionEntities) => void;
}) {
  const { t, locale } = useI18n();
  const o = t.client.editor.options;
  const wl = toWidgetLocale(locale);
  const specs = sport
    ? widgetOptionsFor(kind, sport, sportProfile(sport).unit)
    : (WIDGET_OPTIONS[kind] ?? []);
  const label = (s: WidgetOptionSpec) => s.label[wl];
  const choices = specs.filter((s) => s.type !== 'boolean');
  const toggles = sortByLabel(
    specs.filter((s) => s.type === 'boolean').map((spec) => ({ spec, label: label(spec) })),
  );

  const put = (
    key: string,
    v: string | number | boolean | undefined,
    entity?: EntityValue | LookupValue | null,
  ) => {
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
              channels={channels}
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
  channels,
  texts,
  locale,
  onChange,
}: {
  spec: WidgetOptionSpec;
  label: string;
  hint: string | undefined;
  value: string | number | boolean | undefined;
  entity: EntityValue | LookupValue | null;
  channels: readonly string[];
  texts: {
    all: string;
    none: string;
    noChannels: string;
    channelsLimit: string;
    order: string;
    moveUp: string;
    moveDown: string;
  };
  locale: 'pt-BR' | 'es' | 'en';
  onChange: (v: string | number | undefined, entity?: EntityValue | LookupValue | null) => void;
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
      // na escolha com ordem (estatísticas do jogo), a lista guarda a ordem em que o cliente arrumou
      const order = typeof value === 'string' && value ? value.split(',') : [];
      const picked = new Set(order);
      const items = [...spec.values]
        .map((v) => ({ value: v.value, label: v.label[locale] }))
        .sort((a, b) => compareAlpha(a.label, b.label));
      const save = (next: string[]) =>
        onChange(next.length ? (spec.ordered ? next : [...next].sort()).join(',') : undefined);
      const toggle = (v: string, on: boolean) =>
        save(on ? [...order.filter((x) => x !== v), v] : order.filter((x) => x !== v));
      const move = (i: number, by: -1 | 1) => {
        const next = [...order];
        const j = i + by;
        if (j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j]!, next[i]!];
        save(next);
      };
      const labelOf = (v: string) => items.find((x) => x.value === v)?.label ?? v;
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
          {spec.ordered && order.length > 1 ? (
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs font-medium">{texts.order}</span>
              <ol className="flex flex-col gap-1">
                {order.map((v, i) => (
                  <li key={v} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                    <span className="text-muted-foreground w-5 text-right tabular-nums">{i + 1}</span>
                    <span className="flex-1 truncate">{labelOf(v)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={i === 0}
                      aria-label={fill(texts.moveUp, { item: labelOf(v) })}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={i === order.length - 1}
                      aria-label={fill(texts.moveDown, { item: labelOf(v) })}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          <FieldDescription>{hint ?? (picked.size ? null : texts.all)}</FieldDescription>
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
              (entity?.type === 'lookup' ? null : entity) ??
              (typeof value === 'string' ? { type: spec.type, id: value, label: value } : null)
            }
            onChange={(v) => onChange(v?.id, v)}
          />
          <FieldDescription>{hint ?? (value ? null : texts.none)}</FieldDescription>
        </Field>
      );
    case 'lookup':
      return (
        <Field className="sm:col-span-2">
          <FieldLabel>{label}</FieldLabel>
          <LookupPicker
            source={spec.source}
            value={
              entity?.type === 'lookup'
                ? entity
                : typeof value === 'string'
                  ? { type: 'lookup', id: value, label: value }
                  : null
            }
            onChange={(v) => onChange(v?.id, v)}
          />
          <FieldDescription>{hint ?? (value ? null : texts.none)}</FieldDescription>
        </Field>
      );
    case 'channels':
      return (
        <ChannelChoice
          label={label}
          hint={hint}
          value={value}
          channels={channels}
          texts={texts}
          onChange={onChange}
        />
      );
    case 'boolean':
      return null;
  }
}

/**
 * Canais da lista confirmada do tenant, marcados um a um (gravados um por linha). Canal salvo que saiu da
 * lista continua marcado até a pessoa desmarcar, para a grade não mudar sozinha.
 */
function ChannelChoice({
  label,
  hint,
  value,
  channels,
  texts,
  onChange,
}: {
  label: string;
  hint: string | undefined;
  value: string | number | boolean | undefined;
  channels: readonly string[];
  texts: { all: string; noChannels: string; channelsLimit: string };
  onChange: (v: string | undefined) => void;
}) {
  const picked = new Set(parseChannelNames(value));
  const items = [...new Set([...channels, ...picked])].sort(compareAlpha);
  const full = picked.size >= CHANNEL_GUIDE_MAX_CHANNELS;
  const toggle = (name: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(name);
    else next.delete(name);
    onChange(next.size ? [...next].join('\n') : undefined);
  };
  return (
    <Field className="sm:col-span-2">
      <FieldLabel>{label}</FieldLabel>
      {items.length ? (
        <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
          {items.map((name) => (
            <label key={name} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={picked.has(name)}
                disabled={full && !picked.has(name)}
                onCheckedChange={(on) => toggle(name, !!on)}
              />
              <span className="truncate">{name}</span>
            </label>
          ))}
        </div>
      ) : null}
      <FieldDescription>
        {!items.length
          ? texts.noChannels
          : full
            ? texts.channelsLimit
            : (hint ?? (picked.size ? null : texts.all))}
      </FieldDescription>
    </Field>
  );
}
