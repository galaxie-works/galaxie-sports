'use client';

import { History, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { ExplainEmpty, SafetyNote, SettingOption, SettingsSection } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { removeCosmosModerationOverride, saveCosmosModeration } from '@/lib/cosmos/moderation-actions';
import type { CosmosModerationData } from '@/lib/cosmos/moderation-data';
import {
  AUTONOMY_STEPS,
  HIDDEN_NOTICE_MAX,
  LOCKED_CATEGORIES,
  MODERATION_ACTIONS,
  MODERATION_CATEGORIES,
  MODERATION_FEATURES,
  MODERATION_LEVEL_MAX,
  maxStepFor,
  stepAllowed,
  TENANT_ROLES,
  type AutonomyStep,
  type ModerationAction,
  type ModerationConfig,
  type ModerationLevel,
} from '@/lib/cosmos/moderation-utils';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

const MUTE_HOURS = [1, 2, 3, 6, 12, 24];
const first = (v: number | readonly number[]) => (Array.isArray(v) ? (v[0] ?? 0) : (v as number));

/**
 * Aba Moderação da Cosmos (#997): recursos, rigor por categoria, escada de autonomia por ação, cargos que a Cosmos só
 * sinaliza, texto do conteúdo escondido, exceções e histórico. Sem `canEdit`, só leitura. O servidor valida de novo.
 */
export function CosmosModeration({ data, canEdit }: { data: CosmosModerationData; canEdit: boolean }) {
  const { t, locale } = useI18n();
  const T = t.cosmos.moderation;
  const roles = t.client.members.roles;
  const router = useRouter();
  const ids = useId();
  const [config, setConfig] = useState<ModerationConfig>(data.config);
  const [pending, startTransition] = useTransition();
  const readOnly = !canEdit || pending;
  // o texto só de espaços vale como vazio (o servidor grava null): sem isto o formulário ficaria sempre "mudado"
  const payload: ModerationConfig = { ...config, hiddenNotice: config.hiddenNotice?.trim() || null };
  const dirty = JSON.stringify(payload) !== JSON.stringify(data.config);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
  // o teto e o valor gravado entram na lista mesmo fora dos degraus comuns (teto de 8 h, por exemplo)
  const muteOptions = [...new Set([...MUTE_HOURS, data.ceiling.muteHours, config.muteHours])]
    .filter((h) => h <= data.ceiling.muteHours)
    .sort((a, b) => a - b);

  const patch = (p: Partial<ModerationConfig>) => setConfig((c) => ({ ...c, ...p }));
  const setStep = (action: ModerationAction, step: AutonomyStep) =>
    setConfig((c) => ({ ...c, autonomy: { ...c.autonomy, [action]: step } }));

  const save = () =>
    startTransition(async () => {
      const r = await saveCosmosModeration(payload, data.version);
      if (!r.ok) {
        toast.error(r.error);
        if (r.conflict) router.refresh();
        return;
      }
      toast.success(T.saved);
      router.refresh();
    });

  const removeOverride = (o: CosmosModerationData['overrides'][number]) =>
    startTransition(async () => {
      const r = await removeCosmosModerationOverride(o.scope, o.version);
      if (!r.ok) toast.error(r.error);
      else toast.success(T.removed);
      router.refresh();
    });

  const scopeLabel = (scope: CosmosModerationData['overrides'][number]['scope']) =>
    scope.kind === 'tenant' ? T.general : `${T.scopeKinds[scope.kind]} ${scope.id}`;

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={T.title} description={T.description}>
        {!canEdit ? <SafetyNote>{T.readOnly}</SafetyNote> : null}
      </SettingsSection>

      <SettingsSection title={T.featuresTitle} description={T.featuresDescription}>
        {MODERATION_FEATURES.map((f) => (
          <SettingOption
            key={f}
            title={T.features[f].title}
            description={T.features[f].description}
            safety={T.features[f].safety}
            checked={config.features[f]}
            disabled={readOnly}
            onCheckedChange={(on) => patch({ features: { ...config.features, [f]: on } })}
          />
        ))}
      </SettingsSection>

      <SettingsSection title={T.rigorTitle} description={T.rigorDescription}>
        <Field>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <FieldLabel htmlFor={`${ids}-level`}>{T.level}</FieldLabel>
            <span className="text-sm font-medium">{T.levels[config.level]}</span>
          </div>
          <Slider
            id={`${ids}-level`}
            aria-label={T.level}
            min={0}
            max={MODERATION_LEVEL_MAX}
            step={1}
            value={config.level}
            disabled={readOnly}
            onValueChange={(v) => patch({ level: first(v) as ModerationLevel })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {MODERATION_CATEGORIES.map((c) => {
            const value = config.categories[c];
            return (
              <Field key={c}>
                <FieldLabel htmlFor={`${ids}-cat-${c}`}>{T.categories[c]}</FieldLabel>
                <Select
                  value={value === undefined ? 'general' : String(value)}
                  disabled={readOnly}
                  onValueChange={(v) => {
                    const next = { ...config.categories };
                    if (v === 'general' || v === null) delete next[c];
                    else next[c] = Number(v) as ModerationLevel;
                    patch({ categories: next });
                  }}
                >
                  <SelectTrigger id={`${ids}-cat-${c}`} className="w-full">
                    <SelectValue>
                      {(v: string) => (v === 'general' ? T.categoryGeneral : T.levels[Number(v)])}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">{T.categoryGeneral}</SelectItem>
                    {T.levels.map((label, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            );
          })}
          {LOCKED_CATEGORIES.map((c) => (
            <Field key={c}>
              <FieldLabel>{T.categories[c]}</FieldLabel>
              <FieldDescription>{T.locked}</FieldDescription>
            </Field>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={T.autonomyTitle} description={T.autonomyDescription}>
        <div className="flex flex-col gap-4">
          {MODERATION_ACTIONS.map((action) => {
            const max = maxStepFor(action, data.ceiling);
            return (
              <Field key={action}>
                <FieldLabel>{T.actions[action]}</FieldLabel>
                {max === 'flag' && (action === 'suspend' || action === 'ban') ? (
                  <FieldDescription>{T.needsPerson}</FieldDescription>
                ) : (
                  <ToggleGroup
                    variant="outline"
                    size="sm"
                    spacing={0}
                    aria-label={T.actions[action]}
                    value={[config.autonomy[action]]}
                    disabled={readOnly}
                    onValueChange={(next) => {
                      const v = next[0] as AutonomyStep | undefined;
                      if (v && stepAllowed(v, max)) setStep(action, v);
                    }}
                  >
                    {AUTONOMY_STEPS.map((step) => (
                      <ToggleGroupItem key={step} value={step} disabled={!stepAllowed(step, max)}>
                        {T.steps[step]}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                )}
              </Field>
            );
          })}
          <p className="text-muted-foreground text-xs">{T.ceilingNote}</p>
          <Field>
            <FieldLabel htmlFor={`${ids}-mute`}>{T.muteHours}</FieldLabel>
            <Select
              value={String(config.muteHours)}
              disabled={readOnly}
              onValueChange={(v) => v !== null && patch({ muteHours: Number(v) })}
            >
              <SelectTrigger id={`${ids}-mute`} className="w-40">
                <SelectValue>{(v: string) => fill(T.hours, { hours: v })}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {muteOptions.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {fill(T.hours, { hours: h })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title={T.exemptTitle} description={T.exemptDescription}>
        <div className="flex flex-wrap gap-4">
          {TENANT_ROLES.map((role) => (
            <Label key={role} className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={config.exemptRoles.includes(role)}
                disabled={readOnly}
                onCheckedChange={(on) =>
                  patch({
                    exemptRoles: on
                      ? [...config.exemptRoles, role]
                      : config.exemptRoles.filter((r) => r !== role),
                  })
                }
              />
              {roles[role]}
            </Label>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={T.noticeTitle} description={T.noticeDescription}>
        <Field>
          <Textarea
            aria-label={T.noticeTitle}
            value={config.hiddenNotice ?? ''}
            placeholder={T.noticePlaceholder}
            maxLength={HIDDEN_NOTICE_MAX}
            disabled={readOnly}
            onChange={(e) => patch({ hiddenNotice: e.target.value || null })}
          />
          <FieldDescription>
            {fill(T.noticeCount, { count: (config.hiddenNotice ?? '').length, max: HIDDEN_NOTICE_MAX })}
          </FieldDescription>
        </Field>
      </SettingsSection>

      {canEdit ? (
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending || !dirty}>
            {T.save}
          </Button>
        </div>
      ) : null}

      <SettingsSection title={T.overridesTitle} description={T.overridesDescription}>
        {data.overrides.length === 0 ? (
          <p className="text-muted-foreground text-sm">{T.overridesEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.overrides.map((o) => (
              <li
                key={`${o.scope.kind}:${o.scope.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
              >
                <span>{scopeLabel(o.scope)}</span>
                {canEdit ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => removeOverride(o)}>
                    {T.remove}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection title={T.historyTitle}>
        {data.history.length === 0 ? (
          <ExplainEmpty
            icon={ShieldCheck}
            title={T.historyTitle}
            description={T.historyEmpty}
            className="rounded-xl border"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {data.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 text-sm">
                <History aria-hidden className="text-muted-foreground size-4" />
                <span>
                  {h.removed
                    ? fill(T.historyRemoved, { who: h.who ?? T.someone, scope: scopeLabel(h.scope) })
                    : fill(T.historySaved, { who: h.who ?? T.someone, version: h.version })}
                  {h.scope.kind !== 'tenant' && !h.removed ? ` · ${scopeLabel(h.scope)}` : ''}
                </span>
                <span className="text-muted-foreground text-xs">{when.format(new Date(h.at))}</span>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </div>
  );
}
