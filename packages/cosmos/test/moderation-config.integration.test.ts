import { randomBytes } from 'node:crypto';
import { runtimeSetting, tenant, type Database } from '@galaxie/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_MODERATION_CONFIG,
  isCosmosError,
  listModerationHistory,
  listModerationOverrides,
  loadModerationConfig,
  readModerationCeiling,
  removeModerationOverride,
  saveModerationConfig,
  TENANT_SCOPE,
  type ModerationCeiling,
} from '../src/index.js';

import { createTempDb, type TempDb } from './test-db.js';

let temp: TempDb;
let db: Database;
const open: ModerationCeiling = { hide: 'auto', mute: 'auto', muteHours: 24 };

async function newTenant(): Promise<string> {
  const [row] = await db
    .insert(tenant)
    .values({
      slug: `t-${randomBytes(4).toString('hex')}`,
      name: 'Clube',
      plan: 'enterprise',
      modules: ['core_data'],
      markets: ['BR'],
    })
    .returning({ id: tenant.id });
  return row!.id;
}

const expectCode = (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e: unknown) => isCosmosError(e) && e.code === code);

beforeAll(async () => {
  temp = await createTempDb();
  db = temp.db;
});
afterAll(async () => temp?.close());

describe('configuração da moderação (#997)', () => {
  it('sem nada salvo vale o padrão; salvar versiona e registra quem mudou', async () => {
    const t = await newTenant();
    const first = await loadModerationConfig(db, t, open);
    expect(first.effective).toEqual(DEFAULT_MODERATION_CONFIG);
    expect(first.tenant).toBeNull();

    const config = {
      ...DEFAULT_MODERATION_CONFIG,
      features: { ...DEFAULT_MODERATION_CONFIG.features, live_chat: true },
      level: 3,
    };
    expect(
      await saveModerationConfig(db, {
        tenantId: t,
        scope: TENANT_SCOPE,
        config,
        expectedVersion: 0,
        userId: 'u1',
        ceiling: open,
      }),
    ).toEqual({ version: 1 });
    expect(
      await saveModerationConfig(db, {
        tenantId: t,
        scope: TENANT_SCOPE,
        config: { ...config, level: 4 },
        expectedVersion: 1,
        userId: 'u2',
        ceiling: open,
      }),
    ).toEqual({ version: 2 });

    const now = await loadModerationConfig(db, t, open);
    expect(now.effective.level).toBe(4);
    expect(now.tenant).toMatchObject({ version: 2, updatedBy: 'u2' });
    const history = await listModerationHistory(db, t);
    expect(history.map((h) => [h.version, h.changedBy])).toEqual([
      [2, 'u2'],
      [1, 'u1'],
    ]);
  });

  it('versão velha (outra aba salvou antes) dá conflito e não grava', async () => {
    const t = await newTenant();
    const base = {
      tenantId: t,
      scope: TENANT_SCOPE,
      config: DEFAULT_MODERATION_CONFIG,
      userId: 'u',
      ceiling: open,
    };
    await saveModerationConfig(db, { ...base, expectedVersion: 0 });
    await expectCode(saveModerationConfig(db, { ...base, expectedVersion: 0 }), 'version_conflict');
    // duas primeiras gravações ao mesmo tempo: uma entra, a outra vira conflito
    const t2 = await newTenant();
    const results = await Promise.allSettled(
      [0, 1].map(() => saveModerationConfig(db, { ...base, tenantId: t2, expectedVersion: 0 })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await listModerationHistory(db, t2)).length).toBe(1);
  });

  it('o servidor recusa banir e suspender automático mesmo com payload forjado', async () => {
    const t = await newTenant();
    await expectCode(
      saveModerationConfig(db, {
        tenantId: t,
        scope: TENANT_SCOPE,
        config: {
          ...DEFAULT_MODERATION_CONFIG,
          autonomy: { ...DEFAULT_MODERATION_CONFIG.autonomy, ban: 'auto' },
        },
        expectedVersion: 0,
        userId: 'u',
        ceiling: open,
      }),
      'invalid_moderation_config',
    );
    await expectCode(
      saveModerationConfig(db, {
        tenantId: t,
        scope: { kind: 'room', id: 'sala-1' },
        config: { autonomy: { suspend: 'notify' } },
        expectedVersion: 0,
        userId: 'u',
        ceiling: open,
      }),
      'invalid_moderation_config',
    );
    expect(await listModerationHistory(db, t)).toEqual([]);
  });

  it('exceção de sala herda o cliente, aparece na lista e pode sair', async () => {
    const t = await newTenant();
    await saveModerationConfig(db, {
      tenantId: t,
      scope: TENANT_SCOPE,
      config: { ...DEFAULT_MODERATION_CONFIG, level: 3 },
      expectedVersion: 0,
      userId: 'u',
      ceiling: open,
    });
    const room = { kind: 'room' as const, id: 'sala-final' };
    await saveModerationConfig(db, {
      tenantId: t,
      scope: room,
      config: { autonomy: { hide: 'auto' } },
      expectedVersion: 0,
      userId: 'u',
      ceiling: open,
    });
    const inRoom = await loadModerationConfig(db, t, open, room);
    expect(inRoom.effective.level).toBe(3);
    expect(inRoom.effective.autonomy.hide).toBe('auto');
    expect(
      (await loadModerationConfig(db, t, open, { kind: 'room', id: 'outra' })).effective.autonomy.hide,
    ).toBe('notify');
    expect((await listModerationOverrides(db, t)).map((o) => o.scope)).toEqual([room]);

    await removeModerationOverride(db, { tenantId: t, scope: room, expectedVersion: 1, userId: 'u2' });
    expect(await listModerationOverrides(db, t)).toEqual([]);
    const [last] = await listModerationHistory(db, t, { scope: room });
    expect(last).toMatchObject({ config: null, changedBy: 'u2', version: 2 });
  });

  it('teto da Galaxie lido do painel: baixar o teto rebaixa o que já estava salvo', async () => {
    const t = await newTenant();
    await saveModerationConfig(db, {
      tenantId: t,
      scope: TENANT_SCOPE,
      config: {
        ...DEFAULT_MODERATION_CONFIG,
        autonomy: { hide: 'auto', mute: 'auto', suspend: 'flag', ban: 'flag' },
      },
      expectedVersion: 0,
      userId: 'u',
      ceiling: open,
    });
    await db.insert(runtimeSetting).values([
      { key: 'COSMOS_MOD_HIDE_MAX', value: 'notify', valueType: 'enum', updatedBy: 'staff' },
      { key: 'COSMOS_MOD_MUTE_MAX_HOURS', value: '3', valueType: 'int', updatedBy: 'staff' },
    ]);
    const ceiling = await readModerationCeiling(db, {});
    expect(ceiling).toEqual({ hide: 'notify', mute: 'auto', muteHours: 3 });
    const c = await loadModerationConfig(db, t, ceiling);
    expect(c.effective.autonomy.hide).toBe('notify');
    expect(c.effective.muteHours).toBe(3);
  });
});
