'use client';

import { adminClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Cliente do auth no navegador (mesma origem: /api/auth). */
export const authClient = createAuthClient({ plugins: [adminClient()] });
