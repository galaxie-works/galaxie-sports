import { randomBytes } from 'node:crypto';
import {
  ledger,
  moderationReport,
  moderationAudit,
  moderationCase,
  moderationSanction,
  reservation,
  tenant,
  type Database,
} from '@galaxie/db';
import type { CompletionClient, CompletionRequest } from '@galaxie/llm';
import { fileReport, listDecisions, listQueue, undoDecision } from '@galaxie/db/moderation-queue';
import { DEFAULT_MODERATION_LISTS, compileLists } from '@galaxie/engage';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  addEntry,
  defaultModelFor,
  ensureWallet,
  getWallet,
  moderateBatch,
  MODERATION_FUNCTION,
  previewModeration,
  saveModerationConfig,
  upsertFunctionDef,
  type CosmosSettings,
  type ModerationCeiling,
  type ModerationItem,
} from '../src/index.js';

import { createTempDb, type TempDb } from './test-db.js';

let temp: TempDb;
let db: Database;
// preço de teste, não o da tabela da Galaxie: 1 crédito = US$ 0,0001
const settings: CosmosSettings = { dailyUsdCeiling: null, creditUsd: 0.0001 };
const ceiling: ModerationCeiling = { hide: 'auto', mute: 'auto', muteHours: 24 };
const env = { COSMOS_ANTHROPIC_API_KEY: 'k' };
const day = 24 * 3600_000;
const clocks = {
  contentPurgeAt: new Date(Date.now() + 30 * day),
  decisionPurgeAt: new Date(Date.now() + 365 * day),
};

beforeAll(async () => {
  temp = await createTempDb();
  db = temp.db;
});
afterAll(async () => temp?.close());

// o catálogo é global no banco do arquivo: cada teste diz se a função está ligada
async function withFunction(active = true) {
  await upsertFunctionDef(db, {
    name: MODERATION_FUNCTION,
    minCredits: 1,
    permission: 'cosmos.moderation',
    provider: 'anthropic',
    active,
  });
}

async function newTenant(
  credits: number,
  autonomy: Record<string, string> = { hide: 'auto', mute: 'auto', suspend: 'flag', ban: 'flag' },
  fullRead = false,
): Promise<string> {
  const slug = `t-${randomBytes(4).toString('hex')}`;
  const [row] = await db
    .insert(tenant)
    .values({ slug, name: slug, plan: 'enterprise', modules: ['core_data'] })
    .returning({ id: tenant.id });
  const t = row!.id;
  await ensureWallet(db, t);
  if (credits > 0)
    await addEntry(db, {
      tenantId: t,
      kind: 'purchase',
      credits,
      idempotencyKey: `k-${randomBytes(6).toString('hex')}`,
    });
  await saveModerationConfig(db, {
    tenantId: t,
    scope: { kind: 'tenant', id: '' },
    config: {
      features: {
        live_chat: true,
        communities: true,
        images: false,
        appeals: false,
        room_report: false,
        full_read: fullRead,
      },
      level: 2,
      categories: {},
      autonomy,
      muteHours: 2,
      exemptRoles: [],
      hiddenNotice: null,
    },
    expectedVersion: 0,
    userId: 'u-config',
    ceiling,
  });
  return t;
}

let seq = 0;
async function profile(t: string): Promise<string> {
  seq += 1;
  const [acc] = await db.execute<{ id: string }>(
    sql`insert into fan.account (tenant_id, external_account_id) values (${t}, ${`acc_${seq}`}) returning id`,
  );
  const [prof] = await db.execute<{ id: string }>(
    sql`insert into fan.profile (tenant_id, account_id, external_profile_id, nickname, age_band, country, locale)
        values (${t}, ${acc!.id}, ${`prof_${seq}`}, ${`Torcedor${seq}`}, '18plus', 'BR', 'pt-BR') returning id`,
  );
  return prof!.id;
}

function fakeClient(answer: string | Error): CompletionClient & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    provider: 'anthropic',
    requests,
    async complete(req) {
      requests.push(req);
      if (answer instanceof Error) throw answer;
      return {
        text: answer,
        usage: { inputTokens: 1200, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 200 },
        final: true,
        finishReason: 'stop',
        provider: 'anthropic',
        model: defaultModelFor('anthropic'),
      };
    },
    stream() {
      throw new Error('não usado');
    },
  };
}

