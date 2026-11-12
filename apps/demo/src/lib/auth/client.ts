'use client';

import { adminClient, emailOTPClient, inferAdditionalFields } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Cliente do auth no navegador (mesma origem: /api/auth). Login só por código enviado ao e-mail. */
export const authClient = createAuthClient({
  plugins: [
    emailOTPClient(),
    adminClient(),
    // Campo próprio que a pessoa pode mudar sozinha: o idioma (o dos próximos e-mails).
    // O perfil de torcedor (#1020) só chega para leitura: grava pela ação `saveFanProfile`.
    inferAdditionalFields({
      user: {
        locale: { type: 'string', required: false },
        fanNickname: { type: 'string', required: false, input: false },
        fanAgeBand: { type: 'string', required: false, input: false },
        fanCountry: { type: 'string', required: false, input: false },
      },
    }),
  ],
});
