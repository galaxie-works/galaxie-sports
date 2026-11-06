'use client';

import {
  LIVE_LIST_DAYS,
  LIVE_LIST_FIELDS,
  LIVE_LIST_FIELD_DEFAULTS,
  LIVE_LIST_LIMIT,
  LIVE_LIST_MODES,
  LIVE_LIST_ORDERS,
  LIVE_LIST_TEAM_NAMES,
  isEventLinkTemplate,
  type LiveListField,
  type LiveListOptions,
} from '@galaxie/widgets';

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { sortByLabel } from '@/lib/alphabetical';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/** Opções de quantidade de jogos oferecidas no Builder. */
const LIMITS = [10, 20, 30, 50, 100] as const;

/** Níveis de destaque: relevância mínima no país do widget (0 = todos os jogos). */
const HIGHLIGHTS = [0, 50, 70] as const;

type Item = { value: string; label: string };

/**
 * Opções da lista de jogos: quais jogos entram (modo, dia, destaque, país), ordem, quantidade, agrupamento,
 * atualização automática, nome dos times, link de cada jogo e os dados extras de cada linha. Opção não
 * tocada fica de fora do que é salvo e vale o padrão do widget.
 */
export function LiveListOptionsEditor({
  value,
  onChange,
}: {
  value: LiveListOptions;
  onChange: (next: LiveListOptions) => void;
}) {
  const { t } = useI18n();
  const l = t.client.editor.liveList;
  const set = <K extends keyof LiveListOptions>(key: K, v: LiveListOptions[K]) =>
    onChange({ ...value, [key]: v });

  const mode = value.mode ?? 'all';
  const modes = LIVE_LIST_MODES.map((m) => ({ value: m, label: l.modes[m] }));
  const days = LIVE_LIST_DAYS.map((d) => ({ value: d, label: l.days[d] }));
  const orders = LIVE_LIST_ORDERS.map((o) => ({ value: o, label: l.orders[o] }));
  const teamNames = LIVE_LIST_TEAM_NAMES.map((n) => ({ value: n, label: l.teamNames[n] }));
  const minRelevance = value.minRelevance ?? 0;
  const highlights = [...new Set<number>([...HIGHLIGHTS, minRelevance])]
    .sort((a, b) => a - b)
    .map((n) => ({
      value: String(n),
      label:
        n === 0 ? l.highlightAll : n === 50 ? l.highlightRelevant : n === 70 ? l.highlightMajor : String(n),
    }));
  const limit = value.limit ?? LIVE_LIST_LIMIT.default;
  const limits = [...new Set<number>([...LIMITS, limit])]
    .sort((a, b) => a - b)
    .map((n) => ({ value: String(n), label: fill(l.limitItem, { n }) }));
  const countries: Item[] = [
    { value: 'all', label: l.countryAll },
    ...sortByLabel(Object.entries(t.nav.countries).map(([code, label]) => ({ value: code, label }))),
  ];
  const fields = sortByLabel(
    LIVE_LIST_FIELDS.map((key) => ({ key, label: l.fields[key].label, hint: l.fields[key].hint })),
  );
  const fieldOn = (key: LiveListField) => value[key] ?? LIVE_LIST_FIELD_DEFAULTS[key];
  const link = value.eventLink ?? '';
  const linkInvalid = link !== '' && !isEventLinkTemplate(link);

  return (
    <div className="flex flex-col gap-6">
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="live-list-mode"
          label={l.mode}
          hint={l.modeHints[mode]}
          items={modes}
          value={mode}
          onChange={(v) => set('mode', v as LiveListOptions['mode'])}
        />
        {mode !== 'live' ? (
          <SelectField
            id="live-list-day"
            label={l.day}
            hint={l.dayHint}
            items={days}
            value={value.day ?? 'today'}
            onChange={(v) => set('day', v as LiveListOptions['day'])}
          />
        ) : null}
        <SelectField
          id="live-list-highlight"
          label={l.highlight}
          hint={l.highlightHint}
          items={highlights}
          value={String(minRelevance)}
          onChange={(v) => set('minRelevance', Number(v) || undefined)}
        />
        <SelectField
          id="live-list-order"
          label={l.order}
          hint={l.orderHint}
          items={orders}
          value={value.order ?? 'time'}
          onChange={(v) => set('order', v as LiveListOptions['order'])}
        />
        <SelectField
          id="live-list-country"
          label={l.country}
          hint={l.countryHint}
          items={countries}
          value={value.country ?? 'all'}
          onChange={(v) => set('country', v === 'all' ? undefined : v)}
        />
        <SelectField
          id="live-list-limit"
          label={l.limit}
          hint={l.limitHint}
          items={limits}
          value={String(limit)}
          onChange={(v) => set('limit', Number(v))}
        />
        <SelectField
          id="live-list-team-name"
          label={l.teamName}
          hint={l.teamNameHint}
          items={teamNames}
          value={value.teamName ?? 'full'}
          onChange={(v) => set('teamName', v as LiveListOptions['teamName'])}
        />
      </FieldGroup>

      <ToggleRow
        id="live-list-group"
        label={l.group}
        hint={l.groupHint}
        checked={value.groupByCompetition ?? true}
        onChange={(checked) => set('groupByCompetition', checked)}
      />
      <ToggleRow
        id="live-list-refresh"
        label={l.refresh}
        hint={l.refreshHint}
        checked={value.autoRefresh ?? true}
        onChange={(checked) => set('autoRefresh', checked)}
      />

      <FieldSet className="gap-4">
        <FieldLegend variant="label">{l.fieldsTitle}</FieldLegend>
        <FieldDescription>{l.fieldsHint}</FieldDescription>
        {fields.map((f) => (
          <ToggleRow
            key={f.key}
            id={`live-list-${f.key}`}
            label={f.label}
            hint={f.hint}
            checked={fieldOn(f.key)}
            onChange={(checked) => set(f.key, checked)}
          />
        ))}
      </FieldSet>

      <FieldSet className="gap-4">
        <FieldLegend variant="label">{l.linkTitle}</FieldLegend>
        <Field data-invalid={linkInvalid || undefined}>
          <FieldLabel htmlFor="live-list-link">{l.link}</FieldLabel>
          <Input
            id="live-list-link"
            inputMode="url"
            placeholder={l.linkPlaceholder}
            value={link}
            aria-invalid={linkInvalid || undefined}
            onChange={(ev) => set('eventLink', ev.target.value.trim() || undefined)}
          />
          {linkInvalid ? (
            <FieldError>{l.linkInvalid}</FieldError>
          ) : (
            <FieldDescription>{l.linkHint}</FieldDescription>
          )}
        </Field>
        {link && !linkInvalid ? (
          <ToggleRow
            id="live-list-link-tab"
            label={l.linkNewTab}
            hint={l.linkNewTabHint}
            checked={value.eventLinkNewTab ?? false}
            onChange={(checked) => set('eventLinkNewTab', checked)}
          />
        ) : null}
      </FieldSet>
    </div>
  );
}

function SelectField({
  id,
  label,
  hint,
  items,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  items: Item[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select items={items} value={value} onValueChange={(v) => onChange(String(v ?? ''))}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>{hint}</FieldDescription>
    </Field>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Field orientation="horizontal" className="items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{hint}</FieldDescription>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Field>
  );
}