const item = (t: string, i: number, over: Partial<ModerationItem> = {}): ModerationItem => ({
  tenantId: t,
  kind: 'chat_message',
  text: `mensagem ${i}`,
  targetType: 'message',
  targetId: `m-${randomBytes(4).toString('hex')}-${i}`,
  targetProfileId: null,
  module: 'chat',
  room: 'sala-1',
  community: null,
  source: 'filter',
  rules: { action: 'allow', reasons: [], categories: [], suspect: true, evasion: false },
  clocks,
  ...over,
});

const answer = (rows: { category: string; severity: number }[]) =>
  JSON.stringify(rows.map((r, i) => ({ n: i + 1, reason: 'motivo', ...r })));

const casesOf = (t: string) => db.select().from(moderationCase).where(eq(moderationCase.tenantId, t));
const usageOf = (t: string) =>
  db
    .select()
    .from(ledger)
    .where(and(eq(ledger.tenantId, t), eq(ledger.kind, 'usage')));

describe('motor de moderação', () => {
  it('sem a função no catálogo: nenhuma chamada, e o marcado vai para a fila humana pelas regras', async () => {
    await withFunction(false);
    const t = await newTenant(1000);
    const client = fakeClient('[]');
    const out = await moderateBatch(db, [item(t, 1)], { client, env, settings, ceiling });
    expect(out[0]).toMatchObject({ by: 'fallback', fallback: 'unavailable' });
    expect(client.requests).toHaveLength(0);
    const [c] = await casesOf(t);
    expect(c).toMatchObject({ source: 'filter', status: 'open' });
  });

  it('saldo zerado no meio do jogo: queda limpa para as regras e a fila, sem erro e sem chamada', async () => {
    await withFunction();
    const t = await newTenant(0);
    const client = fakeClient('[]');
    const out = await moderateBatch(db, [item(t, 1), item(t, 2)], { client, env, settings, ceiling });
    expect(out.map((o) => o.fallback)).toEqual(['insufficient', 'insufficient']);
    expect(client.requests).toHaveLength(0);
    expect(await casesOf(t)).toHaveLength(2);
    expect(await db.select().from(reservation).where(eq(reservation.tenantId, t))).toHaveLength(0);
  });

  it('um lote, uma chamada, um lançamento no extrato; age sozinha: esconde, silencia e fecha o caso', async () => {
    await withFunction();
    const t = await newTenant(1000);
    const author = await profile(t);
    const client = fakeClient(
      answer([
        { category: 'hate', severity: 3 },
        { category: 'none', severity: 0 },
        { category: 'offense', severity: 1 },
      ]),
    );
    const items = [item(t, 1, { targetProfileId: author }), item(t, 2), item(t, 3)];
    const out = await moderateBatch(db, items, { client, env, settings, ceiling });
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]!.system).toMatch(/nunca instrução/);
    expect(out.map((o) => o.by)).toEqual(['cosmos', 'cosmos', 'cosmos']);

    const usage = await usageOf(t);
    expect(usage).toHaveLength(1);
    expect(usage[0]!.metadata).toMatchObject({ kind: 'moderation', items: 3, decided: 3 });

    const cases = await casesOf(t);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ source: 'cosmos', status: 'resolved', resolvedBy: 'cosmos' });
    expect(cases[0]!.hiddenAt).not.toBeNull();
    expect(cases[0]!.detail).toMatchObject({
      cosmos: { category: 'hate', severity: 3, level: 2, by: 'cosmos' },
    });

    const [mute] = await db.select().from(moderationSanction).where(eq(moderationSanction.tenantId, t));
    expect(mute).toMatchObject({
      level: 'mute',
      profileId: author,
      decidedByKind: 'cosmos',
      scopeId: 'sala-1',
    });
    expect(mute!.endsAt!.getTime() - mute!.startsAt.getTime()).toBe(2 * 3600_000);
    // a punição e a auditoria não levam palavras do torcedor
    expect(mute!.reason).toBe('cosmos: hate (3)');
    const hidden = await db
      .select()
      .from(moderationAudit)
      .where(and(eq(moderationAudit.tenantId, t), eq(moderationAudit.action, 'hide')));
    expect(hidden).toHaveLength(1);
    expect(hidden[0]!.rules).toMatchObject({ step: 'auto' });

    // o que ficou publicado também tem decisão no histórico
    const allowed = await db
      .select()
      .from(moderationAudit)
      .where(and(eq(moderationAudit.tenantId, t), eq(moderationAudit.action, 'cosmos.allow')));
    expect(allowed).toHaveLength(2);
    for (const row of allowed) {
      expect(JSON.stringify(row.rules)).not.toContain('mensagem');
      expect(row.reason).not.toContain('mensagem');
    }
  });

  it('o mesmo autor várias vezes no lote: um silêncio só, e nenhum se já está silenciado', async () => {
    await withFunction();
    const t = await newTenant(1000);
    const author = await profile(t);
    const hate = { category: 'hate', severity: 3 };
    const deps = { client: fakeClient(answer([hate, hate, hate])), env, settings, ceiling };
    const three = [1, 2, 3].map((i) => item(t, i, { targetProfileId: author }));
    await moderateBatch(db, three, deps);
    await moderateBatch(db, [item(t, 4, { targetProfileId: author })], {
      ...deps,
      client: fakeClient(answer([hate])),
    });
    expect(await db.select().from(moderationSanction).where(eq(moderationSanction.tenantId, t))).toHaveLength(
      1,
    );
  });

  it('"age e avisa": esconde e silencia, mas o caso fica aberto para a equipe ver', async () => {
    await withFunction();
    const t = await newTenant(1000, { hide: 'notify', mute: 'notify', suspend: 'flag', ban: 'flag' });
    const author = await profile(t);
    const decided: string[] = [];
    await moderateBatch(db, [item(t, 1, { targetProfileId: author })], {
      client: fakeClient(answer([{ category: 'hate', severity: 3 }])),
      env,
      settings,
      ceiling,
      onDecision: (o) => void decided.push(o.item.targetId),
    });
    const [c] = await casesOf(t);
    expect(c).toMatchObject({ source: 'cosmos', status: 'open' });
    expect(c!.hiddenAt).not.toBeNull();
    expect(await db.select().from(moderationSanction).where(eq(moderationSanction.tenantId, t))).toHaveLength(
      1,
    );
    expect(decided).toHaveLength(1);
  });

  it('com a Leitura total, o termo da lista decide no classificador, sem chamada e sem cobrança', async () => {
    await withFunction();
    const t = await newTenant(1000, undefined, true);
    const client = fakeClient('[]');
    const out = await moderateBatch(
      db,
      [
        item(t, 1, {
          rules: {
            action: 'block',
            reasons: ['abuse'],
            categories: ['threat'],
            suspect: true,
            evasion: false,
          },
        }),
      ],
      { client, env, settings, ceiling },
    );
    expect(out[0]).toMatchObject({ by: 'classifier', verdict: { category: 'harassment', severity: 4 } });
    expect(client.requests).toHaveLength(0);
    expect(await usageOf(t)).toHaveLength(0);
  });

  it('sem a Leitura total no servidor, o que as regras não marcaram não vai ao modelo nem à fila', async () => {
    await withFunction();
    const t = await newTenant(1000);
    const client = fakeClient('[]');
    const out = await moderateBatch(
      db,
      [
        item(t, 1, {
          rules: { action: 'allow', reasons: [], categories: [], suspect: false, evasion: false },
        }),
      ],
      { client, env, settings, ceiling },
    );
    expect(out[0]).toMatchObject({ by: 'skipped', fallback: 'not_contracted' });
    expect(client.requests).toHaveLength(0);
    expect(await casesOf(t)).toHaveLength(0);
  });

  it('na queda, a dúvida só do classificador continua publicada, sem encher a fila', async () => {
    await withFunction();
    const t = await newTenant(0, undefined, true);
    await moderateBatch(
      db,
      [
        item(t, 1, {
          text: 'COMPREM AGORA COMPREM AGORA COMPREM AGORA',
          rules: { action: 'allow', reasons: [], categories: [], suspect: false, evasion: false },
        }),
      ],
      { client: fakeClient('[]'), env, settings, ceiling },
    );
    expect(await casesOf(t)).toHaveLength(0);
  });

  it('texto longo que a Cosmos libera: não vale (o meio não foi lido) e o marcado vai à fila', async () => {
    await withFunction();
    const t = await newTenant(1000);
    const out = await moderateBatch(db, [item(t, 1, { kind: 'wall_post', text: 'a '.repeat(3000) })], {
      client: fakeClient(answer([{ category: 'none', severity: 0 }])),
      env,
      settings,
      ceiling,
    });
    expect(out[0]).toMatchObject({ by: 'fallback', fallback: 'truncated' });
    expect(await casesOf(t)).toHaveLength(1);
  });

  it('lote com dois clientes: cada um com a sua reserva e o seu extrato', async () => {
    await withFunction();
    const a = await newTenant(1000);
    const b = await newTenant(1000);
    const out = await moderateBatch(db, [item(a, 1), item(b, 2), item(a, 3)], {
      client: fakeClient(
        answer([
          { category: 'none', severity: 0 },
          { category: 'none', severity: 0 },
        ]),
      ),
      env,
      settings,
      ceiling,
    });
    expect(out.map((o) => o.item.tenantId)).toEqual([a, b, a]);
    expect(await usageOf(a)).toHaveLength(1);
    expect(await usageOf(b)).toHaveLength(1);
  });

  it('escada em "só sinaliza": o caso fica aberto, sem esconder e sem silenciar', async () => {
    await withFunction();
    const t = await newTenant(1000, { hide: 'flag', mute: 'flag', suspend: 'flag', ban: 'flag' });
    const author = await profile(t);
    const client = fakeClient(answer([{ category: 'harassment', severity: 4 }]));
    await moderateBatch(db, [item(t, 1, { targetProfileId: author })], { client, env, settings, ceiling });
    const [c] = await casesOf(t);
    expect(c).toMatchObject({ source: 'cosmos', status: 'open', hiddenAt: null });
    expect(c!.detail).toMatchObject({
      cosmos: {
        suggestion: ['hide', 'mute', 'suspend'],
        steps: { hide: 'flag', mute: 'flag', suspend: 'flag' },
      },
    });
    expect(await db.select().from(moderationSanction).where(eq(moderationSanction.tenantId, t))).toHaveLength(
      0,
    );
  });

  it('modelo fora do ar: a reserva volta e o lote segue as regras e a fila', async () => {
    await withFunction();
    const t = await newTenant(1000);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await moderateBatch(db, [item(t, 1)], {
      client: fakeClient(new Error('timeout')),
      env,
      settings,
      ceiling,
    });
    spy.mockRestore();
    expect(out[0]).toMatchObject({ by: 'fallback', fallback: 'failed' });
    expect(await getWallet(db, t)).toMatchObject({ available: 1000, reserved: 0 });
    expect(await usageOf(t)).toHaveLength(0);
    expect((await casesOf(t))[0]).toMatchObject({ source: 'filter' });
  });

  it('resposta fora do formato: não cobra, mas o custo real fica no extrato', async () => {
    await withFunction();
    const t = await newTenant(1000);
    await moderateBatch(db, [item(t, 1)], { client: fakeClient('não sei'), env, settings, ceiling });
    const [u] = await usageOf(t);
    expect(Number(u!.credits)).toBe(0);
    expect(Number(u!.costUsd)).toBeGreaterThan(0);
  });

  it('segurado pelas regras e a Cosmos acha normal: continua fora do ar até a equipe publicar', async () => {
    await withFunction();
    const t = await newTenant(1000);
    await moderateBatch(
      db,
      [
        item(t, 1, {
          rules: {
            action: 'shadow',
            reasons: ['abuse'],
            categories: ['profanity'],
            suspect: true,
            evasion: false,
          },
        }),
      ],
      { client: fakeClient(answer([{ category: 'none', severity: 0 }])), env, settings, ceiling },
    );
    const [c] = await casesOf(t);
    expect(c).toMatchObject({ status: 'open', source: 'cosmos' });
    expect(c!.hiddenAt).not.toBeNull();
    expect(c!.detail).toMatchObject({ cosmos: { suggestion: 'allow' } });
  });

  it('denunciado e a Cosmos acha normal: a sugestão vai para o caso, e quem decide é a equipe', async () => {
    await withFunction();
    const t = await newTenant(1000);
    const [author, reporter] = [await profile(t), await profile(t)];
    const reported = item(t, 1, { source: 'report', targetProfileId: author });
    const filed = await fileReport(db, {
      tenantId: t,
      targetType: 'message',
      targetId: reported.targetId,
      targetProfileId: author,
      module: 'chat',
      room: 'sala-1',
      community: null,
      reporterProfileId: reporter,
      reason: 'other',
      note: null,
      content: reported.text,
      clocks,
      rules: { perHour: 10, hideAt: 99, hides: true, severity: () => 25 },
    });
    expect(filed.ok).toBe(true);
    await moderateBatch(db, [reported], {
      client: fakeClient(answer([{ category: 'none', severity: 0 }])),
      env,
      settings,
      ceiling,
    });
    const cases = await casesOf(t);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ source: 'report', status: 'open', hiddenAt: null });
    expect(cases[0]!.detail).toMatchObject({ cosmos: { suggestion: 'allow' } });
    expect(await db.select().from(moderationReport).where(eq(moderationReport.tenantId, t))).toHaveLength(1);
  });

  it('recurso desligado no módulo: não chama a Cosmos; o marcado vai para a fila pelas regras', async () => {
    await withFunction();
    const t = await newTenant(1000);
    await saveModerationConfig(db, {
      tenantId: t,
      scope: { kind: 'room', id: 'sala-fria' },
      config: { features: { live_chat: false } },
      expectedVersion: 0,
      userId: 'u-config',
      ceiling,
    });
    const client = fakeClient('[]');
    const out = await moderateBatch(db, [item(t, 1, { room: 'sala-fria' })], {
      client,
      env,
      settings,
      ceiling,
    });
    expect(out[0]).toMatchObject({ fallback: 'feature_off' });
    expect(client.requests).toHaveLength(0);
  });

  it('desfazer a decisão automática: o conteúdo volta, o silêncio é revogado e tudo fica no histórico', async () => {
    await withFunction();
    const t = await newTenant(1000);
    const author = await profile(t);
    await moderateBatch(db, [item(t, 1, { targetProfileId: author })], {
      client: fakeClient(answer([{ category: 'hate', severity: 3 }])),
      env,
      settings,
      ceiling,
    });
    const [c] = await casesOf(t);
    expect(c!.hiddenAt).not.toBeNull();
    const out = await undoDecision(db, {
      tenantId: t,
      caseId: c!.id,
      actor: { id: 'user:u1', kind: 'person' },
      note: 'era ironia',
      clocks,
    });
    expect(out).toEqual({ ok: true, revoked: 1 });
    const [after] = await casesOf(t);
    expect(after).toMatchObject({ status: 'dismissed', hiddenAt: null, resolvedBy: 'user:u1' });
    const [mute] = await db.select().from(moderationSanction).where(eq(moderationSanction.tenantId, t));
    expect(mute!.revokedAt).not.toBeNull();

    const history = await listDecisions(db, t);
    expect(history.map((h) => h.action)).toEqual(
      expect.arrayContaining(['cosmos.flag', 'hide', 'sanction', 'case.resolve', 'revoke', 'undo']),
    );
    expect(history[0]).toMatchObject({ action: 'undo', module: 'chat', room: 'sala-1' });
    // filtros: categoria, quem decidiu e a ação
    expect((await listDecisions(db, t, { category: 'hate', action: 'hide' })).length).toBe(1);
    expect((await listDecisions(db, t, { actorKind: 'person' })).map((h) => h.action).sort()).toEqual([
      'revoke',
      'undo',
    ]);
    expect(await listDecisions(db, t, { room: 'outra' })).toHaveLength(0);
    // paginação
    const page = await listDecisions(db, t, { limit: 2 });
    const next = await listDecisions(db, t, { limit: 2, before: page[1]!.id });
    expect(next[0]!.id < page[1]!.id).toBe(true);
    // decisão de pessoa não se desfaz por aqui
    expect(
      await undoDecision(db, {
        tenantId: t,
        caseId: c!.id,
        actor: { id: 'user:u2', kind: 'person' },
        note: null,
        clocks,
      }),
    ).toEqual({ ok: false, reason: 'not_automatic' });
  });

  it('a fila traz o prazo da apelação e nada para os outros casos', async () => {
    await withFunction(false);
    const t = await newTenant(1000);
    await moderateBatch(db, [item(t, 1)], { client: fakeClient('[]'), env, settings, ceiling });
    const [q] = await listQueue(db, t);
    expect(q).toMatchObject({ source: 'filter', dueAt: null });
  });

  it('testar com uma mensagem: mostra o que a Cosmos faria e o custo, sem gravar caso nem histórico', async () => {
    await withFunction();
    const t = await newTenant(1000);
    const lists = compileLists(DEFAULT_MODERATION_LISTS);
    const out = await previewModeration(
      db,
      { tenantId: t, text: 'texto de teste', kind: 'chat_message', module: 'chat', room: 'sala-1' },
      lists,
      { client: fakeClient(answer([{ category: 'offense', severity: 3 }])), env, settings, ceiling },
    );
    expect(out).toMatchObject({ by: 'cosmos', verdict: { category: 'offense', severity: 3 } });
    expect(out.plan!.actions.map((a) => a.action)).toEqual(['hide']);
    expect(out.credits).toBeGreaterThan(0);
    expect(await casesOf(t)).toHaveLength(0);
    expect(await listDecisions(db, t)).toHaveLength(0);
    const [u] = await usageOf(t);
    expect(u!.metadata).toMatchObject({ kind: 'moderation', test: true, items: 1 });

    const broke = await newTenant(0);
    const none = await previewModeration(
      db,
      { tenantId: broke, text: 'oi', kind: 'chat_message', module: 'chat' },
      lists,
      { client: fakeClient('[]'), env, settings, ceiling },
    );
    expect(none).toMatchObject({ by: null, fallback: 'insufficient', credits: 0 });
  });
});
