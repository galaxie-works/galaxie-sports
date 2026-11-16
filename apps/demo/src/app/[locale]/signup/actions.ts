'use server';

/**
 * Passo 1 do cadastro em autoatendimento (doc 02 §Cadastro): e-mail de trabalho e nome. Cria o usuário pelo mesmo
 * caminho dos convites (`auth.api.createUser`, sem senha, papel `client`) e manda o código de acesso; e-mail que já
 * tem usuário só recebe o código (vira login). Um trial por domínio de e-mail de empresa (PL2): se a empresa já tem
 * organização em trial, a pessoa pede um convite. E-mail grátis não é barrado aqui: a organização nasce em revisão.
 */
import { APIError } from 'better-auth/api';
import { headers } from 'next/headers';

import { pool } from '@/lib/auth/db';
import { auth } from '@/lib/auth/server';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { emailDomain, isFreeEmailDomain, normalizeEmail } from '@/lib/signup/email-domain';
import { findTrialOrganizationForDomain } from '@/lib/signup/guards';
import { normalizeName, PERSON_NAME_MAX } from '@/lib/signup/organization';
import { readSignupSettings } from '@/lib/signup/settings-db';

export interface StartSignupResult {
  ok: boolean;
  error?: string;
}

export async function startSignup(input: { email: string; name: string }): Promise<StartSignupResult> {
  const locale = await getRequestLocale();
  const t = getDictionary(locale);
  const e = t.signup.errors;
  const settings = await readSignupSettings();
  if (!settings.open) return { ok: false, error: e.closed };
  const email = normalizeEmail(input?.email);
  if (!email) return { ok: false, error: e.invalidEmail };
  const name = normalizeName(input?.name, PERSON_NAME_MAX);
  if (!name) return { ok: false, error: e.nameRequired };

  const { rows } = await pool.query<{ id: string }>('select id from "user" where lower(email) = $1', [email]);
  if (!rows[0]) {
    const domain = emailDomain(email);
    if (!isFreeEmailDomain(domain)) {
      const existing = await findTrialOrganizationForDomain(domain);
      if (existing) return { ok: false, error: fill(e.domainInTrial, { organization: existing.name }) };
    }
    // sem headers: chamada do servidor (o plugin admin só exige sessão de admin numa requisição)
    await auth.api.createUser({
      body: { email, name, role: 'client', data: { tenantId: null, accessExpiresAt: null, locale } },
    });
  }
  try {
    // com os headers: o limite por IP e o idioma do e-mail do código são os da pessoa
    await auth.api.sendVerificationOTP({ headers: await headers(), body: { email, type: 'sign-in' } });
  } catch (err) {
    if (err instanceof APIError) {
      const code = String(err.body?.code ?? '');
      if (code === 'OTP_RESEND_TOO_SOON') return { ok: false, error: t.auth.errors.resendTooSoon };
      if (code === 'OTP_LOCKED') return { ok: false, error: t.auth.errors.otpLocked };
      if (err.statusCode === 429) return { ok: false, error: t.auth.errors.rateLimited };
    }
    console.error('[cadastro] falha ao enviar o código de acesso', err);
    return { ok: false, error: t.auth.errors.sendFailed };
  }
  return { ok: true };
}
