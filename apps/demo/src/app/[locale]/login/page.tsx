import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).auth.meta.title };
}

export default async function LoginPage() {
  const t = await getT();
  return (
    <AuthShell title={t.auth.shell.title} subtitle={t.auth.shell.subtitle}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
