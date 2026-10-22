'use client';

import { Copy, MailCheck, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { inviteUser, type InviteInput } from '@/app/[locale]/(app)/ajustes/actions';
import { Alert, AlertDescription } from '@/components/reui/alert';
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/config';
import { fill, plural } from '@/lib/i18n/text';

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
export function useRoles() {
  const { t } = useI18n();
  return [
    { value: 'user', label: t.admin.roles.user },
    { value: 'admin', label: t.admin.roles.admin },
  ];
}

const EMPTY = { name: '', email: '', jobTitle: '', company: '', phone: '', notes: '' };

/** Cadastro do convidado: dados de contato, papel e validade; o convite sai por e-mail. */
export function InviteDialog() {
  const router = useRouter();
  const { locale: screenLocale, t } = useI18n();
  const accessPresets = useAccessPresets();
  const roles = useRoles();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [days, setDays] = useState('14');
  // Idioma do convite: por padrão, o da tela de quem convida.
  const [locale, setLocale] = useState<Locale>(screenLocale);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function reset() {
    setForm(EMPTY);
    setRole('user');
    setDays('14');
    setLocale(screenLocale);
    setError(null);
    setLink(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input: InviteInput = {
      ...form,
      role,
      accessDays: days === 'none' ? null : Number(days),
      locale,
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
                <Select items={roles} value={role} onValueChange={(v) => setRole(v as 'user' | 'admin')}>
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
              <Button type="submit" disabled={pending}>
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
