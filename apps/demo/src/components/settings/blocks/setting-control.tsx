'use client';

import type { SettingDef } from '@galaxie/runtime-config';

import { displayValue, optionLabel, settingText } from '@/components/ops/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

import { controlKind } from './logic';

const EMPTY = '__vazio__';

export interface SettingControlProps {
  def: SettingDef;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  /** Plano padrão efetivo (o "herdar" dos planos por esporte). */
  inheritPlan?: string | null | undefined;
  defaultValue: string | null;
  /** Rótulo acessível (a linha mostra o rótulo ao lado, fora do controle). */
  label?: string;
  className?: string;
}

/**
 * O controle certo pelo tipo do registro (#1074): switch para `off`/`on`, `toggle-group` de 2 a 4 opções, `select`
 * para listas maiores ou com "herdar", campo com unidade (`input-group`) e campo simples (texto e agenda).
 */
export function SettingControl({
  def,
  value,
  onChange,
  disabled,
  inheritPlan,
  defaultValue,
  label,
  className,
}: SettingControlProps) {
  const { t, locale } = useI18n();
  const T = t.ops;
  const text = settingText(T, def);
  const aria = label ?? text.label;
  const options = def.options ?? [];
  const kind = controlKind(def, text.unit);

  if (kind === 'switch')
    return (
      <Switch
        checked={value === 'on'}
        onCheckedChange={(on) => onChange(on ? 'on' : 'off')}
        disabled={disabled}
        aria-label={aria}
        className={className}
      />
    );

  if (kind === 'toggle')
    return (
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        value={[value]}
        onValueChange={(next) => next[0] && onChange(next[0])}
        disabled={disabled}
        aria-label={aria}
        className={cn('w-full', className)}
      >
        {options.map((o) => (
          <ToggleGroupItem
            key={o}
            value={o}
            className="data-[pressed]:bg-primary data-[pressed]:text-primary-foreground flex-1"
          >
            {optionLabel(T, def, o)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    );

  if (kind === 'select') {
    const items = [
      ...(def.allowEmpty
        ? [{ value: EMPTY, label: displayValue(T, def, null, { locale, inheritPlan: inheritPlan ?? null }) }]
        : []),
      ...options.map((o) => ({ value: o, label: optionLabel(T, def, o) })),
    ];
    return (
      <Select
        items={items}
        value={value === '' ? EMPTY : value}
        onValueChange={(next) => onChange(next === EMPTY || next === null ? '' : String(next))}
        disabled={disabled}
      >
        <SelectTrigger className={cn('w-full', className)} aria-label={aria}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (kind === 'markets') {
    const selected = value
      ? value
          .split(/[\s,;]+/)
          .filter(Boolean)
          .map((v) => v.toUpperCase())
      : [];
    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        <ToggleGroup
          variant="outline"
          size="sm"
          multiple
          value={selected}
          onValueChange={(next) => onChange(options.filter((o) => next.includes(o)).join(','))}
          disabled={disabled}
          aria-label={aria}
          className="flex-wrap"
        >
          {options.map((o) => (
            <ToggleGroupItem
              key={o}
              value={o}
              className="data-[pressed]:bg-primary data-[pressed]:text-primary-foreground font-mono text-xs"
            >
              {o}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {!selected.length ? (
          <span className="text-muted-foreground text-xs">{T.values.tenantsMarkets}</span>
        ) : null}
      </div>
    );
  }

  const unlimited = value.trim().toLowerCase() === 'unlimited';
  const placeholder = unlimited
    ? T.values.unlimited
    : kind === 'cron'
      ? T.cron.placeholder
      : (defaultValue ?? '');
  const common = {
    value: unlimited ? '' : value,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
    disabled,
    inputMode: def.type === 'int' || def.type === 'number' ? ('decimal' as const) : undefined,
    spellCheck: false,
    'aria-label': aria,
  };
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {kind === 'unit' ? (
        <InputGroup className="flex-1">
          <InputGroupInput {...common} className="tabular-nums" />
          <InputGroupAddon align="inline-end">
            <InputGroupText>{text.unit}</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      ) : (
        <Input
          {...common}
          className={cn('flex-1', (kind === 'cron' || def.type === 'text') && 'font-mono text-xs')}
        />
      )}
      {def.unlimited ? (
        <Button
          variant={unlimited ? 'secondary' : 'outline'}
          size="sm"
          disabled={disabled}
          onClick={() => onChange(unlimited ? (defaultValue ?? '') : 'unlimited')}
        >
          {T.actions.unlimited}
        </Button>
      ) : null}
      {kind === 'cron' ? (
        <Button
          variant={value === 'off' ? 'secondary' : 'outline'}
          size="sm"
          disabled={disabled}
          onClick={() => onChange(value === 'off' ? (defaultValue ?? '') : 'off')}
        >
          {value === 'off' ? T.actions.turnOn : T.actions.turnOff}
        </Button>
      ) : null}
    </div>
  );
}
