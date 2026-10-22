'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { authClient } from '@/lib/auth/client';

const REASON: Record<string, string> = {
  expirado: 'Seu acesso à demo expirou. Fale com quem te convidou para renovar.',
};

/** Só aceita voltar para um caminho interno (evita redirecionamento aberto). */
function safeNext(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(REASON[params.get('motivo') ?? ''] ?? null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: err } = await authClient.signIn.email({ email: email.trim(), password });
    if (err) {
      setLoading(false);
      setError(
        err.status === 401 || err.code === 'INVALID_EMAIL_OR_PASSWORD'
          ? 'E-mail ou senha incorretos.'
          : (err.message ?? 'Não foi possível entrar agora. Tente de novo.'),
      );
      return;
    }
    router.replace(safeNext(params.get('voltar')));
    router.refresh();
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
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="password" className="block text-[13px] font-medium">
            Senha
          </label>
          <Link
            href="/esqueci-senha"
            className="text-muted-foreground hover:text-foreground text-[13px] transition-colors"
          >
            Esqueci a senha
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" size="lg" className="mt-1 w-full gap-3 text-[15px]" disabled={loading}>
        {loading ? <Spinner /> : null}
        {loading ? 'Entrando…' : 'Entrar'}
      </Button>
      {params.get('senha') === 'ok' && !error ? (
        <Alert variant="success" className="mt-1">
          <CheckCircle2 />
          <AlertDescription>Senha salva. Agora é só entrar.</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="mt-1">
          <AlertTriangle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
