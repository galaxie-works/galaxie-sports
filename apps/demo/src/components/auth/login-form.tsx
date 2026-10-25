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
import { useI18n } from '@/lib/i18n/client';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill, rich } from '@/lib/i18n/text';
import { internalPath } from '@/lib/internal-path';
import { clearTrail } from '@/lib/trail';

/** Mesmos valores do servidor (lib/auth/server.ts), repetidos aqui para não importar código do servidor. */
const OTP_LENGTH = 6;
const OTP_MINUTES = 10;
const RESEND_SECONDS = 60;

type AuthErrors = Dictionary['auth']['errors'];

/** Motivo do redirecionamento para o login (`?motivo=`). */
const REASON: Record<string, keyof AuthErrors> = { expirado: 'expired' };

/** Mensagens dos erros do login por código (códigos do Better Auth e os da própria demo). */
const OTP_ERROR: Record<string, keyof AuthErrors> = {
  INVALID_OTP: 'invalidOtp',
  OTP_EXPIRED: 'otpExpired',
  TOO_MANY_ATTEMPTS: 'tooManyAttempts',
  OTP_RESEND_TOO_SOON: 'resendTooSoon',
  ACCESS_EXPIRED: 'expired',
  BANNED_USER: 'banned',
};

/**
 * Só aceita voltar para um caminho da própria origem (evita redirecionamento aberto): resolvido como o
 * navegador resolveria, porque `/\evil.com` passa numa checagem só de prefixo.
 */
function safeNext(value: string | null) {
  return internalPath(value, window.location.origin) ?? '/';
}

type AuthError = { status?: number; code?: string; message?: string };

function describe(errors: AuthErrors, err: AuthError, fallback: keyof AuthErrors) {
  if (err.code && OTP_ERROR[err.code]) return errors[OTP_ERROR[err.code]!];
  if (err.status === 429) return errors.rateLimited;
  return errors[fallback];
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
  const { t, locale } = useI18n();
  const errors = t.auth.errors;
  const reason = REASON[params.get('motivo') ?? ''];
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(reason ? errors[reason] : null);
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
      setError(describe(errors, err, 'sendFailed'));
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
    if (await requestCode()) setNotice(t.auth.code.resent);
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
      setError(describe(errors, err, 'signInFailed'));
      focusCode();
      return;
    }
    // O idioma da tela de login passa a ser o do perfil (o dos próximos e-mails da pessoa).
    await authClient.updateUser({ locale }).catch(() => {});
    // Trilha nova a cada login: a da aba pode ser de outra pessoa (sessão vencida, troca de usuário).
    clearTrail();
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
            {t.auth.email.label}
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            autoFocus
            required
            placeholder={t.auth.email.placeholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="text-muted-foreground mt-1.5 text-xs">{t.auth.email.help}</p>
        </div>
        <Button type="submit" size="lg" className="mt-1 w-full gap-3 text-[15px]" disabled={loading}>
          {loading ? <Spinner /> : null}
          {loading ? t.auth.email.sending : t.auth.email.submit}
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
            {rich(
              t.auth.code.sent,
              {
                email: (chunk) => <strong className="text-foreground font-medium break-all">{chunk}</strong>,
              },
              { email: email.trim(), length: OTP_LENGTH, minutes: OTP_MINUTES },
            )}
          </p>
        </AlertDescription>
      </Alert>
      <div>
        <label htmlFor="otp" className="mb-1.5 block text-[13px] font-medium">
          {t.auth.code.label}
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
        {loading ? t.auth.code.submitting : t.auth.code.submit}
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
          {t.auth.code.changeEmail}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-muted-foreground gap-2"
          disabled={loading || cooldown > 0}
          onClick={() => void resend()}
        >
          <RotateCw className="size-4" />
          {cooldown > 0 ? fill(t.auth.code.resendIn, { seconds: cooldown }) : t.auth.code.resend}
        </Button>
      </div>
    </form>
  );
}
