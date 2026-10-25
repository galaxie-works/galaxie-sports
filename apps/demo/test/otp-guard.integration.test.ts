import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/*
 * Bloqueio temporário do login por código (lib/auth/otp-guard.ts) com o Better Auth de verdade contra um
 * Postgres descartável: a contagem fica no banco (sobrevive a reinício) e o bloqueio se desfaz sozinho
 * quando as tentativas erradas saem da janela. Só o envio do e-mail é falso (guarda o código).
 */

const mail = vi.hoisted(() => ({ codes: new Map<string, string>() }));
vi.mock('../src/lib/auth/email', () => ({
  sendAccessEmail: async ({ to, code }: { to: string; code?: string }) => {
    if (code) mail.codes.set(to, code);
    return { delivered: true };
  },
}));

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração.');
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let sql: Client;
let server: typeof import('../src/lib/auth/server');
let guard: typeof import('../src/lib/auth/otp-guard');

beforeAll(async () => {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  // o pool da demo lê a URL ao ser importado
  process.env.DEMO_DATABASE_URL = testUrl;
  delete process.env.DEMO_ADMIN_EMAIL;
  const { setupAuthDatabase } = await import('../src/lib/auth/setup');
  await setupAuthDatabase();
  server = await import('../src/lib/auth/server');
  guard = await import('../src/lib/auth/otp-guard');
  sql = new Client({ connectionString: testUrl, options: '-c search_path=demo_auth' });
  await sql.connect();
});

afterAll(async () => {
  await sql?.end();
  const { pool } = await import('../src/lib/auth/db');
  await pool.end();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
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

const signIn = (email: string, otp: string) => outcome(server.auth.api.signInEmailOTP({ body: { email, otp } }));
const sendCode = (email: string) =>
  outcome(server.auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } }));
const failures = async (email: string) =>
  (await sql.query<{ n: number }>('select count(*)::int as n from otp_failure where email = $1', [email]))
    .rows[0]!.n;

/** O envio do código sai fora da requisição (deliverOtp): espera o e-mail falso receber. */
async function codeFor(email: string) {
  await vi.waitFor(() => expect(mail.codes.get(email)).toBeDefined());
  return mail.codes.get(email)!;
}

describe('bloqueio do login por código', () => {
  const email = 'chute@galaxie.test';

  it('conta erros de qualquer código e bloqueia o e-mail ao chegar ao limite', async () => {
    for (let i = 0; i < guard.OTP_MAX_FAILURES; i++) expect(await signIn(email, '000000')).toBe('INVALID_OTP');
    expect(await failures(email)).toBe(guard.OTP_MAX_FAILURES);
    // bloqueado: nem confere o código nem manda outro (o erro não conta como tentativa)
    expect(await signIn(email, '123456')).toBe('OTP_LOCKED');
    expect(await sendCode(email)).toBe('OTP_LOCKED');
    expect(await failures(email)).toBe(guard.OTP_MAX_FAILURES);
    // outro e-mail segue livre
    expect(await signIn('outro@galaxie.test', '000000')).toBe('INVALID_OTP');
  });

  it('o bloqueio sobrevive a reinício (fica no banco, não na memória do processo)', async () => {
    vi.resetModules();
    const fresh = await import('../src/lib/auth/server');
    expect(await outcome(fresh.auth.api.signInEmailOTP({ body: { email, otp: '000000' } }))).toBe(
      'OTP_LOCKED',
    );
  });

  it('é temporário: some quando as tentativas erradas saem da janela', async () => {
    await sql.query(
      `update otp_failure set created_at = now() - make_interval(mins => $2 + 1) where email = $1`,
      [email, guard.OTP_FAILURE_WINDOW_MINUTES],
    );
    expect(await signIn(email, '000000')).toBe('INVALID_OTP');
    // a limpeza leva junto o que já saiu da janela
    expect(await failures(email)).toBe(1);
  });
});

describe('login legítimo', () => {
  it('erros abaixo do limite não atrapalham, e o login certo zera a contagem', async () => {
    const email = 'convidada@galaxie.test';
    await server.auth.api.createUser({ body: { email, name: 'Convidada', role: 'user' } });
    expect(await sendCode(email)).toBe('ok');
    const code = await codeFor(email);
    const wrong = code === '000000' ? '111111' : '000000';
    expect(await signIn(email, wrong)).toBe('INVALID_OTP');
    expect(await signIn(email, wrong)).toBe('INVALID_OTP');
    expect(await failures(email)).toBe(2);
    expect(await signIn(email, code)).toBe('ok');
    expect(await failures(email)).toBe(0);
  });
});
