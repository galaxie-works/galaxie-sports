/**
 * Autenticação da demo (Better Auth): só código de acesso por e-mail (OTP), sem senha e sem cadastro
 * aberto — quem entra foi convidado por um admin. Papéis (`roles.ts`): `admin` (gerencia usuários),
 * `user` (convidado, só navega na demo) e `client` (operadora cliente, ligada a um tenant da API). O convite é um e-mail com o link da tela de login; lá a pessoa pede o
 * código e entra.
 */
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, getIP, isAPIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { admin } from 'better-auth/plugins/admin';
import { adminAc, userAc } from 'better-auth/plugins/admin/access';
import { emailOTP } from 'better-auth/plugins/email-otp';

import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, resolveLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionary';

import { pool } from './db';
import { sendAccessEmail } from './email';
import {
  clearOtpFailures,
  hasRecentOtpRequest,
  isOtpLocked,
  recordOtpFailure,
  registerOtpRequest,
} from './otp-guard';

/**
 * Código de acesso: 6 dígitos, vale 10 minutos, até 5 tentativas erradas por código. Somando os códigos,
 * há ainda o bloqueio temporário de `otp-guard.ts` (por e-mail e IP, e por e-mail, na última hora).
 */
export const OTP_LENGTH = 6;
export const OTP_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
/**
 * Intervalo mínimo para pedir outro código para o mesmo e-mail (a tela espera 60 s; o servidor, 45 s:
 * `OTP_RESEND_GUARD_SECONDS` de otp-guard.ts, no banco).
 */
export const OTP_RESEND_SECONDS = 60;

/** Idioma de uma requisição ao auth: o cookie da demo ou o `Accept-Language`. */
export function localeFromHeaders(headers: Headers | null | undefined): Locale {
  const cookie = headers
    ?.get('cookie')
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(LOCALE_COOKIE.length + 1);
  return resolveLocale(cookie, headers?.get('accept-language'));
}

const authText = (locale: Locale) => getDictionary(locale).auth.errors;

/** Validador (Standard Schema) do campo `locale`: um dos idiomas da demo, ou nulo para limpar. */
const localeInput = {
  '~standard': {
    version: 1 as const,
    vendor: 'galaxie-demo',
    validate: (value: unknown) =>
      value === null || isLocale(value) ? { value } : { issues: [{ message: 'Invalid locale' }] },
  },
};

/** Acesso vencido? Admin nunca expira; sem data = sem prazo. */
export function isAccessExpired(user: { role?: string | null; accessExpiresAt?: Date | string | null }) {
  if (user.role === 'admin' || !user.accessExpiresAt) return false;
  return new Date(user.accessExpiresAt).getTime() < Date.now();
}

/** Erros do Better Auth ao conferir o código que contam como chute errado. */
const OTP_FAILURE_CODES = new Set(['INVALID_OTP', 'TOO_MANY_ATTEMPTS']);

const OTP_SEND_PATH = '/email-otp/send-verification-otp';
const OTP_SIGN_IN_PATH = '/sign-in/email-otp';
const OTP_PATHS = new Set([OTP_SEND_PATH, OTP_SIGN_IN_PATH]);

/** E-mail do corpo de uma rota do login por código, normalizado como o Better Auth grava. */
const bodyEmail = (body: unknown) =>
  String((body as { email?: unknown } | undefined)?.email ?? '')
    .trim()
    .toLowerCase();

/** IP de quem chama (os mesmos cabeçalhos do limite por IP do Better Auth); nulo nas chamadas internas. */
function requestIp(ctx: {
  request?: Request;
  headers?: Headers;
  context: { options: Parameters<typeof getIP>[1] };
}) {
  const source = ctx.request ?? ctx.headers;
  return source ? getIP(source, ctx.context.options) : null;
}

/**
 * Envia o código fora do fluxo da requisição: o tempo de resposta não muda se a conta existe ou não. O
 * e-mail sai no idioma da tela de login (quem pediu o código está olhando para ela).
 */
function deliverOtp(email: string, code: string, locale: Locale) {
  void (async () => {
    const { rows } = await pool.query<{ name: string }>('select name from "user" where email = $1', [email]);
    await sendAccessEmail({
      kind: 'otp',
      to: email,
      name: rows[0]?.name ?? '',
      code,
      expiresInMinutes: OTP_MINUTES,
      locale,
    });
  })().catch((err) => console.error('[demo-auth] falha ao enviar o código de acesso', err));
}

