'use client';

import { adminClient, emailOTPClient, inferAdditionalFields } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Cliente do auth no navegador (mesma origem: /api/auth). Login só por código enviado ao e-mail. */
export const authClient = createAuthClient({
  plugins: [
    emailOTPClient(),
    adminClient(),
    // Campo próprio que a pessoa pode mudar sozinha: o idioma (o dos próximos e-mails).
    inferAdditionalFields({ user: { locale: { type: 'string', required: false } } }),
  ],
});
