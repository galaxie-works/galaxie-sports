import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { codeFor, createAuthTestDb, type AuthTestDb } from './support/auth-db';

/*
 * Bloqueio temporário do login por código (lib/auth/otp-guard.ts) com o Better Auth de verdade contra um
 * Postgres descartável: a contagem fica no banco (sobrevive a reinício) e o bloqueio se desfaz sozinho
 * quando as tentativas erradas saem da janela. Só o envio do e-mail é falso (guarda o código).
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

const signIn = (email: string, otp: string) => outcome(server.auth.api.signInEmailOTP({ body: { email, otp } }));
const sendCode = (email: string) =>
  outcome(server.auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } }));
const failures = async (email: string) =>
  (await db.sql.query<{ n: number }>('select count(*)::int as n from otp_failure where email = $1', [email]))
    .rows[0]!.n;

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
    await db.sql.query(
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