export const auth = betterAuth({
  appName: 'Galaxie Sports',
  database: pool,
  // Sem e-mail e senha: as rotas de senha do Better Auth ficam desligadas. Senhas antigas que ainda
  // estejam no banco deixam de valer.
  user: {
    // Campos geridos só pelo admin (`input: false`): a rota do próprio usuário (/update-user) recusa
    // esses campos, então um convidado não estende o próprio prazo nem edita o perfil. As rotas do
    // plugin admin (create-user e update-user) gravam sem esse filtro.
    additionalFields: {
      jobTitle: { type: 'string', required: false, input: false, fieldName: 'job_title' },
      company: { type: 'string', required: false, input: false },
      phone: { type: 'string', required: false, input: false },
      notes: { type: 'string', required: false, input: false },
      accessExpiresAt: { type: 'date', required: false, input: false, fieldName: 'access_expires_at' },
      /**
       * Tenant da API (`api.tenant.id`) do usuário com papel `client`; nulo nos outros papéis. Só o admin
       * define (no convite ou no acesso): é o que limita o painel do cliente aos dados de um tenant.
       */
      tenantId: { type: 'string', required: false, input: false, fieldName: 'tenant_id' },
      /**
       * Idioma preferido (pt-BR, en, es-AR): o dos e-mails. A própria pessoa muda pelo seletor de idioma
       * (`/update-user`), então aceita entrada, mas só os três valores.
       */
      locale: { type: 'string', required: false, validator: { input: localeInput } },
    },
  },
  session: {
    // 30 dias, renovados a cada uso (no máximo uma vez por dia).
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    // Por IP (só em produção, padrão do Better Auth): pedidos de código e tentativas de login.
    customRules: {
      '/email-otp/send-verification-otp': { window: 60, max: 3 },
      '/sign-in/email-otp': { window: 60, max: 10 },
    },
  },
  // Rotas do plugin de OTP que a demo não usa (senha por OTP, troca e verificação de e-mail).
  disabledPaths: [
    '/email-otp/check-verification-otp',
    '/email-otp/verify-email',
    '/email-otp/request-password-reset',
    '/email-otp/reset-password',
    '/forget-password/email-otp',
    '/email-otp/request-email-change',
    '/email-otp/change-email',
    '/admin/set-user-password',
  ],
  advanced: {
    // Atrás do Traefik: o IP real do cliente vem no X-Forwarded-For.
    ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!OTP_PATHS.has(ctx.path)) return;
      const email = bodyEmail(ctx.body);
      if (!email) return;
      // E-mail bloqueado por erros demais: nem manda código novo nem confere o digitado.
      if (await isOtpLocked(email, requestIp(ctx))) {
        throw new APIError('TOO_MANY_REQUESTS', {
          code: 'OTP_LOCKED',
          message: authText(localeFromHeaders(ctx.headers)).otpLocked,
        });
      }
      // Um código a cada 45 s por e-mail, exista a conta ou não (a resposta não revela quem tem acesso).
      if (ctx.path === OTP_SEND_PATH && !(await registerOtpRequest(email))) {
        throw new APIError('TOO_MANY_REQUESTS', {
          code: 'OTP_RESEND_TOO_SOON',
          message: authText(localeFromHeaders(ctx.headers)).resendTooSoon,
        });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== OTP_SIGN_IN_PATH) return;
      const email = bodyEmail(ctx.body);
      if (!email) return;
      const returned = ctx.context.returned;
      const ip = requestIp(ctx);
      try {
        if (!isAPIError(returned)) await clearOtpFailures(email, ip);
        // Só conta erro depois de um pedido de código (otp-guard.ts): sem pedido não há o que acertar,
        // e contar deixaria qualquer um travar o e-mail sem que o dono receba nada.
        else if (OTP_FAILURE_CODES.has(String(returned.body?.code)) && (await hasRecentOtpRequest(email))) {
          await recordOtpFailure(email, ip);
        }
      } catch (err) {
        // a contagem não pode trocar a resposta do login (o erro do código continua sendo o que vale)
        console.error('[demo-auth] falha ao registrar a tentativa de login por código', err);
      }
    }),
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session, ctx) => {
          const { rows } = await pool.query<{ role: string | null; access_expires_at: Date | null }>(
            'select role, access_expires_at from "user" where id = $1',
            [session.userId],
          );
          const user = rows[0];
          if (user && isAccessExpired({ role: user.role, accessExpiresAt: user.access_expires_at })) {
            throw new APIError('FORBIDDEN', {
              code: 'ACCESS_EXPIRED',
              message: authText(localeFromHeaders(ctx?.headers)).expired,
            });
          }
          return { data: session };
        },
        after: async (session) => {
          await pool.query(
            `insert into activity (user_id, kind, ip_address, user_agent) values ($1, 'login', $2, $3)`,
            [session.userId, session.ipAddress ?? null, session.userAgent ?? null],
          );
        },
      },
    },
  },
  plugins: [
    emailOTP({
      otpLength: OTP_LENGTH,
      expiresIn: OTP_MINUTES * 60,
      allowedAttempts: OTP_MAX_ATTEMPTS,
      // Só quem já tem conta (convidado) recebe código; e-mail desconhecido recebe a mesma resposta.
      disableSignUp: true,
      storeOTP: 'hashed',
      async sendVerificationOTP({ email, otp, type }, ctx) {
        // A demo só usa o código para entrar; os outros tipos estão desligados (disabledPaths).
        if (type !== 'sign-in') return;
        deliverOtp(email, otp, localeFromHeaders(ctx?.headers));
      },
    }),
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
      // Papéis aceitos (outro valor é recusado ao criar ou mudar papel). O cliente tem as permissões do
      // convidado no plugin: nada de gerenciar usuários; o painel dele é guardado pelo proxy e pelas ações.
      roles: { admin: adminAc, user: userAc, client: userAc },
      bannedUserMessage: (user) => {
        const locale = (user as { locale?: unknown }).locale;
        return authText(isLocale(locale) ? locale : DEFAULT_LOCALE).banned;
      },
    }),
    // Precisa ser o último: grava os cookies de sessão quando as ações do servidor chamam a API do auth.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
export type AuthUser = Session['user'];
