import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default function LoginPage() {
  return (
    <AuthShell title="Sports from another universe." subtitle="Enter the Galaxie and start exploring.">
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
