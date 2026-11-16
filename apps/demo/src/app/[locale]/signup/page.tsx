import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AuthShell } from '@/components/auth/auth-shell';
import { SignupForm } from '@/components/auth/signup-form';
import { buttonVariants } from '@/components/ui/button';
import { auth } from '@/lib/auth/server';
import { getT } from '@/lib/i18n/server';
import { fill, rich } from '@/lib/i18n/text';
import { readSignupSettings } from '@/lib/signup/settings-db';
import { CONTACT_EMAIL } from '@/lib/site';
import { cn } from '@/lib/utils';

// A tela lê a chave do cadastro e a sessão a cada pedido: nada aqui é pré-renderizado no build (sem banco lá).
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t.signup.meta.title,
    description: t.site.meta.description,
    alternates: { canonical: '/signup' },
    // a tela de cadastro não entra no índice (a apresentação e o login já respondem pelo domínio)
    robots: { index: false, follow: true },
  };
}

const link = (href: string) => (chunk: string) => (
  <a href={href} className="text-foreground underline underline-offset-4">
    {chunk}
  </a>
);

/**
 * Cadastro em autoatendimento (doc 02 §Cadastro). Desligado (ou sem a versão dos termos aprovada), mostra "em breve"
 * com o contato comercial, sem formulário. Quem já tem sessão vai direto ao assistente da organização.
 */
export default async function SignupPage() {
  const t = await getT();
  const S = t.signup;
  const [settings, session] = await Promise.all([
    readSignupSettings(),
    auth.api.getSession({ headers: await headers() }),
  ]);
  if (session && settings.open) redirect('/signup/organization');
  if (!settings.open) {
    return (
      <AuthShell title={S.closed.title} subtitle={S.closed.body}>
        <div className="flex flex-col items-center gap-4 text-center">
          <a href="/about#acesso" className={cn(buttonVariants({ size: 'lg' }), 'w-full text-[15px]')}>
            {S.closed.contact}
          </a>
          <p className="text-muted-foreground text-sm">
            {rich(S.closed.email, { email: link(`mailto:${CONTACT_EMAIL}`) }, { email: CONTACT_EMAIL })}
          </p>
          <p className="text-muted-foreground text-[13px]">
            {rich(S.closed.login, { login: link('/login') })}
          </p>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={S.shell.title} subtitle={fill(S.shell.subtitle, { days: settings.trialDays })}>
      <Suspense>
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}
