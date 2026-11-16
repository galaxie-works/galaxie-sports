'use client';

import type { CapacityDef } from '@galaxie/billing';
import { AlertTriangle, ArrowLeft, Check, Copy, KeyRound } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  createOrganizationAction,
  type CreatedOrganization,
} from '@/app/[locale]/signup/organization/actions';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { CapacityTier } from '@/lib/client/organizations-shared';
import { PUBLIC_API_URL } from '@/lib/galaxie/request';
import { useI18n } from '@/lib/i18n/client';
import { fill, rich } from '@/lib/i18n/text';
import { normalizeUsage, recommendCapacityTier } from '@/lib/signup/capacity';
import {
  billingFor,
  NAME_MAX,
  SIGNUP_MARKETS,
  slugFromName,
  SLUG_RE,
  type SignupMarket,
} from '@/lib/signup/organization';
import type { StartingPrice, StartingPrices } from '@/lib/signup/prices';
import { CONTACT_EMAIL } from '@/lib/site';
import { cn } from '@/lib/utils';

export interface WizardSportFamily {
  id: string;
  sports: string[];
  label: string;
}

interface Props {
  termsVersion: string;
  tiers: Record<CapacityTier, CapacityDef>;
  /** Preços "a partir de" por mercado (ISO2); só o que está cadastrado. */
  prices: Record<string, StartingPrices>;
  sports: WizardSportFamily[];
}

const STEPS = ['organization', 'brand', 'capacity', 'done'] as const;
/** Cor do tema escuro padrão dos widgets, como exemplo do campo. */
const DEFAULT_COLOR = '#7c6cff';
type Step = (typeof STEPS)[number];

function Price({ price, label, locale }: { price: StartingPrice; label: string; locale: string }) {
  const { t } = useI18n();
  const amount = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: price.currency.toUpperCase(),
    maximumFractionDigits: price.amountMinor % 100 === 0 ? 0 : 2,
  }).format(price.amountMinor / 100);
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{fill(t.signup.wizard.capacity.perMonth, { amount })}</span>
    </li>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <code className="bg-muted min-w-0 flex-1 overflow-x-auto rounded-md px-2 py-1.5 font-mono text-xs break-all">
          {value}
        </code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? t.signup.wizard.done.copied : t.signup.wizard.done.copy}
        </Button>
      </div>
    </div>
  );
}

/**
 * Assistente de criação da organização: organização (nome, país, termos), marca (nome, identificador, esportes,
 * domínio, cor), audiência (a calculadora de capacidade com o preço "a partir de") e a tela final com as chaves
 * mostradas uma vez e o checklist da primeira sessão. Toda validação de verdade é da ação do servidor; aqui só o
 * bastante para a pessoa não esbarrar.
 */
