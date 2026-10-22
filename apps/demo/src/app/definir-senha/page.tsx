import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuthShell } from '@/components/auth/auth-shell';
import { SetPasswordForm } from '@/components/auth/password-forms';

export const metadata: Metadata = { title: 'Definir senha' };

export default function SetPasswordPage() {
  return (
    <AuthShell title="Crie sua senha" subtitle="Escolha a senha para acessar a demonstração">
      <Suspense>
        <SetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
