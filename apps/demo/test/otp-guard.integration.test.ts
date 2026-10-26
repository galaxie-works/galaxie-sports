import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { codeFor, createAuthTestDb, sentCodes, type AuthTestDb } from './support/auth-db';

/*
 * Proteção do login por código (lib/auth/otp-guard.ts) com o Better Auth de verdade contra um Postgres
 * descartável: erro só conta depois de um pedido de código; o bloqueio é por e-mail e IP (quem erra trava
 * a si mesmo) e por e-mail somando os IPs; tudo fica no banco (sobrevive a reinício) e se desfaz quando os
 * erros saem da janela ou o admin destrava. Só o envio do e-mail é falso (guarda o código).
 */

vi.mock('../src/lib/auth/email', async () => (await import('./support/auth-db')).fakeEmailModule);

let db: AuthTestDb;
let server: typeof import('../src/lib/auth/server');
let guard: typeof import('../src/lib/auth/otp-guard');

beforeAll(async () => {
  db = await createAuthTestDb();
  server = await import('../src/lib/auth/server');
  guard = await import('../src/lib/auth/otp-guard');
});

afterAll(async () => {
  await db?.drop();
});

/** Código do erro do Better Auth (ou `ok` quando a chamada passa). */
async function outcome(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return 'ok';
  } catch (err) {
    return String((err as { body?: { code?: unknown } }).body?.code ?? err);
  }
}

const from = (ip: string) => new Headers({ 'x-forwarded-for': ip });
const ATTACKER = '203.0.113.7';
const OWNER = '198.51.100.20';

const signIn = (email: string, otp: string, ip = ATTACKER) =>
  outcome(server.auth.api.signInEmailOTP({ body: { email, otp }, headers: from(ip) }));