export function OrganizationWizard({ termsVersion, tiers, prices, sports }: Props) {
  const { t, locale } = useI18n();
  const W = t.signup.wizard;
  const [step, setStep] = useState<Step>('organization');
  const [organizationName, setOrganizationName] = useState('');
  const [country, setCountry] = useState<SignupMarket>('BR');
  const [terms, setTerms] = useState(false);
  const [brandName, setBrandName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [families, setFamilies] = useState<string[]>([]);
  const [domain, setDomain] = useState('');
  const [color, setColor] = useState('');
  const [views, setViews] = useState('');
  const [peak, setPeak] = useState('');
  const [chat, setChat] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOrganization | null>(null);

  const regionNames = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale]);
  const countries = SIGNUP_MARKETS.map((code) => ({ value: code, label: regionNames.of(code) ?? code }));
  const billing = billingFor(country);
  const usage = {
    viewsPerMonth: normalizeUsage(views),
    peakConcurrent: normalizeUsage(peak),
    chatWriters: normalizeUsage(chat),
  };
  const recommended = recommendCapacityTier(tiers, usage);
  const marketPrices = prices[country];
  const tierPrice = marketPrices?.capacity[recommended.tier];
  const stepIndex = STEPS.indexOf(step);

  const organizationOk = organizationName.trim().length >= 2 && terms;
  const brandOk = brandName.trim().length >= 2 && SLUG_RE.test(slug);

  function onBrandName(value: string) {
    setBrandName(value);
    if (!slugTouched) setSlug(slugFromName(value));
  }

  async function submit() {
    setPending(true);
    setError(null);
    const r = await createOrganizationAction({
      organizationName,
      country,
      termsAccepted: terms,
      brandName,
      slug,
      sports: sports.filter((f) => families.includes(f.id)).flatMap((f) => f.sports),
      domain,
      color,
      usage: { viewsPerMonth: views, peakConcurrent: peak, chatWriters: chat },
    });
    setPending(false);
    if (!r.ok || !r.created) {
      setError(r.error ?? t.signup.errors.generic);
      return;
    }
    setCreated(r.created);
    setStep('done');
  }

  const header = (
    <div className="mb-4 flex items-center justify-between gap-3">
      <Badge variant="secondary">{fill(W.stepOf, { n: stepIndex + 1, total: STEPS.length })}</Badge>
      <ol className="text-muted-foreground flex gap-3 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className={i === stepIndex ? 'text-foreground font-medium' : undefined}>
            {W.steps[s]}
          </li>
        ))}
      </ol>
    </div>
  );

  if (step === 'done' && created) {
    const D = W.done;
    const pendingReview = created.reviewStatus === 'pending';
    const proposal = !created.selfService;
    const testKey = created.keys.test ?? 'gs_test_…';
    const curl = `curl -H "Authorization: Bearer ${testKey}" ${PUBLIC_API_URL}/v1/account`;
    const dateFmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long', year: 'numeric' });
    return (
      <div className="flex flex-col gap-5 text-left">
        {header}
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">
            {proposal ? D.proposalTitle : pendingReview ? D.pendingTitle : D.title}
          </h2>
          {proposal ? (
            <p className="text-muted-foreground text-sm">
              {fill(D.proposalBody, { tier: created.declaredTier, email: CONTACT_EMAIL })}
            </p>
          ) : pendingReview ? (
            <p className="text-muted-foreground text-sm">{D.pendingBody}</p>
          ) : null}
        </div>
        <dl className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">{D.organization}</dt>
            <dd className="font-medium">{created.organizationName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{D.brand}</dt>
            <dd className="font-medium">
              {created.brandName} <span className="text-muted-foreground font-normal">({created.slug})</span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{D.tier}</dt>
            <dd className="font-medium">
              {created.selfService
                ? fill(D.tierTrial, { tier: created.tier, declared: created.declaredTier })
                : created.tier}
            </dd>
          </div>
          {created.trialEndsAt ? (
            <div>
              <dt className="text-muted-foreground text-xs">{W.steps.done}</dt>
              <dd className="font-medium">
                {fill(D.trial, { date: dateFmt.format(new Date(created.trialEndsAt)) })}
              </dd>
            </div>
          ) : null}
        </dl>
        {created.keys.live || created.keys.test || created.keys.publishable ? (
          <section className="flex flex-col gap-3 rounded-lg border p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="size-4" />
              {D.keysTitle}
            </h3>
            <Alert variant="warning">
              <AlertTriangle />
              <AlertDescription>{D.keysWarning}</AlertDescription>
            </Alert>
            {created.keys.live ? <CopyField label={D.keyLive} value={created.keys.live} /> : null}
            {created.keys.test ? <CopyField label={D.keyTest} value={created.keys.test} /> : null}
            {created.keys.publishable ? (
              <CopyField label={D.keyPublishable} value={created.keys.publishable} />
            ) : null}
          </section>
        ) : null}
        {created.domain ? (
          <section className="flex flex-col gap-3 rounded-lg border p-4">
            <h3 className="text-sm font-semibold">{fill(D.domainTitle, { host: created.domain.host })}</h3>
            <p className="text-muted-foreground text-sm">
              {created.domain.existed
                ? D.domainExists
                : rich(
                    D.domainBody,
                    { record: (chunk) => <code className="font-mono text-xs">{chunk}</code> },
                    { record: created.domain.record },
                  )}
            </p>
            <CopyField label={D.txtValue} value={created.domain.token} />
          </section>
        ) : null}
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">{D.checklistTitle}</h3>
          <p className="text-muted-foreground text-sm">{D.checklistIntro}</p>
          <ol className="flex flex-col gap-3 text-sm">
            <li className="flex flex-col gap-1">
              <span className="font-medium">1. {D.stepCurl}</span>
              <span className="text-muted-foreground text-xs">{D.stepCurlHint}</span>
              <code className="bg-muted overflow-x-auto rounded-md px-2 py-1.5 font-mono text-xs break-all">
                {curl}
              </code>
            </li>
            <li className="flex flex-col gap-1">
              <span className="font-medium">
                2. {D.stepWidget}{' '}
                <a href="/client/builder" className="text-foreground underline underline-offset-4">
                  {D.openBuilder}
                </a>
              </span>
              <span className="text-muted-foreground text-xs">{D.stepWidgetHint}</span>
            </li>
            <li className="flex flex-col gap-1">
              <span className="font-medium">
                3. {D.stepInvite}{' '}
                <a href="/client/users" className="text-foreground underline underline-offset-4">
                  {D.openMembers}
                </a>
              </span>
              <span className="text-muted-foreground text-xs">{D.stepInviteHint}</span>
            </li>
            <li className="flex flex-col gap-1">
              <span className="font-medium">
                4. {D.stepPlan}{' '}
                <a href="/client/plans" className="text-foreground underline underline-offset-4">
                  {D.openPlans}
                </a>
              </span>
              <span className="text-muted-foreground text-xs">{D.stepPlanHint}</span>
            </li>
          </ol>
        </section>
        <a href="/client" className={cn(buttonVariants({ size: 'lg' }), 'w-full text-[15px]')}>
          {D.open}
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 text-left">
      {header}
      {step === 'organization' ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (organizationOk) setStep('brand');
          }}
        >
          <div>
            <h2 className="text-lg font-semibold">{W.organization.title}</h2>
            <p className="text-muted-foreground text-sm">{W.organization.description}</p>
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="org-name">{W.organization.name}</FieldLabel>
              <Input
                id="org-name"
                autoFocus
                required
                maxLength={NAME_MAX}
                placeholder={W.organization.namePlaceholder}
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>{W.organization.country}</FieldLabel>
              <Select
                items={countries}
                value={country}
                onValueChange={(v) => v && setCountry(v as SignupMarket)}
              >
                <SelectTrigger aria-label={W.organization.country} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {countries.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {W.organization.countryHint}{' '}
                {fill(W.organization.billing, {
                  currency: billing.currency.toUpperCase(),
                  entity: billing.billingEntity === 'ltda' ? 'Ltda' : 'LLC',
                })}
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Checkbox id="org-terms" checked={terms} onCheckedChange={(v) => setTerms(v === true)} />
              <FieldLabel htmlFor="org-terms" className="font-normal">
                {rich(
                  W.organization.terms,
                  {
                    terms: (chunk) => (
                      <a
                        href="/terms"
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-4"
                      >
                        {chunk}
                      </a>
                    ),
                  },
                  { version: termsVersion },
                )}
              </FieldLabel>
            </Field>
          </FieldGroup>
          <Button type="submit" size="lg" className="w-full text-[15px]" disabled={!organizationOk}>
            {W.next}
          </Button>
        </form>
      ) : null}

      {step === 'brand' ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (brandOk) setStep('capacity');
          }}
        >
          <div>
            <h2 className="text-lg font-semibold">{W.brand.title}</h2>
            <p className="text-muted-foreground text-sm">{W.brand.description}</p>
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="brand-name">{W.brand.name}</FieldLabel>
              <Input
                id="brand-name"
                autoFocus
                required
                maxLength={NAME_MAX}
                placeholder={W.brand.namePlaceholder}
                value={brandName}
                onChange={(e) => onBrandName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="brand-slug">{W.brand.slug}</FieldLabel>
              <Input
                id="brand-slug"
                required
                spellCheck={false}
                pattern="[a-z0-9][a-z0-9-]{1,62}"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase());
                }}
              />
              <FieldDescription>{W.brand.slugHint}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>
                {W.brand.sports} <span className="text-muted-foreground font-normal">({W.optional})</span>
              </FieldLabel>
              <div className="flex flex-wrap gap-2">
                {sports.map((f) => {
                  const on = families.includes(f.id);
                  return (
                    <Button
                      key={f.id}
                      type="button"
                      size="sm"
                      variant={on ? 'default' : 'outline'}
                      aria-pressed={on}
                      onClick={() =>
                        setFamilies(on ? families.filter((id) => id !== f.id) : [...families, f.id])
                      }
                    >
                      {f.label}
                    </Button>
                  );
                })}
              </div>
              <FieldDescription>{W.brand.sportsHint}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="brand-domain">
                {W.brand.domain} <span className="text-muted-foreground font-normal">({W.optional})</span>
              </FieldLabel>
              <Input
                id="brand-domain"
                spellCheck={false}
                placeholder={W.brand.domainPlaceholder}
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
              <FieldDescription>{W.brand.domainHint}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="brand-color">
                {W.brand.color} <span className="text-muted-foreground font-normal">({W.optional})</span>
              </FieldLabel>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={W.brand.color}
                  className="size-8 cursor-pointer rounded border bg-transparent"
                  value={color || DEFAULT_COLOR}
                  onChange={(e) => setColor(e.target.value)}
                />
                <Input
                  id="brand-color"
                  spellCheck={false}
                  placeholder={DEFAULT_COLOR}
                  className="max-w-40 font-mono"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </div>
              <FieldDescription>{W.brand.colorHint}</FieldDescription>
            </Field>
          </FieldGroup>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" className="gap-2" onClick={() => setStep('organization')}>
              <ArrowLeft className="size-4" />
              {W.back}
            </Button>
            <Button type="submit" size="lg" className="flex-1 text-[15px]" disabled={!brandOk}>
              {W.next}
            </Button>
          </div>
        </form>
      ) : null}

      {step === 'capacity' ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div>
            <h2 className="text-lg font-semibold">{W.capacity.title}</h2>
            <p className="text-muted-foreground text-sm">{W.capacity.description}</p>
          </div>
          <FieldGroup>
            {(
              [
                ['views', W.capacity.views, W.capacity.viewsHint, views, setViews],
                ['peak', W.capacity.peak, W.capacity.peakHint, peak, setPeak],
                ['chat', W.capacity.chat, W.capacity.chatHint, chat, setChat],
              ] as const
            ).map(([id, label, hint, value, set]) => (
              <Field key={id}>
                <FieldLabel htmlFor={`usage-${id}`}>{label}</FieldLabel>
                <Input
                  id={`usage-${id}`}
                  inputMode="numeric"
                  autoFocus={id === 'views'}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                />
                <FieldDescription>{hint}</FieldDescription>
              </Field>
            ))}
          </FieldGroup>
          <div className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{W.capacity.result}</span>
              <Badge
                variant={recommended.selfService ? 'success-light' : 'warning-light'}
                className="text-base"
              >
                {recommended.tier}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {recommended.selfService
                ? W.capacity.selfService
                : fill(W.capacity.proposal, { tier: recommended.tier, email: CONTACT_EMAIL })}
            </p>
            {marketPrices && (marketPrices.plan || tierPrice) ? (
              <div className="flex flex-col gap-1 border-t pt-3">
                <span className="text-muted-foreground text-xs font-medium">{W.capacity.priceTitle}</span>
                <ul className="flex flex-col gap-1">
                  {marketPrices.plan ? (
                    <Price price={marketPrices.plan} label={W.capacity.planPrice} locale={locale} />
                  ) : null}
                  {tierPrice ? (
                    <Price
                      price={tierPrice}
                      label={fill(W.capacity.tierPrice, { tier: recommended.tier })}
                      locale={locale}
                    />
                  ) : null}
                </ul>
                <span className="text-muted-foreground text-xs">{W.capacity.priceNote}</span>
              </div>
            ) : null}
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className="gap-2"
              disabled={pending}
              onClick={() => setStep('brand')}
            >
              <ArrowLeft className="size-4" />
              {W.back}
            </Button>
            <Button type="submit" size="lg" className="flex-1 gap-3 text-[15px]" disabled={pending}>
              {pending ? <Spinner /> : null}
              {recommended.selfService
                ? pending
                  ? W.capacity.creating
                  : W.capacity.create
                : pending
                  ? W.capacity.requesting
                  : W.capacity.request}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
