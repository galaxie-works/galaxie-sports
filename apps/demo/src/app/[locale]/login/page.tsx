import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';
import { getT } from '@/lib/i18n/server';
import { rich } from '@/lib/i18n/text';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t.auth.meta.title,
    description: t.site.meta.description,
    alternates: { canonical: '/login' },
  };
}

export default async function LoginPage() {
  const t = await getT();
  return (
    <AuthShell title={t.auth.shell.title} subtitle={t.auth.shell.subtitle}>
      <Suspense>
        <LoginForm />
      </Suspense>
      {/* O que é a plataforma, para quem chega direto no login (pessoas e filtros web). */}
      <p className="text-muted-foreground mt-8 text-center text-sm leading-relaxed text-balance">
        {rich(t.auth.about.text, {
          more: (chunk) => (
            <a href="/sobre" className="text-foreground underline underline-offset-4">
              {chunk}
            </a>
          ),
        })}
      </p>
    </AuthShell>
  );
}
