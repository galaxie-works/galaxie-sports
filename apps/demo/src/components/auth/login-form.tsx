'use client';

import { AlertTriangle, ArrowLeft, MailCheck, RotateCw } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Spinner } from '@/components/ui/spinner';
import { authClient } from '@/lib/auth/client';

/** Mesmos valores do servidor (lib/auth/server.ts), repetidos aqui para não importar código do servidor. */
const OTP_LENGTH = 6;
const OTP_MINUTES = 10;
const RESEND_SECONDS = 60;

const REASON: Record<string, string> = {
  expirado: 'Seu acesso à demo expirou. Fale com quem te convidou para renovar.',
};

/** Mensagens dos erros do login por código (códigos do Better Auth e os da própria demo). */
const OTP_ERROR: Record<string, string> = {
  INVALID_OTP: 'Código incorreto. Confira o e-mail e tente de novo.',
  OTP_EXPIRED: 'Este código expirou. Peça um novo.',
  TOO_MANY_ATTEMPTS: 'Muitas tentativas com este código. Peça um novo.',
};

/** Só aceita voltar para um caminho interno (evita redirecionamento aberto). */
function safeNext(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

type AuthError = { status?: number; code?: string; message?: string };

function describe(err: AuthError, fallback: string) {
  if (err.status === 429) return 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo.';
  if (err.code && OTP_ERROR[err.code]) return OTP_ERROR[err.code]!;
  return err.message ?? fallback;
}

function ErrorAlert({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="destructive" className="mt-1">
      <AlertTriangle />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/**
 * Login em dois passos, sem senha: (1) a pessoa informa o e-mail e pede o código; (2) digita o código de
 * 6 dígitos. A resposta do passo 1 é sempre a mesma, exista ou não um acesso para o e-mail.
 */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(REASON[params.get('motivo') ?? ''] ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Momento em que "Reenviar código" volta a ficar disponível. */
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const otpRef = useRef<HTMLInputElement>(null);
  /** Devolve o foco ao campo do código (ele fica desabilitado enquanto confere). */
  const focusCode = () => requestAnimationFrame(() => otpRef.current?.focus());

  const cooldown = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= resendAt) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [resendAt]);

  async function requestCode() {
    setLoading(true);
    setError(null);
    const { error: err } = await authClient.emailOtp.sendVerificationOtp({
      email: email.trim().toLowerCase(),
      type: 'sign-in',
    });
    setLoading(false);
    if (err) {
      setError(describe(err, 'Não foi possível enviar o código agora. Tente de novo.'));
      return false;
    }
    setResendAt(Date.now() + RESEND_SECONDS * 1000);
    setNow(Date.now());
    return true;
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (await requestCode()) {
      setCode('');
      setNotice(null);
      setStep('code');
    }
  }

  async function resend() {
    setCode('');
    if (await requestCode()) setNotice('Enviamos um novo código. O anterior deixou de valer.');
    focusCode();
  }

  async function verify(value: string) {
    if (value.length !== OTP_LENGTH || loading) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    const { error: err } = await authClient.signIn.emailOtp({
      email: email.trim().toLowerCase(),
      otp: value,
    });
    if (err) {
      setLoading(false);
      setCode('');
      setError(describe(err, 'Não foi possível entrar agora. Tente de novo.'));
      focusCode();
      return;
    }
    router.replace(safeNext(params.get('voltar')));
    router.refresh();
  }

  function changeEmail() {
    setStep('email');
    setCode('');
    setError(null);
    setNotice(null);
  }

  if (step === 'email') {
    return (
      <form className="flex flex-col gap-3" onSubmit={submitEmail}>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium">
            E-mail
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            autoFocus
            required
            placeholder="voce@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="text-muted-foreground mt-1.5 text-xs">
            Enviaremos um código de acesso para este e-mail. Não é preciso senha.
          </p>
        </div>
        <Button type="submit" size="lg" className="mt-1 w-full gap-3 text-[15px]" disabled={loading}>
          {loading ? <Spinner /> : null}
          {loading ? 'Enviando…' : 'Enviar código'}
        </Button>
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
      </form>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
    >
      <Alert variant="info">
        <MailCheck />
        <AlertDescription>
          <p>
            Se <strong className="text-foreground font-medium break-all">{email.trim()}</strong> tiver acesso
            à demo, enviamos um código de {OTP_LENGTH} dígitos. Ele vale por {OTP_MINUTES} minutos.
          </p>
        </AlertDescription>
      </Alert>
      <div>
        <label htmlFor="otp" className="mb-1.5 block text-[13px] font-medium">
          Código de acesso
        </label>
        <InputOTP
          ref={otpRef}
          id="otp"
          maxLength={OTP_LENGTH}
          pattern="^[0-9]+$"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          disabled={loading}
          value={code}
          onChange={setCode}
          onComplete={(value: string) => void verify(value)}
          containerClassName="justify-center"
        >
          <InputOTPGroup>
            {Array.from({ length: OTP_LENGTH }, (_, i) => (
              <InputOTPSlot key={i} index={i} className="size-12 font-mono text-xl" />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>
      <Button
        type="submit"
        size="lg"
        className="mt-1 w-full gap-3 text-[15px]"
        disabled={loading || code.length !== OTP_LENGTH}
      >
        {loading ? <Spinner /> : null}
        {loading ? 'Entrando…' : 'Entrar'}
      </Button>
      {notice && !error ? (
        <p className="text-muted-foreground text-center text-[13px]" role="status">
          {notice}
        </p>
      ) : null}
      {error ? <ErrorAlert>{error}</ErrorAlert> : null}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" className="text-muted-foreground gap-2" onClick={changeEmail}>
          <ArrowLeft className="size-4" />
          Usar outro e-mail
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-muted-foreground gap-2"
          disabled={loading || cooldown > 0}
          onClick={() => void resend()}
        >
          <RotateCw className="size-4" />
          {cooldown > 0 ? `Reenviar código (${cooldown}s)` : 'Reenviar código'}
        </Button>
      </div>
    </form>
  );
}
