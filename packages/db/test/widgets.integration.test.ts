import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  archiveWidget,
  closeDb,
  createDb,
  createPublishableKey,
  getWidget,
  hashPublishableKey,
  listActivePublishableOrigins,
  listPublishableKeys,
  listWidgets,
  publishableKey,
  revokePublishableKey,
  runMigrations,
  saveWidget,
  tenant,
  touchPublishableKey,
  verifyPublishableKey,
  type Database,
  type WidgetConfig,
} from '../src/index.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let db: Database;
let tenantA: string;
let tenantB: string;

const config: WidgetConfig = {
  theme: {
    primary: '#0a84ff',
    background: '#ffffff',
    surface: '#f5f5f7',
    foreground: '#111111',
    mutedForeground: '#6b7280',
    border: '#e5e7eb',
    radius: 12,
    fontFamily: 'Inter, sans-serif',
    density: 'comfortable',
    mode: 'light',
  },
  locale: 'pt-BR',
  market: 'BR',
  defaults: { sport: 'football', competitionId: 'c1' },
};

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 3 });
  const rows = await db
    .insert(tenant)
    .values([
      {
        slug: 'operadora-exemplo',
        name: 'Operadora Exemplo',
        plan: 'fan_experience',
        modules: ['core_data'],
      },
      { slug: 'outra', name: 'Outra', plan: 'core_data', modules: ['core_data'] },
    ])
    .returning({ id: tenant.id });
  tenantA = rows[0]!.id;
  tenantB = rows[1]!.id;
});

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('widgets', () => {
  it('cria, atualiza (versão sobe), lista e arquiva por tenant', async () => {
    const w = await saveWidget(db, {
      tenantId: tenantA,
      kind: 'match_card',
      name: ' Card do jogo ',
      config,
      createdBy: 'teste.admin@galaxie.test',
    });
    expect(w).toMatchObject({ kind: 'match_card', name: 'Card do jogo', version: 1, archivedAt: null });

    const v2 = await saveWidget(db, {
      tenantId: tenantA,
      id: w.id,
      kind: 'match_card',
      name: 'Card do jogo',
      config: { ...config, theme: { ...config.theme, mode: 'dark' } },
      createdBy: 'outra.pessoa@galaxie.test',
    });
    expect(v2.version).toBe(2);
    expect(v2.createdBy).toBe('teste.admin@galaxie.test');
    expect(v2.config.theme.mode).toBe('dark');

    // outro tenant não edita nem arquiva
    await expect(
      saveWidget(db, { tenantId: tenantB, id: w.id, kind: 'standings', name: 'x', config, createdBy: 'x' }),
    ).rejects.toThrow(/não encontrado/);
    expect(await archiveWidget(db, tenantB, w.id)).toBe(false);

    expect((await listWidgets(db, tenantA)).map((x) => x.id)).toEqual([w.id]);
    expect(await listWidgets(db, tenantB)).toEqual([]);
    expect(await getWidget(db, w.id)).toMatchObject({ id: w.id, version: 2 });
    expect(await getWidget(db, 'nao-e-uuid')).toBeNull();

    expect(await archiveWidget(db, tenantA, w.id)).toBe(true);
    expect(await archiveWidget(db, tenantA, w.id)).toBe(false);
    expect(await listWidgets(db, tenantA)).toEqual([]);
    expect((await getWidget(db, w.id))?.archivedAt).toBeInstanceOf(Date);
    await expect(
      saveWidget(db, { tenantId: tenantA, id: w.id, kind: 'match_card', name: 'x', config, createdBy: 'x' }),
    ).rejects.toThrow(/não encontrado/);
  });

  it('recusa tipo e nome inválidos', async () => {
    await expect(
      saveWidget(db, { tenantId: tenantA, kind: 'bracket' as never, name: 'x', config, createdBy: 'x' }),
    ).rejects.toThrow(/Tipo/);
    await expect(
      saveWidget(db, { tenantId: tenantA, kind: 'standings', name: '  ', config, createdBy: 'x' }),
    ).rejects.toThrow(/Nome/);
  });
});

