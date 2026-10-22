import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default function LoginPage() {
  return (
    <AuthShell title="Galaxie Sports" subtitle="Entre para explorar a demonstração">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
