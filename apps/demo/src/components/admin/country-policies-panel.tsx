'use client';

import {
  LATAM_POLICY_KEY,
  POLICY_LANGUAGES,
  type CountryPolicy,
  type PolicyEntity,
  type PolicyLanguage,
  type TenantCountry,
} from '@galaxie/engage';
import { Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  savePolicyAction,
  setTenantCountriesAction,
  type PolicyActionResult,
} from '@/app/[locale]/(app)/ajustes/ficha-por-pais/actions';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

export interface PolicyView {
  country: string;
  policy: CountryPolicy;
  version: number;
  updatedAt: string;
}

export interface PolicyLogView {
  country: string;
  version: number;
  changedBy: string;
  reason: string | null;
  changedAt: string;
}

export interface TenantView {
  id: string;
  name: string;
  countries: TenantCountry[];
}

/**
 * Ajustes → Conformidade → Ficha por país (#954): as fichas por país (tabela e edição com versão e motivo), o histórico e os
 * países de cada cliente. As regras são conferidas de novo no servidor, em `@galaxie/engage`.
 */
export function CountryPoliciesPanel({
  policies,
  log,
  tenants,
  timeZone,
}: {
  policies: PolicyView[];
  log: PolicyLogView[];
  tenants: TenantView[];
  timeZone: string;
}) {
  const { t, locale } = useI18n();
  const T = t.countryPolicies;
  const f = useFormatters(timeZone);
  const [editing, setEditing] = useState<PolicyView | 'new' | null>(null);
  const regionName = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return (key: string) => (key === LATAM_POLICY_KEY ? T.policies.latam : (names.of(key) ?? key));
  }, [locale, T.policies.latam]);

  return (
    <div className="flex flex-col gap-4">
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="flex flex-row items-start justify-between gap-4 p-4">
            <div className="flex flex-col gap-1">
              <FrameTitle>{T.policies.title}</FrameTitle>
              <FrameDescription>{T.policies.description}</FrameDescription>
            </div>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus />
              {T.policies.add}
            </Button>
          </FrameHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{T.policies.country}</TableHead>
                <TableHead>{T.policies.entity}</TableHead>
                <TableHead>{T.policies.currency}</TableHead>
                <TableHead>{T.policies.languages}</TableHead>
                <TableHead>{T.policies.ages}</TableHead>
                <TableHead>{T.policies.retention}</TableHead>
                <TableHead>{T.policies.version}</TableHead>
                <TableHead className="sr-only">{T.policies.edit}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.map((p) => (
                <TableRow key={p.country}>
                  <TableCell className="font-medium">
                    {regionName(p.country)}{' '}
                    <span className="text-muted-foreground font-mono text-xs">{p.country}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{p.policy.entity.toUpperCase()}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.policy.currency}</TableCell>
                  <TableCell className="text-xs">{p.policy.languages.join(', ')}</TableCell>
                  <TableCell className="text-xs">
                    {fill(T.policies.agesValue, {
                      participate: p.policy.minAgeParticipate,
                      write: p.policy.minAgeWrite,
                    })}
                  </TableCell>
                  <TableCell className="text-xs">
                    {fill(T.policies.retentionValue, {
                      access: p.policy.retention.accessLogDays,
                      removed: p.policy.retention.removedContentDays,
                      decisions: p.policy.retention.moderationDecisionsDays,
                    })}
                  </TableCell>
                  <TableCell className="text-xs">v{p.version}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(p)}
                      aria-label={T.policies.edit}
                    >
                      <Pencil />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </FramePanel>
      </Frame>

      <div className="grid gap-4 lg:grid-cols-2">
        <TenantCountriesCard tenants={tenants} policies={policies} regionName={regionName} />
        <Frame>
          <FramePanel className="p-0">
            <FrameHeader className="p-4">
              <FrameTitle>{T.log.title}</FrameTitle>
              <FrameDescription>{T.log.description}</FrameDescription>
            </FrameHeader>
            {log.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{T.policies.country}</TableHead>
                    <TableHead>{T.log.when}</TableHead>
                    <TableHead>{T.log.who}</TableHead>
                    <TableHead>{T.log.reason}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {log.map((l) => (
                    <TableRow key={`${l.country}:${l.version}`}>
                      <TableCell className="font-mono text-xs">
                        {l.country} v{l.version}
                      </TableCell>
                      <TableCell className="text-xs">{f.relative(l.changedAt)}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{l.changedBy}</TableCell>
                      <TableCell className="text-xs">{l.reason ?? T.log.noReason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground p-4 text-sm">{T.log.empty}</p>
            )}
          </FramePanel>
        </Frame>
      </div>

      {editing ? (
        <PolicyDialog
          key={editing === 'new' ? 'new' : `${editing.country}:${editing.version}`}
          current={editing === 'new' ? null : editing}
          template={policies.find((p) => p.country === 'BR')?.policy ?? null}
          onClose={() => setEditing(null)}
          regionName={regionName}
        />
      ) : null}
    </div>
  );
}

function TenantCountriesCard({
  tenants,
  policies,
  regionName,
}: {
  tenants: TenantView[];
  policies: PolicyView[];
  regionName: (key: string) => string;
}) {
  const { t } = useI18n();
  const T = t.countryPolicies;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const tenant = tenants.find((x) => x.id === tenantId) ?? null;
  const [selected, setSelected] = useState<TenantCountry[]>([]);
  const countryKeys = policies.map((p) => p.country).filter((k) => k !== LATAM_POLICY_KEY);
  const primary = selected.find((c) => c.primary)?.country ?? null;

  const choose = (id: string | null) => {
    setTenantId(id);
    setSelected(tenants.find((x) => x.id === id)?.countries ?? []);
  };
  const toggle = (country: string, on: boolean) =>
    setSelected((prev) => {
      if (!on) return prev.filter((c) => c.country !== country);
      const next = [...prev, { country, primary: false, hardening: null }];
      return next.some((c) => c.primary) ? next : next.map((c, i) => ({ ...c, primary: i === 0 }));
    });
  const save = () =>
    start(async () => {
      if (!tenant) return;
      const r: PolicyActionResult = await setTenantCountriesAction(tenant.id, selected);
      if (!r.ok) return void toast.error(r.error ?? T.errors.generic);
      toast.success(T.tenants.saved);
      router.refresh();
    });
  const tenantItems = tenants.map((x) => ({ value: x.id, label: x.name }));
  const primaryItems = selected.map((c) => ({ value: c.country, label: regionName(c.country) }));

  return (
    <Frame>
      <FramePanel className="p-0">
        <FrameHeader className="p-4">
          <FrameTitle>{T.tenants.title}</FrameTitle>
          <FrameDescription>{T.tenants.description}</FrameDescription>
        </FrameHeader>
        <FieldGroup className="p-4 pt-0">
          <Field>
            <FieldLabel htmlFor="tenant-country-tenant">{T.tenants.tenant}</FieldLabel>
            <Select items={tenantItems} value={tenantId} onValueChange={(v) => choose(v ? String(v) : null)}>
              <SelectTrigger id="tenant-country-tenant" className="w-full">
                <SelectValue placeholder={T.tenants.chooseTenant} />
              </SelectTrigger>
              <SelectContent>
                {tenantItems.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {tenant ? (
            <>
              <Field>
                <FieldLabel>{T.tenants.countries}</FieldLabel>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {countryKeys.map((k) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selected.some((c) => c.country === k)}
                        onCheckedChange={(on) => toggle(k, on === true)}
                        disabled={pending}
                      />
                      {regionName(k)}
                    </label>
                  ))}
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="tenant-country-primary">{T.tenants.primary}</FieldLabel>
                {selected.length ? (
                  <Select
                    items={primaryItems}
                    value={primary}
                    onValueChange={(v) =>
                      setSelected((prev) => prev.map((c) => ({ ...c, primary: c.country === String(v) })))
                    }
                  >
                    <SelectTrigger id="tenant-country-primary" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {primaryItems.map((i) => (
                        <SelectItem key={i.value} value={i.value}>
                          {i.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <FieldDescription>{T.tenants.none}</FieldDescription>
                )}
              </Field>
              <div>
                <Button onClick={save} disabled={pending}>
                  {pending ? <Spinner /> : null}
                  {T.tenants.save}
                </Button>
              </div>
            </>
          ) : null}
        </FieldGroup>
      </FramePanel>
    </Frame>
  );
}

const EMPTY: CountryPolicy = {
  minAgeWrite: 18,
  minAgeParticipate: 13,
  retention: { accessLogDays: 183, removedContentDays: 90, moderationDecisionsDays: 730 },
  entity: 'ltda',
  currency: '',
  dateFormat: 'dd/MM/yyyy',
  timeZone: 'UTC',
  languages: ['es'],
  adsToMinors: false,
  gamification: { materialExchange: false, marketplace: false, raffle: false },
  prizeCampaign: { maxValue: null, excludedRegions: [], legalClassificationRequired: true },
  punishmentNoticeRequired: false,
  laws: [],
};

function PolicyDialog({
  current,
  template,
  onClose,
  regionName,
}: {
  current: PolicyView | null;
  template: CountryPolicy | null;
  onClose: () => void;
  regionName: (key: string) => string;
}) {
  const { t } = useI18n();
  const T = t.countryPolicies;
  const F = T.form;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [country, setCountry] = useState(current?.country ?? '');
  const [p, setP] = useState<CountryPolicy>(() =>
    structuredClone(current?.policy ?? { ...(template ?? EMPTY), laws: [], currency: '' }),
  );
  const [reason, setReason] = useState('');
  const [allowLower, setAllowLower] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [lawsText, setLawsText] = useState(p.laws.join('\n'));
  const [regionsText, setRegionsText] = useState(p.prizeCampaign.excludedRegions.join(', '));

  const num = (v: string) => (v.trim() === '' ? Number.NaN : Number(v));
  const set = (patch: Partial<CountryPolicy>) => setP((prev) => ({ ...prev, ...patch }));

  const submit = () =>
    start(async () => {
      const policy: CountryPolicy = {
        ...p,
        currency: p.currency.trim().toUpperCase(),
        laws: lawsText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
        prizeCampaign: {
          ...p.prizeCampaign,
          excludedRegions: regionsText
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean),
        },
      };
      const r = await savePolicyAction({
        country,
        policy,
        expectedVersion: current?.version ?? null,
        reason,
        allowLowerWriteAge: allowLower,
      });
      if (!r.ok) {
        setIssues((r.issues ?? []).map((i) => `${i.path}: ${i.message}`));
        return void toast.error(r.error ?? T.errors.generic);
      }
      toast.success(fill(F.saved, { country: country.toUpperCase(), version: r.version ?? '' }));
      onClose();
      router.refresh();
    });

  const numberField = (
    id: string,
    label: string,
    value: number,
    onChange: (n: number) => void,
    hint?: string,
  ) => (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(num(e.target.value))}
        disabled={pending}
      />
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  );
  const switchField = (
    id: string,
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
    hint?: string,
  ) => (
    <Field orientation="horizontal">
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={pending} />
      <div className="flex flex-col gap-0.5">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      </div>
    </Field>
  );
  const entityItems = [
    { value: 'ltda', label: F.ltda },
    { value: 'llc', label: F.llc },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {current ? fill(F.titleEdit, { country: regionName(current.country) }) : F.titleNew}
          </DialogTitle>
          <DialogDescription>{F.description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <FieldGroup>
            {current ? null : (
              <Field>
                <FieldLabel htmlFor="policy-country">{F.country}</FieldLabel>
                <Input
                  id="policy-country"
                  value={country}
                  maxLength={5}
                  onChange={(e) => setCountry(e.target.value.toUpperCase())}
                  disabled={pending}
                  className="font-mono"
                />
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {numberField(
                'policy-participate',
                F.minAgeParticipate,
                p.minAgeParticipate,
                (n) => set({ minAgeParticipate: n }),
                F.minAgeParticipateHint,
              )}
              {numberField('policy-write', F.minAgeWrite, p.minAgeWrite, (n) => set({ minAgeWrite: n }))}
            </div>
            {p.minAgeWrite < 18 ? (
              <Field orientation="horizontal">
                <Checkbox
                  id="policy-lower"
                  checked={allowLower}
                  onCheckedChange={(v) => setAllowLower(v === true)}
                  disabled={pending}
                />
                <div className="flex flex-col gap-0.5">
                  <FieldLabel htmlFor="policy-lower">{F.allowLowerWriteAge}</FieldLabel>
                  <FieldDescription>{F.allowLowerWriteAgeHint}</FieldDescription>
                </div>
              </Field>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-3">
              {numberField(
                'policy-access',
                `${F.accessLogDays} (${F.days})`,
                p.retention.accessLogDays,
                (n) => set({ retention: { ...p.retention, accessLogDays: n } }),
              )}
              {numberField(
                'policy-removed',
                `${F.removedContentDays} (${F.days})`,
                p.retention.removedContentDays,
                (n) => set({ retention: { ...p.retention, removedContentDays: n } }),
              )}
              {numberField(
                'policy-decisions',
                `${F.moderationDecisionsDays} (${F.days})`,
                p.retention.moderationDecisionsDays,
                (n) => set({ retention: { ...p.retention, moderationDecisionsDays: n } }),
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="policy-entity">{F.entity}</FieldLabel>
                <Select
                  items={entityItems}
                  value={p.entity}
                  onValueChange={(v) => v && set({ entity: String(v) as PolicyEntity })}
                >
                  <SelectTrigger id="policy-entity" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {entityItems.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="policy-currency">{F.currency}</FieldLabel>
                <Input
                  id="policy-currency"
                  value={p.currency}
                  maxLength={3}
                  onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
                  disabled={pending}
                  className="font-mono"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="policy-date">{F.dateFormat}</FieldLabel>
                <Input
                  id="policy-date"
                  value={p.dateFormat}
                  onChange={(e) => set({ dateFormat: e.target.value })}
                  disabled={pending}
                  className="font-mono"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="policy-tz">{F.timeZone}</FieldLabel>
                <Input
                  id="policy-tz"
                  value={p.timeZone}
                  onChange={(e) => set({ timeZone: e.target.value })}
                  disabled={pending}
                  className="font-mono"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel>{F.languages}</FieldLabel>
              <div className="flex flex-wrap gap-4">
                {POLICY_LANGUAGES.map((l) => (
                  <label key={l} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={p.languages.includes(l)}
                      onCheckedChange={(on) =>
                        set({
                          languages: on
                            ? [...p.languages, l]
                            : p.languages.filter((x): x is PolicyLanguage => x !== l),
                        })
                      }
                      disabled={pending}
                    />
                    {l}
                  </label>
                ))}
              </div>
            </Field>
            {switchField('policy-ads', F.adsToMinors, p.adsToMinors, (v) => set({ adsToMinors: v }))}
            {switchField('policy-exchange', F.materialExchange, p.gamification.materialExchange, (v) =>
              set({ gamification: { ...p.gamification, materialExchange: v } }),
            )}
            {switchField('policy-marketplace', F.marketplace, p.gamification.marketplace, (v) =>
              set({ gamification: { ...p.gamification, marketplace: v } }),
            )}
            {switchField('policy-raffle', F.raffle, p.gamification.raffle, (v) =>
              set({ gamification: { ...p.gamification, raffle: v } }),
            )}
            {switchField(
              'policy-notice',
              F.punishmentNoticeRequired,
              p.punishmentNoticeRequired,
              (v) => set({ punishmentNoticeRequired: v }),
              F.punishmentNoticeHint,
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="policy-prize">{F.prizeMaxValue}</FieldLabel>
                <Input
                  id="policy-prize"
                  type="number"
                  inputMode="decimal"
                  value={p.prizeCampaign.maxValue ?? ''}
                  onChange={(e) =>
                    set({
                      prizeCampaign: {
                        ...p.prizeCampaign,
                        maxValue: e.target.value.trim() === '' ? null : Number(e.target.value),
                      },
                    })
                  }
                  disabled={pending}
                />
                <FieldDescription>{F.prizeMaxValueHint}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="policy-regions">{F.excludedRegions}</FieldLabel>
                <Input
                  id="policy-regions"
                  value={regionsText}
                  onChange={(e) => setRegionsText(e.target.value)}
                  disabled={pending}
                />
                <FieldDescription>{F.excludedRegionsHint}</FieldDescription>
              </Field>
            </div>
            {switchField(
              'policy-classification',
              F.legalClassification,
              p.prizeCampaign.legalClassificationRequired,
              (v) => set({ prizeCampaign: { ...p.prizeCampaign, legalClassificationRequired: v } }),
            )}
            <Field>
              <FieldLabel htmlFor="policy-laws">{F.laws}</FieldLabel>
              <Textarea
                id="policy-laws"
                rows={3}
                value={lawsText}
                onChange={(e) => setLawsText(e.target.value)}
                disabled={pending}
              />
              <FieldDescription>{F.lawsHint}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="policy-reason">{F.reason}</FieldLabel>
              <Textarea
                id="policy-reason"
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={pending}
              />
            </Field>
            {issues.length ? (
              <FieldError>
                <ul className="list-disc pl-4">
                  {issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </FieldError>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {F.cancel}
            </Button>
            <Button type="submit" disabled={pending || !country}>
              {pending ? <Spinner /> : null}
              {F.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
