'use client';

import { AlertTriangle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { authClient } from '@/lib/auth/client';

const MIN_LENGTH = 10;

function ErrorAlert({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="destructive" className="mt-1">
      <AlertTriangle />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

function BackToLogin() {
  return (
    <Button
      variant="ghost"
      className="text-muted-foreground gap-2 self-start"
      render={<Link href="/login" />}
    >
      <ArrowLeft className="size-4" />
      Voltar para o login
    </Button>
  );
}

/** Convite e redefinição: o link do e-mail traz o token (?token=); aqui a pessoa escolhe a senha. */
export function SetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const linkError = params.get('error');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token || linkError) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorAlert>
          Este link é inválido ou já expirou. Peça um novo convite a quem te convidou, ou use “Esqueci a
          senha”.
        </ErrorAlert>
        <BackToLogin />
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH)
      return setError(`A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`);
    if (password !== confirm) return setError('As senhas não conferem.');
    setLoading(true);
    const { error: err } = await authClient.resetPassword({ newPassword: password, token: token! });
    setLoading(false);
    if (err) {
      setError(
        err.code === 'INVALID_TOKEN'
          ? 'Este link é inválido ou já expirou. Peça um novo convite.'
          : (err.message ?? 'Não foi possível salvar a senha.'),
      );
      return;
    }
    router.replace('/login?senha=ok');
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium">
          Nova senha
        </label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          minLength={MIN_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-muted-foreground mt-1.5 text-xs">Pelo menos {MIN_LENGTH} caracteres.</p>
      </div>
      <div>
        <label htmlFor="confirm" className="mb-1.5 block text-[13px] font-medium">
          Repita a senha
        </label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <Button type="submit" size="lg" className="mt-1 w-full gap-3 text-[15px]" disabled={loading}>
        {loading ? <Spinner /> : null}
        Salvar senha e continuar
      </Button>
      {error ? <ErrorAlert>{error}</ErrorAlert> : null}
    </form>
  );
}

/** Pede o link de redefinição. A resposta é a mesma exista ou não a conta (não revela e-mails). */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await authClient.requestPasswordReset({ email: email.trim(), redirectTo: '/definir-senha' });
    setLoading(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="success">
          <CheckCircle2 />
          <AlertDescription>
            Se houver um acesso para este e-mail, enviamos um link para redefinir a senha.
          </AlertDescription>
        </Alert>
        <BackToLogin />
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <div>
        <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium">
          E-mail
        </label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          spellCheck={false}
          autoFocus
          required
          placeholder="voce@empresa.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <Button type="submit" size="lg" className="mt-1 w-full gap-3 text-[15px]" disabled={loading}>
        {loading ? <Spinner /> : null}
        Enviar link
      </Button>
      <BackToLogin />
    </form>
  );
}
