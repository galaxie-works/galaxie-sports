'use client';

import {
  LIVE_LIST_FIELDS,
  LIVE_LIST_FIELD_DEFAULTS,
  LIVE_LIST_LIMIT,
  type LiveListField,
  type LiveListOptions,
} from '@galaxie/widgets';

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { sortByLabel } from '@/lib/alphabetical';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/** Opções de quantidade de jogos oferecidas no Builder. */
const LIMITS = [10, 20, 30, 50, 100] as const;

/**
 * Opções da lista de jogos: todos os jogos do dia ou só os ao vivo, agrupar por campeonato, atualização
 * automática, quantidade de jogos e os dados extras de cada linha (logo do campeonato, rodada, estádio,
 * cidade). Opção não tocada fica de fora do que é salvo e vale o padrão do widget.
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
  const modes = [
    { value: 'day', label: l.modeDay },
    { value: 'live', label: l.modeLive },
  ];
  const limit = value.limit ?? LIVE_LIST_LIMIT.default;
  const limits = [...new Set<number>([...LIMITS, limit])]
    .sort((a, b) => a - b)
    .map((n) => ({ value: String(n), label: fill(l.limitItem, { n }) }));
  const fields = sortByLabel(
    LIVE_LIST_FIELDS.map((key) => ({ key, label: l.fields[key].label, hint: l.fields[key].hint })),
  );
  const fieldOn = (key: LiveListField) => value[key] ?? LIVE_LIST_FIELD_DEFAULTS[key];

  return (
    <div className="flex flex-col gap-6">
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="live-list-mode">{l.mode}</FieldLabel>
          <Select
            items={modes}
            value={value.liveOnly ? 'live' : 'day'}
            onValueChange={(v) => onChange({ ...value, liveOnly: v === 'live' })}
          >
            <SelectTrigger id="live-list-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modes.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{value.liveOnly ? l.modeLiveHint : l.modeDayHint}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="live-list-limit">{l.limit}</FieldLabel>
          <Select
            items={limits}
            value={String(limit)}
            onValueChange={(v) => v && onChange({ ...value, limit: Number(v) })}
          >
            <SelectTrigger id="live-list-limit" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {limits.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{l.limitHint}</FieldDescription>
        </Field>
      </FieldGroup>

      <ToggleRow
        id="live-list-group"
        label={l.group}
        hint={l.groupHint}
        checked={value.groupByCompetition ?? true}
        onChange={(checked) => onChange({ ...value, groupByCompetition: checked })}
      />
      <ToggleRow
        id="live-list-refresh"
        label={l.refresh}
        hint={l.refreshHint}
        checked={value.autoRefresh ?? true}
        onChange={(checked) => onChange({ ...value, autoRefresh: checked })}
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
            onChange={(checked) => onChange({ ...value, [f.key]: checked })}
          />
        ))}
      </FieldSet>
    </div>
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
