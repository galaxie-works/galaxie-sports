'use client';

import { Copy, MailCheck, TriangleAlert, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { inviteUser, type InviteInput } from '@/app/[locale]/(app)/ajustes/actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import type { Role } from '@/lib/auth/roles';
import type { TenantOption } from '@/lib/client/tenants';
import { useI18n } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/config';
import { fill, plural } from '@/lib/i18n/text';
import { emailMatchesDomains } from '@/lib/lineup/types';

import { LocaleSelect } from './user-badges';

const ACCESS_DAYS = ['7', '14', '30', '90', 'none'] as const;

/** Prazos de acesso prontos ("7 dias" … "Sem prazo"), no idioma da tela. */
export function useAccessPresets() {
  const { locale, t } = useI18n();
  return ACCESS_DAYS.map((value) => ({
    value,
    label: value === 'none' ? t.admin.access.noLimit : plural(locale, Number(value), t.admin.access.days),
  }));
}

/** Papéis no idioma da tela. */
export function useRoles(): { value: Role; label: string }[] {
  const { t } = useI18n();
  return [
    { value: 'user', label: t.admin.roles.user },
    { value: 'client', label: t.admin.roles.client },
    { value: 'admin', label: t.admin.roles.admin },
  ];
}

/**
 * Tenant da API do usuário cliente (obrigatório no papel `client`). Sem tenants no banco, explica onde
 * criar um.
 */
export function TenantSelect({
  id,
  tenants,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  tenants: TenantOption[];
  value: string | null;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const items = tenants.map((x) => ({
    value: x.id,
    label: x.status === 'suspended' ? `${x.name} · ${t.admin.tenant.suspended}` : x.name,
  }));
  return (
    <Select items={items} value={value} onValueChange={(v) => v && onChange(String(v))} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue>
          {(v: string | null) =>
            v ? (
              (items.find((i) => i.value === v)?.label ?? t.admin.tenant.missing)
            ) : (
              <span className="text-muted-foreground">
                {tenants.length ? t.admin.tenant.placeholder : t.admin.tenant.none}
              </span>
            )
          }
        </SelectValue>
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

const EMPTY = { name: '', email: '', jobTitle: '', company: '', phone: '', notes: '' };

/**
 * Cadastro do convidado: dados de contato, papel e validade; o convite sai por e-mail. Cliente com e-mail
 * fora dos domínios da operadora do tenant: aviso e confirmação (pode ser agência ou consultor).
 */
export function InviteDialog({
  tenants,
  operatorDomains = {},
}: {
  tenants: TenantOption[];
  operatorDomains?: Record<string, string[]>;
}) {
  const router = useRouter();
  const { locale: screenLocale, t } = useI18n();
  const accessPresets = useAccessPresets();
  const roles = useRoles();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [role, setRole] = useState<Role>('user');
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [days, setDays] = useState('14');
  // Idioma do convite: por padrão, o da tela de quem convida.
  const [locale, setLocale] = useState<Locale>(screenLocale);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [confirmOutside, setConfirmOutside] = useState(false);
  const [pending, startTransition] = useTransition();
  const domains = role === 'client' && tenantId ? (operatorDomains[tenantId] ?? []) : [];
  const outside = domains.length > 0 && form.email.includes('@') && !emailMatchesDomains(form.email, domains);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function reset() {
    setForm(EMPTY);
    setRole('user');
    setTenantId(null);
    setDays('14');
    setLocale(screenLocale);
    setError(null);
    setLink(null);
    setConfirmOutside(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input: InviteInput = {
      ...form,
      role,
      tenantId: role === 'client' ? tenantId : null,
      accessDays: days === 'none' ? null : Number(days),
      locale,
      confirmOutsideDomain: outside && confirmOutside,
    };
    startTransition(async () => {
      const res = await inviteUser(input);
      if (!res.ok) {
        setError(res.error ?? t.admin.invite.failed);
        return;
      }
      router.refresh();
      if (res.emailSent) {
        toast.success(fill(t.admin.invite.sentTo, { email: form.email.trim() }));
        setOpen(false);
        reset();
      } else {
        // Sem SMTP (ou falha no envio): o admin copia o link e manda por outro canal.
        setLink(res.link ?? null);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger render={<Button />}>
        <UserPlus />
        {t.admin.invite.trigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.admin.invite.title}</DialogTitle>
          <DialogDescription>{t.admin.invite.description}</DialogDescription>
        </DialogHeader>

        {link !== null ? (
          <div className="flex flex-col gap-3">
            <Alert variant="warning">
              <MailCheck />
              <AlertDescription>{t.admin.invite.notSent}</AlertDescription>
            </Alert>
            {link ? (
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={link}
                  className="font-mono text-xs"
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(link);
                    toast.success(t.admin.invite.linkCopied);
                  }}
                >
                  <Copy />
                  {t.common.copy}
                </Button>
              </div>
            ) : null}
            <DialogFooter>
              <Button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                {t.admin.invite.done}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="inv-name">{t.admin.fields.name}</FieldLabel>
                <Input id="inv-name" required autoFocus value={form.name} onChange={set('name')} />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="inv-email">{t.admin.fields.email}</FieldLabel>
                <Input
                  id="inv-email"
                  type="email"
                  required
                  spellCheck={false}
                  value={form.email}
                  onChange={set('email')}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="inv-job">{t.admin.fields.jobTitle}</FieldLabel>
                <Input id="inv-job" value={form.jobTitle} onChange={set('jobTitle')} />
              </Field>
              <Field>
                <FieldLabel htmlFor="inv-company">{t.admin.fields.company}</FieldLabel>
                <Input id="inv-company" value={form.company} onChange={set('company')} />
              </Field>
              <Field>
                <FieldLabel htmlFor="inv-phone">{t.admin.fields.phone}</FieldLabel>
                <Input id="inv-phone" type="tel" value={form.phone} onChange={set('phone')} />
              </Field>
              <Field>
                <FieldLabel htmlFor="inv-role">{t.admin.fields.role}</FieldLabel>
                <Select items={roles} value={role} onValueChange={(v) => setRole(v as Role)}>
                  <SelectTrigger id="inv-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {role === 'client' ? (
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="inv-tenant">{t.admin.tenant.label}</FieldLabel>
                  <TenantSelect id="inv-tenant" tenants={tenants} value={tenantId} onChange={setTenantId} />
                  <FieldDescription>{t.admin.tenant.hint}</FieldDescription>
                </Field>
              ) : null}
              {outside ? (
                <Alert variant="warning" className="sm:col-span-2">
                  <TriangleAlert />
                  <AlertTitle>{t.lineup.invite.outsideTitle}</AlertTitle>
                  <AlertDescription className="flex flex-col gap-2">
                    {fill(t.lineup.invite.outside, {
                      email: form.email.trim(),
                      domains: domains.join(', '),
                    })}
                    <Field orientation="horizontal">
                      <Checkbox
                        id="inv-outside"
                        checked={confirmOutside}
                        onCheckedChange={(v) => setConfirmOutside(v === true)}
                      />
                      <FieldLabel htmlFor="inv-outside" className="font-normal">
                        {t.lineup.invite.confirm}
                      </FieldLabel>
                    </Field>
                  </AlertDescription>
                </Alert>
              ) : null}
              <Field>
                <FieldLabel htmlFor="inv-access">{t.admin.invite.access}</FieldLabel>
                <Select
                  items={accessPresets}
                  value={role === 'admin' ? 'none' : days}
                  onValueChange={(v) => setDays(String(v))}
                  disabled={role === 'admin'}
                >
                  <SelectTrigger id="inv-access" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accessPresets.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {role === 'admin' ? t.admin.invite.accessHintAdmin : t.admin.invite.accessHint}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="inv-locale">{t.admin.invite.language}</FieldLabel>
                <LocaleSelect id="inv-locale" value={locale} onChange={setLocale} />
                <FieldDescription>{t.admin.invite.languageHint}</FieldDescription>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="inv-notes">{t.admin.fields.notes}</FieldLabel>
                <Textarea
                  id="inv-notes"
                  rows={2}
                  placeholder={t.admin.invite.notesPlaceholder}
                  value={form.notes}
                  onChange={set('notes')}
                />
              </Field>
            </FieldGroup>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button
                type="submit"
                disabled={pending || (role === 'client' && !tenantId) || (outside && !confirmOutside)}
              >
                {pending ? <Spinner /> : <UserPlus />}
                {t.admin.invite.submit}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
