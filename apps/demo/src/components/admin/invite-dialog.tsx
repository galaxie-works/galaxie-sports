'use client';

import { Copy, MailCheck, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { inviteUser, type InviteInput } from '@/app/(app)/ajustes/actions';
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

export const ACCESS_PRESETS = [
  { value: '7', label: '7 dias' },
  { value: '14', label: '14 dias' },
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
  { value: 'none', label: 'Sem prazo' },
];

const ROLES = [
  { value: 'user', label: 'Convidado' },
  { value: 'admin', label: 'Admin' },
];

const EMPTY = { name: '', email: '', jobTitle: '', company: '', phone: '', notes: '' };

/** Cadastro do convidado: dados de contato, papel e validade; o convite sai por e-mail. */
export function InviteDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [days, setDays] = useState('14');
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function reset() {
    setForm(EMPTY);
    setRole('user');
    setDays('14');
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
    };
    startTransition(async () => {
      const res = await inviteUser(input);
      if (!res.ok) {
        setError(res.error ?? 'Não foi possível convidar.');
        return;
      }
      router.refresh();
      if (res.emailSent) {
        toast.success(`Convite enviado para ${form.email.trim()}`);
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
        Convidar pessoa
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Convidar pessoa</DialogTitle>
          <DialogDescription>
            A pessoa recebe um e-mail com o convite e entra com um código de acesso enviado ao e-mail, sem
            senha.
          </DialogDescription>
        </DialogHeader>

        {link !== null ? (
          <div className="flex flex-col gap-3">
            <Alert variant="warning">
              <MailCheck />
              <AlertDescription>
                Conta criada, mas o e-mail não foi enviado (SMTP não configurado ou falhou). Copie o link da
                demo e mande por outro canal: a pessoa entra com o código enviado ao e-mail dela.
              </AlertDescription>
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
                    toast.success('Link copiado');
                  }}
                >
                  <Copy />
                  Copiar
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
                Concluir
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="inv-name">Nome</FieldLabel>
                <Input id="inv-name" required autoFocus value={form.name} onChange={set('name')} />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="inv-email">E-mail</FieldLabel>
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
                <FieldLabel htmlFor="inv-job">Cargo</FieldLabel>
                <Input id="inv-job" value={form.jobTitle} onChange={set('jobTitle')} />
              </Field>
              <Field>
                <FieldLabel htmlFor="inv-company">Empresa</FieldLabel>
                <Input id="inv-company" value={form.company} onChange={set('company')} />
              </Field>
              <Field>
                <FieldLabel htmlFor="inv-phone">Telefone</FieldLabel>
                <Input id="inv-phone" type="tel" value={form.phone} onChange={set('phone')} />
              </Field>
              <Field>
                <FieldLabel>Papel</FieldLabel>
                <Select items={ROLES} value={role} onValueChange={(v) => setRole(v as 'user' | 'admin')}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel>Validade do acesso</FieldLabel>
                <Select
                  items={ACCESS_PRESETS}
                  value={role === 'admin' ? 'none' : days}
                  onValueChange={(v) => setDays(String(v))}
                  disabled={role === 'admin'}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCESS_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {role === 'admin'
                    ? 'Admins não têm prazo.'
                    : 'Depois disso o login é bloqueado; dá para estender no detalhe do usuário.'}
                </FieldDescription>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="inv-notes">Observações</FieldLabel>
                <Textarea
                  id="inv-notes"
                  rows={2}
                  placeholder="Ex.: reunião de apresentação em 05/11"
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
                Enviar convite
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