const sendCode = (email: string, ip = ATTACKER) =>
  outcome(server.auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' }, headers: from(ip) }));
const failures = async (email: string) =>
  (await db.sql.query<{ n: number }>('select count(*)::int as n from otp_failure where email = $1', [email]))
    .rows[0]!.n;
/** Libera o próximo pedido de código (passa os 45 s entre pedidos). */
const ageRequests = (email: string) =>
  db.sql.query(`update otp_request set created_at = created_at - interval '1 minute' where email = $1`, [
    email,
  ]);
const invite = (email: string) =>
  server.auth.api.createUser({ body: { email, name: email.split('@')[0]!, role: 'user' } });
const wrongFor = (code: string | undefined) => (code === '000000' ? '111111' : '000000');

describe('erro sem pedido de código', () => {
  it('não conta: ninguém trava o e-mail de outra pessoa em silêncio', async () => {
    const email = 'admin.alvo@galaxie.test';
    await invite(email);
    for (let i = 0; i < guard.OTP_MAX_FAILURES_PER_EMAIL + 5; i++) {
      expect(await signIn(email, '000000')).toBe('INVALID_OTP');
    }
    expect(await failures(email)).toBe(0);
    // o dono entra normalmente
    expect(await sendCode(email, OWNER)).toBe('ok');
    expect(await signIn(email, await codeFor(email), OWNER)).toBe('ok');
  });
});

describe('erro depois de um pedido de código', () => {
  const email = 'convidada@galaxie.test';

  it('trava só o IP que errou demais; o dono entra de outro IP', async () => {
    await invite(email);
    expect(await sendCode(email)).toBe('ok');
    for (let i = 0; i < guard.OTP_MAX_FAILURES_PER_IP; i++) {
      expect(['INVALID_OTP', 'TOO_MANY_ATTEMPTS']).toContain(await signIn(email, '000000'));
    }
    expect(await failures(email)).toBe(guard.OTP_MAX_FAILURES_PER_IP);
    // bloqueado neste IP: nem confere o código nem manda outro (e o erro não conta mais)
    expect(await signIn(email, '123456')).toBe('OTP_LOCKED');
    await ageRequests(email);
    expect(await sendCode(email)).toBe('OTP_LOCKED');
    expect(await failures(email)).toBe(guard.OTP_MAX_FAILURES_PER_IP);

    sentCodes.delete(email);
    expect(await sendCode(email, OWNER)).toBe('ok');
    const code = await codeFor(email);
    expect(await signIn(email, wrongFor(code), OWNER)).toBe('INVALID_OTP');
    expect(await signIn(email, code, OWNER)).toBe('ok');
    // o login certo zera só a contagem do IP do dono: o atacante continua travado
    expect(await failures(email)).toBe(guard.OTP_MAX_FAILURES_PER_IP);
    expect(await signIn(email, '000000')).toBe('OTP_LOCKED');
  });

  it('o bloqueio sobrevive a reinício (fica no banco, não na memória do processo)', async () => {
    vi.resetModules();
    const fresh = await import('../src/lib/auth/server');
    expect(
      await outcome(
        fresh.auth.api.signInEmailOTP({ body: { email, otp: '000000' }, headers: from(ATTACKER) }),
      ),
    ).toBe('OTP_LOCKED');
  });

  it('se desfaz quando os erros saem da janela', async () => {
    await db.sql.query(
      `update otp_failure set created_at = now() - make_interval(mins => $2 + 1) where email = $1`,
      [email, guard.OTP_FAILURE_WINDOW_MINUTES],
    );
    expect(await signIn(email, '000000')).not.toBe('OTP_LOCKED');
  });

  it('teto por e-mail somando os IPs: ataque distribuído trava o e-mail todo', async () => {
    const target = 'distribuido@galaxie.test';
    await invite(target);
    const ips = ['192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4'];
    const perIp = guard.OTP_MAX_FAILURES_PER_EMAIL / ips.length;
    expect(perIp).toBeLessThan(guard.OTP_MAX_FAILURES_PER_IP);
    expect(await sendCode(target)).toBe('ok');
    for (const ip of ips) for (let i = 0; i < perIp; i++) await signIn(target, '000000', ip);
    expect(await failures(target)).toBe(guard.OTP_MAX_FAILURES_PER_EMAIL);
    expect(await signIn(target, '000000', OWNER)).toBe('OTP_LOCKED');
    expect(await guard.otpFailureSummary(target)).toEqual({
      failures: guard.OTP_MAX_FAILURES_PER_EMAIL,
      locked: true,
    });
    // o admin destrava (apaga tudo do e-mail)
    await guard.clearOtpFailures(target);
    expect(await signIn(target, '000000', OWNER)).not.toBe('OTP_LOCKED');
  });

  it('e-mail sem conta segue a mesma regra (a resposta não revela quem tem acesso)', async () => {
    const ghost = 'ninguem@galaxie.test';
    for (let i = 0; i < 25; i++) expect(await signIn(ghost, '000000')).toBe('INVALID_OTP');
    expect(await sendCode(ghost)).toBe('ok');
    for (let i = 0; i < guard.OTP_MAX_FAILURES_PER_IP; i++) await signIn(ghost, '000000');
    expect(await signIn(ghost, '000000')).toBe('OTP_LOCKED');
  });
});

describe('pedidos de código', () => {
  it('um a cada 45 s por e-mail, gravado no banco (vale depois de reiniciar)', async () => {
    const email = 'pressa@galaxie.test';
    expect(await sendCode(email)).toBe('ok');
    expect(await sendCode(email, OWNER)).toBe('OTP_RESEND_TOO_SOON');
    vi.resetModules();
    const fresh = await import('../src/lib/auth/server');
    expect(
      await outcome(
        fresh.auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' }, headers: from(OWNER) }),
      ),
    ).toBe('OTP_RESEND_TOO_SOON');
    await ageRequests(email);
    expect(await sendCode(email, OWNER)).toBe('ok');
  });
});
