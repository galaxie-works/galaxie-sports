'use client';

/**
 * Perfil de torcedor da demo (#1020): apelido, faixa etária e país, sem data de nascimento. Com ele, a demo
 * emite o token `gft_` da pessoa para os recursos do torcedor (`/api/torcedor/token`).
 */
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
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
import { authClient } from '@/lib/auth/client';
import { saveFanProfile } from '@/lib/fan/actions';
import {
  FAN_AGE_BANDS,
  FAN_COUNTRIES,
  NICKNAME_MAX,
  type FanProfile,
  type FanProfileField,
} from '@/lib/fan/profile';
import { useI18n } from '@/lib/i18n/client';

export function FanProfileDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: Partial<FanProfile>;
}) {
  const { t, locale } = useI18n();
  const T = t.shell.fanProfile;
  const [nickname, setNickname] = useState(initial.nickname ?? '');
  const [ageBand, setAgeBand] = useState<string>(initial.ageBand ?? '');
  const [country, setCountry] = useState<string>(initial.country ?? '');
  const [error, setError] = useState<{ field?: FanProfileField; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const names = new Intl.DisplayNames([locale], { type: 'region' });
  const bands = FAN_AGE_BANDS.map((b) => ({ value: b, label: T.bands[b] }));
  const countries = FAN_COUNTRIES.map((c) => ({ value: c, label: names.of(c) ?? c })).sort((a, b) =>
    a.label.localeCompare(b.label, locale),
  );

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveFanProfile({ nickname, ageBand, country });
      if (!res.ok) {
        setError({
          field: res.field,
          text: res.field ? T.invalid[res.field] : res.error === 'session' ? T.session : T.unavailable,
        });
        return;
      }
      // a sessão do navegador passa a trazer o perfil novo (o token sai dele)
      await authClient.getSession({ query: { disableCookieCache: true } }).catch(() => {});
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{T.title}</DialogTitle>
          <DialogDescription>{T.description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <FieldGroup>
            <Field data-invalid={error?.field === 'nickname' || undefined}>
              <FieldLabel htmlFor="fan-nickname">{T.nickname}</FieldLabel>
              <Input
                id="fan-nickname"
                value={nickname}
                maxLength={NICKNAME_MAX}
                autoComplete="nickname"
                onChange={(e) => setNickname(e.target.value)}
                disabled={pending}
                aria-invalid={error?.field === 'nickname' || undefined}
              />
              <FieldDescription>{T.nicknameHint}</FieldDescription>
            </Field>
            <Field data-invalid={error?.field === 'ageBand' || undefined}>
              <FieldLabel htmlFor="fan-age-band">{T.ageBand}</FieldLabel>
              <Select
                items={bands}
                value={ageBand || null}
                onValueChange={(v) => setAgeBand(String(v ?? ''))}
              >
                <SelectTrigger id="fan-age-band" className="w-full" disabled={pending}>
                  <SelectValue placeholder={T.choose} />
                </SelectTrigger>
                <SelectContent>
                  {bands.map((b) => (
                    <SelectItem key={b.value} value={b.value}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{T.ageBandHint}</FieldDescription>
            </Field>
            <Field data-invalid={error?.field === 'country' || undefined}>
              <FieldLabel htmlFor="fan-country">{T.country}</FieldLabel>
              <Select
                items={countries}
                value={country || null}
                onValueChange={(v) => setCountry(String(v ?? ''))}
              >
                <SelectTrigger id="fan-country" className="w-full" disabled={pending}>
                  <SelectValue placeholder={T.choose} />
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
            {error ? <FieldError>{error.text}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              {T.cancel}
            </Button>
            <Button type="submit" disabled={pending || !nickname.trim() || !ageBand || !country}>
              {pending ? <Spinner /> : null}
              {T.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