describe('chaves publicáveis', () => {
  it('guarda só o hash, lista sem segredo e verifica pela chave em texto puro', async () => {
    const created = await createPublishableKey(db, {
      tenantId: tenantA,
      name: 'App da Operadora Exemplo',
      allowedOrigins: ['https://App.Exemplo.com/', 'https://*.exemplo.com', 'https://app.exemplo.com'],
    });
    expect(created.key).toMatch(/^gs_pk_live_/);

    const [row] = await db.select().from(publishableKey).where(eq(publishableKey.id, created.id));
    expect(row!.keyHash).toBe(hashPublishableKey(created.key));
    expect(JSON.stringify(row)).not.toContain(created.key);
    expect(row!.allowedOrigins).toEqual(['https://app.exemplo.com', 'https://*.exemplo.com']);

    const listed = await listPublishableKeys(db, tenantA);
    expect(listed.map((k) => k.id)).toContain(created.id);
    expect(JSON.stringify(listed)).not.toContain(row!.keyHash);
    expect(await listPublishableKeys(db, tenantB)).toEqual([]);

    const verified = await verifyPublishableKey(db, created.key);
    expect(verified).toMatchObject({
      keyId: created.id,
      tenantId: tenantA,
      tenant: { slug: 'operadora-exemplo', modules: ['core_data'] },
      allowedOrigins: ['https://app.exemplo.com', 'https://*.exemplo.com'],
      widgetId: null,
      widgetKind: null,
    });
    // chave adulterada: troca o último caractere por outro (trocar sempre por '0' não mudava nada quando a
    // chave já terminava em '0', 1 em cada 16 chaves de base64url)
    const tampered = created.key.slice(0, -1) + (created.key.endsWith('A') ? 'E' : 'A');
    expect(tampered).not.toBe(created.key);
    expect(await verifyPublishableKey(db, tampered)).toBeNull();
    expect(await verifyPublishableKey(db, 'gs_live_qualquer')).toBeNull();
    expect(await listActivePublishableOrigins(db)).toEqual(
      expect.arrayContaining(['https://app.exemplo.com', 'https://*.exemplo.com']),
    );

    await touchPublishableKey(db, created.id, new Date('2026-10-23T12:00:00Z'));
    expect((await listPublishableKeys(db, tenantA)).find((k) => k.id === created.id)?.lastUsedAt).toEqual(
      new Date('2026-10-23T12:00:00Z'),
    );

    expect(await revokePublishableKey(db, tenantB, created.id)).toBe(false);
    expect(await revokePublishableKey(db, tenantA, created.id)).toBe(true);
    expect(await revokePublishableKey(db, tenantA, created.id)).toBe(false);
    expect(await verifyPublishableKey(db, created.key)).toBeNull();
  });

  it('valida origens na criação', async () => {
    await expect(
      createPublishableKey(db, { tenantId: tenantA, name: 'x', allowedOrigins: [] }),
    ).rejects.toThrow(/ao menos uma origem/);
    await expect(
      createPublishableKey(db, { tenantId: tenantA, name: 'x', allowedOrigins: ['https://*.com'] }),
    ).rejects.toThrow(/Origem inválida/);
  });

  it('chave presa a widget: exige widget do tenant e cai quando ele é arquivado', async () => {
    const w = await saveWidget(db, {
      tenantId: tenantA,
      kind: 'standings',
      name: 'Tabela',
      config,
      createdBy: 'x',
    });
    await expect(
      createPublishableKey(db, {
        tenantId: tenantB,
        name: 'x',
        allowedOrigins: ['https://b.test'],
        widgetId: w.id,
      }),
    ).rejects.toThrow(/Widget/);

    const created = await createPublishableKey(db, {
      tenantId: tenantA,
      name: 'Só a tabela',
      allowedOrigins: ['https://app.exemplo.com'],
      widgetId: w.id,
    });
    expect(await verifyPublishableKey(db, created.key)).toMatchObject({
      widgetId: w.id,
      widgetKind: 'standings',
    });
    const free = await createPublishableKey(db, {
      tenantId: tenantA,
      name: 'Qualquer widget',
      allowedOrigins: ['https://app.exemplo.com'],
    });
    await archiveWidget(db, tenantA, w.id);
    expect(await verifyPublishableKey(db, created.key)).toBeNull();
    // o painel mostra a chave presa como revogada; a chave sem widget continua valendo
    const keys = await listPublishableKeys(db, tenantA);
    expect(keys.find((k) => k.id === created.id)?.revokedAt).toBeInstanceOf(Date);
    expect(keys.find((k) => k.id === free.id)?.revokedAt).toBeNull();
    expect(await verifyPublishableKey(db, free.key)).not.toBeNull();
  });

  it('tenant suspenso invalida a chave', async () => {
    const created = await createPublishableKey(db, {
      tenantId: tenantB,
      name: 'B',
      allowedOrigins: ['https://b.test'],
    });
    expect(await verifyPublishableKey(db, created.key)).not.toBeNull();
    await db.update(tenant).set({ status: 'suspended' }).where(eq(tenant.id, tenantB));
    expect(await verifyPublishableKey(db, created.key)).toBeNull();
  });
});
