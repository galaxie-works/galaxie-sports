'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  createOrganizationByStaff,
  type IssuedBrandKeys,
} from '@/app/[locale]/(app)/settings/organizations/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { CAPACITY_TIERS, type CapacityTier } from '@/lib/client/organizations-shared';
import { useI18n } from '@/lib/i18n/client';
import { SIGNUP_MARKETS, slugFromName, SLUG_RE, type SignupMarket } from '@/lib/signup/organization';

import { IssuedKeysDialog } from './issued-keys-dialog';

/**
 * "Nova organização" em Ajustes › Organizações e marcas: a jornada assistida (doc 02) pelo mesmo provisionamento do
 * cadastro, com o e-mail do Dono, o motivo da equipe e as chaves mostradas uma vez ao terminar.
 */
export function NewOrganizationDialog() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const C = t.platformStaff.create;
  const A = t.cosmosStaff.actions;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [country, setCountry] = useState<SignupMarket>('BR');
  const [brandName, setBrandName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [tier, setTier] = useState<CapacityTier>('C1');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [issued, setIssued] = useState<IssuedBrandKeys[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const regionNames = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale]);
  const countries = SIGNUP_MARKETS.map((code) => ({ value: code, label: regionNames.of(code) ?? code }));
  const tiers = CAPACITY_TIERS.map((v) => ({ value: v, label: v }));
  const valid =
    ownerEmail.includes('@') &&
    ownerName.trim().length >= 2 &&
    organizationName.trim().length >= 2 &&
    brandName.trim().length >= 2 &&
    SLUG_RE.test(slug) &&
    reason.trim().length >= 5;

  function reset() {
    setOwnerEmail('');
    setOwnerName('');
    setOrganizationName('');
    setBrandName('');
    setSlug('');
    setSlugTouched(false);
    setTier('C1');
    setReason('');
    setError(null);
  }

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const r = await createOrganizationByStaff({
        ownerEmail,
        ownerName,
        organizationName,
        country,
        brandName,
        slug,
        capacityTier: tier,
        reason,
      });
      if (!r.ok) {
        setError(r.error ?? t.platformStaff.errors.generic);
        return;
      }
      const message = r.emailSent ? C.done : `${C.doneNoEmail} ${r.link ?? ''}`.trim();
      toast.success(message);
      setOpen(false);
      reset();
      router.refresh();
      if (r.issued?.length) {
        setNotice(message);
        setIssued(r.issued);
      }
    });

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <DialogTrigger
          render={
            <Button size="sm" className="gap-2">
              <Plus className="size-4" />
              {C.button}
            </Button>
          }
        />
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{C.title}</DialogTitle>
            <DialogDescription>{C.description}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-email`}>{C.ownerEmail}</FieldLabel>
                <Input
                  id={`${id}-email`}
                  type="email"
                  autoComplete="off"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-owner`}>{C.ownerName}</FieldLabel>
                <Input id={`${id}-owner`} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor={`${id}-org`}>{C.organizationName}</FieldLabel>
              <Input
                id={`${id}-org`}
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>{C.country}</FieldLabel>
                <Select
                  items={countries}
                  value={country}
                  onValueChange={(v) => v && setCountry(v as SignupMarket)}
                >
                  <SelectTrigger aria-label={C.country} className="w-full">
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
              </Field>
              <Field>
                <FieldLabel>{C.tier}</FieldLabel>
                <Select items={tiers} value={tier} onValueChange={(v) => v && setTier(v as CapacityTier)}>
                  <SelectTrigger aria-label={C.tier} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {tiers.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-brand`}>{C.brandName}</FieldLabel>
                <Input
                  id={`${id}-brand`}
                  value={brandName}
                  onChange={(e) => {
                    setBrandName(e.target.value);
                    if (!slugTouched) setSlug(slugFromName(e.target.value));
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-slug`}>{C.slug}</FieldLabel>
                <Input
                  id={`${id}-slug`}
                  spellCheck={false}
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                />
                <FieldDescription>{C.slugHint}</FieldDescription>
              </Field>
            </div>
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor={`${id}-reason`}>{A.reason}</FieldLabel>
              <Textarea
                id={`${id}-reason`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={500}
              />
              <FieldDescription>{A.reasonHint}</FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              {A.cancel}
            </Button>
            <Button disabled={pending || !valid} onClick={submit} className="gap-2">
              {pending ? <Spinner /> : null}
              {C.submit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <IssuedKeysDialog issued={issued} notice={notice} onClose={() => setIssued(null)} />
    </>
  );
}
