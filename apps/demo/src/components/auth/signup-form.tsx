'use client';

import { AlertTriangle, ArrowLeft, MailCheck, RotateCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { startSignup } from '@/app/[locale]/signup/actions';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Spinner } from '@/components/ui/spinner';
import { authClient } from '@/lib/auth/client';
import { useI18n } from '@/lib/i18n/client';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill, rich } from '@/lib/i18n/text';
import { clearTrail } from '@/lib/trail';

/** Mesmos valores do servidor (lib/auth/server.ts), repetidos aqui para não importar código do servidor. */
const OTP_LENGTH = 6;
const OTP_MINUTES = 10;
const RESEND_SECONDS = 60;

type AuthErrors = Dictionary['auth']['errors'];
const OTP_ERROR: Record<string, keyof AuthErrors> = {
  INVALID_OTP: 'invalidOtp',
  OTP_EXPIRED: 'otpExpired',
  TOO_MANY_ATTEMPTS: 'tooManyAttempts',
  OTP_RESEND_TOO_SOON: 'resendTooSoon',
  OTP_LOCKED: 'otpLocked',
  BANNED_USER: 'banned',
};

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

const link = (href: string) => (chunk: string) => (
  <a href={href} className="text-foreground underline underline-offset-4">
    {chunk}
  </a>
);

/**
 * Cadastro em dois passos: (1) nome e e-mail de trabalho, que a ação do servidor transforma em usuário e código de
 * acesso; (2) o código de 6 dígitos, conferido pelo mesmo login das outras telas. Entrou: segue para o assistente da
 * organização.
 */
export function SignupForm() {
  const router = useRouter();
  const { t } = useI18n();
  const S = t.signup;
  const errors = t.auth.errors;
  const [step, setStep] = useState<'start' | 'code'>('start');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const otpRef = useRef<HTMLInputElement>(null);
  const focusCode = () => requestAnimationFrame(() => otpRef.current?.focus());

  const cooldown = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const id = setInterval(() => {
      const ts = Date.now();
      setNow(ts);
      if (ts >= resendAt) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [resendAt]);

  async function submitStart(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const r = await startSignup({ email: email.trim().toLowerCase(), name: name.trim() });
    setLoading(false);
    if (!r.ok) {
      setError(r.error ?? S.errors.generic);
      return;
    }
    setResendAt(Date.now() + RESEND_SECONDS * 1000);
    setNow(Date.now());
    setCode('');
    setNotice(null);
    setStep('code');
  }

  async function resend() {
    setLoading(true);
    setError(null);
    setCode('');
    const { error: err } = await authClient.emailOtp.sendVerificationOtp({
      email: email.trim().toLowerCase(),
      type: 'sign-in',
    });
    setLoading(false);
    if (err) setError(describe(errors, err, 'sendFailed'));
    else {
      setResendAt(Date.now() + RESEND_SECONDS * 1000);
      setNow(Date.now());
      setNotice(t.auth.code.resent);
    }
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
    clearTrail();
    router.replace('/signup/organization');
    router.refresh();
  }

  if (step === 'start') {
    return (
      <form className="flex flex-col gap-3" onSubmit={submitStart}>
        <div>
          <label htmlFor="signup-name" className="mb-1.5 block text-[13px] font-medium">
            {S.start.name}
          </label>
          <Input
            id="signup-name"
            autoComplete="name"
            autoFocus
            required
            maxLength={200}
            placeholder={S.start.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="signup-email" className="mb-1.5 block text-[13px] font-medium">
            {S.start.email}
          </label>
          <Input
            id="signup-email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            required
            placeholder={S.start.emailPlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="text-muted-foreground mt-1.5 text-xs">{S.start.emailHelp}</p>
        </div>
        <Button type="submit" size="lg" className="mt-1 w-full gap-3 text-[15px]" disabled={loading}>
          {loading ? <Spinner /> : null}
          {loading ? S.start.sending : S.start.submit}
        </Button>
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        <p className="text-muted-foreground text-center text-xs leading-relaxed">
          {rich(S.start.terms, { terms: link('/terms'), privacy: link('/privacy') })}
        </p>
        <p className="text-muted-foreground text-center text-[13px]">
          {rich(S.start.login, { login: link('/login') })}
        </p>
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
        <label htmlFor="signup-otp" className="mb-1.5 block text-[13px] font-medium">
          {t.auth.code.label}
        </label>
        <InputOTP
          ref={otpRef}
          id="signup-otp"
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
        <Button
          type="button"
          variant="ghost"
          className="text-muted-foreground gap-2"
          onClick={() => {
            setStep('start');
            setCode('');
            setError(null);
            setNotice(null);
          }}
        >
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
