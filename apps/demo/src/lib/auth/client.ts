'use client';

import { adminClient, emailOTPClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Cliente do auth no navegador (mesma origem: /api/auth). Login só por código enviado ao e-mail. */
export const authClient = createAuthClient({ plugins: [emailOTPClient(), adminClient()] });
