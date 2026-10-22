import type { Metadata } from 'next';

import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotPasswordForm } from '@/components/auth/password-forms';

export const metadata: Metadata = { title: 'Esqueci a senha' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Redefinir senha" subtitle="Enviaremos um link para o seu e-mail">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
