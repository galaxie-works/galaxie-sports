/**
 * Rastro da equipe Galaxie (PL17): toda ação de escrita do painel do cliente passa pelo `withStaffAudit`, e o
 * embrulho recusa a equipe sem motivo, grava depois de `ok` e é transparente para o cliente.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const readClientContext = vi.fn();
const cookieGet = vi.fn();
const query = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => cookieGet(name) }) }));
vi.mock('@/lib/auth/db', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));
vi.mock('@/lib/client/session', () => ({ readClientContext: () => readClientContext() }));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'pt-BR' }));

const { auditPayload, needsStaffReason, recordStaffAction, StaffReasonError, withStaffAudit } =
  await import('./staff');
const { encodeStaffReason } = await import('./staff-reason');

const T = '01a16029-0000-7000-8000-000000000001';
const ORG = '01a16029-0000-7000-8000-00000000000a';
const tenant = { id: T, name: 'Operadora Exemplo', organizationId: ORG, isGalaxie: false };
const staff = (over: Record<string, unknown> = {}) => ({
  userId: 'u-equipe',
  email: 'equipe@galaxie.test',
  role: 'admin',
  tenant,
  tenants: [],
  memberRole: null,
  actor: { kind: 'galaxie_staff' },
  staffReason: null,
  ...over,
});
const client = () => ({
  userId: 'u-cliente',
  email: 'cliente@galaxie.test',
  role: 'client',
  tenant,
  tenants: [],
  memberRole: 'owner',
  actor: { kind: 'member', tenantId: T, role: 'owner', scope: null },
  staffReason: null,
});

beforeEach(() => {
  readClientContext.mockReset();
  cookieGet.mockReset().mockReturnValue(undefined);
  query.mockReset().mockResolvedValue({ rows: [] });
  vi.stubEnv('BETTER_AUTH_SECRET', 'segredo');
});

describe('withStaffAudit', () => {
  const action = withStaffAudit('keys.create', async (input: { name: string }) => ({
    ok: true,
    name: input.name,
  }));

  it('o cliente passa direto, sem motivo e sem registro', async () => {
    readClientContext.mockResolvedValue(client());
    expect(await action({ name: 'site' })).toEqual({ ok: true, name: 'site' });
    expect(query).not.toHaveBeenCalled();
  });

  it('a equipe sem motivo é recusada antes da ação', async () => {
    readClientContext.mockResolvedValue(staff());
    const spy = vi.fn(async () => ({ ok: true }));
    expect(await withStaffAudit('x.y', spy)()).toEqual({
      ok: false,
      error: 'Informe o motivo (ticket ou pedido do cliente) no seletor de tenant antes de agir.',
    });
    expect(spy).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('a equipe com motivo age e a ação fica registrada com quem, o quê, por quê e o pedido', async () => {
    readClientContext.mockResolvedValue(staff());
    cookieGet.mockReturnValue({ value: encodeStaffReason('segredo', { tenantId: T, reason: 'ticket 42' }) });
    expect(await action({ name: 'site' })).toEqual({ ok: true, name: 'site' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![1]).toEqual([
      T,
      ORG,
      'u-equipe',
      'keys.create',
      'ticket 42',
      { input: { name: 'site' } },
    ]);
  });

  it('ação que falhou não entra no registro; motivo de outro tenant não vale', async () => {
    readClientContext.mockResolvedValue(staff());
    cookieGet.mockReturnValue({ value: encodeStaffReason('segredo', { tenantId: T, reason: 'ticket 42' }) });
    const failing = withStaffAudit('x.y', async () => ({ ok: false, error: 'nope' }));
    expect(await failing()).toEqual({ ok: false, error: 'nope' });
    expect(query).not.toHaveBeenCalled();
    cookieGet.mockReturnValue({
      value: encodeStaffReason('segredo', {
        tenantId: '01a16029-0000-7000-8000-000000000002',
        reason: 'ticket',
      }),
    });
    expect((await action({ name: 'x' })).ok).toBe(false);
  });

  it('no tenant da Galaxie a equipe age sem motivo e sem registro', async () => {
    readClientContext.mockResolvedValue(staff({ tenant: { ...tenant, isGalaxie: true } }));
    expect(await action({ name: 'site' })).toEqual({ ok: true, name: 'site' });
    expect(query).not.toHaveBeenCalled();
    expect(needsStaffReason(staff({ tenant: { ...tenant, isGalaxie: true } }) as never)).toBe(false);
    expect(needsStaffReason(staff({ role: 'support' }) as never)).toBe(true);
    expect(needsStaffReason(client() as never)).toBe(false);
  });

  it('recordStaffAction direto: sem motivo lança; o pedido grande é cortado', async () => {
    await expect(recordStaffAction(staff() as never, 'x.y')).rejects.toBeInstanceOf(StaffReasonError);
    expect(auditPayload(undefined)).toEqual({});
    expect(auditPayload({ a: 1 })).toEqual({ input: { a: 1 } });
    expect(auditPayload('x'.repeat(5000))).toMatchObject({ truncated: true });
  });
});

/** Toda ação de escrita de `client/** /actions.ts` passa pelo embrulho; as exceções têm motivo. */
describe('cobertura das ações do painel', () => {
  const EXCEPTIONS: Record<string, string> = {
    // é a porta que guarda o motivo da equipe (não tem motivo antes dela)
    selectTenant: 'guarda o motivo',
    // só leitura
    listWebhookDeliveries: 'leitura',
  };
  const ROOT = join(__dirname, '..', '..', 'app', '[locale]', '(app)', 'client');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return name === 'actions.ts' ? [path] : [];
    });

  it('cada export de client/**/actions.ts é withStaffAudit ou exceção listada', () => {
    const found = files(ROOT);
    expect(found.length).toBeGreaterThanOrEqual(7);
    const bare: string[] = [];
    const wrapped: string[] = [];
    for (const file of found) {
      const code = readFileSync(file, 'utf8');
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      for (const m of code.matchAll(/^export async function (\w+)/gm))
        if (!EXCEPTIONS[m[1]!]) bare.push(`${rel}: ${m[1]}`);
      for (const m of code.matchAll(/^export const (\w+) = withStaffAudit\(\s*'([a-z_]+(?:\.[a-z_]+)+)'/gm))
        wrapped.push(m[2]!);
    }
    expect(bare).toEqual([]);
    expect(wrapped.length).toBeGreaterThan(20);
    expect(new Set(wrapped).size).toBe(wrapped.length);
  });
});
