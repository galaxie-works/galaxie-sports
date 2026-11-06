import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, runMigrations, type Database } from '../src/index.js';
import { asset, changeFeed, competition, logoUpload, participant, sport } from '../src/schema/index.js';
import {
  CrestTargetError,
  PANEL_ACERVO,
  panelCrestTargets,
  revertPanelCrest,
  setPanelCrest,
  type PanelCrestFile,
} from '../src/crests.js';

/**
 * Escudo de time/competição enviado no painel (Ajustes → Escudos): liga, guarda o anterior, volta e avisa a
 * API pelo change feed. Contra um Postgres descartável com as migrations reais. Nomes genéricos.
 */

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
let teamId: string;
let compId: string;
let acervoAssetId: string;
const ADMIN = 'admin@exemplo.test';

const file = (sha: string): PanelCrestFile => ({
  storageKey: `acervo/football/teams/x.${sha.slice(0, 12)}.svg`,
  sha256: sha,
  width: 100,
  height: 120,
  bytes: 1234,
  palette: { version: 1, dominant: '#0b6e2f', secondary: '#f2c200', monochrome: false },
  variants: {
    png: {
      storage_key: `acervo/football/teams/x.${sha.slice(0, 12)}.png`,
      sha256: sha,
      bytes: 9,
      width: 512,
      height: 512,
    },
  },
});
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const teamCrest = async () =>
  (
    await db.select({ id: participant.customLogoAssetId }).from(participant).where(eq(participant.id, teamId))
  )[0]!.id;

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 3 });
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  const [acervoAsset] = await db
    .insert(asset)
    .values({
      kind: 'team_logo',
      sourceUrl: 'acervo://galaxie-proprio/teams/br/time-exemplo.svg',
      storageKey: 'acervo/football/teams/t.000000000000.svg',
      origin: 'acervo',
      acervo: 'galaxie-proprio',
    })
    .returning({ id: asset.id });
  acervoAssetId = acervoAsset!.id;
  const [team] = await db
    .insert(participant)
    .values({ sport: 'football', kind: 'club', name: 'Time Exemplo', customLogoAssetId: acervoAssetId })
    .returning({ id: participant.id });
  teamId = team!.id;
  const [comp] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'liga-exemplo', name: 'Liga Exemplo', type: 'league' })
    .returning({ id: competition.id });
  compId = comp!.id;
}, 120_000);

afterAll(async () => {
  await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('escudo enviado no painel', () => {
  it('liga no time por cima do escudo do acervo, com origem acervo/painel, e avisa a API', async () => {
    const r = await setPanelCrest(db, { type: 'team', id: teamId }, file(SHA_A), ADMIN);
    expect(r.previousAssetId).toBe(acervoAssetId);
    expect(await teamCrest()).toBe(r.assetId);
    const [row] = await db.select().from(asset).where(eq(asset.id, r.assetId));
    expect(row).toMatchObject({ kind: 'team_logo', origin: 'acervo', acervo: PANEL_ACERVO, sha256: SHA_A });
    expect(row?.variants?.png?.width).toBe(512);
    expect(row!.palette?.dominant).toBe('#0b6e2f');
    const feed = await db
      .select()
      .from(changeFeed)
      .where(and(eq(changeFeed.entityType, 'participant'), eq(changeFeed.entityId, teamId)));
    expect(feed.length).toBeGreaterThan(0);
    expect(await panelCrestTargets(db, { team: [teamId], competition: [compId] })).toEqual(
      new Set([`team:${teamId}`]),
    );
  });

  it('segundo envio e Voltar duas vezes: volta ao do painel, depois ao do acervo', async () => {
    const first = await teamCrest();
    const second = await setPanelCrest(db, { type: 'team', id: teamId }, file(SHA_B), ADMIN);
    expect(second.previousAssetId).toBe(first);
    expect(await revertPanelCrest(db, { type: 'team', id: teamId }, ADMIN)).toBe(true);
    expect(await teamCrest()).toBe(first);
    expect(await revertPanelCrest(db, { type: 'team', id: teamId }, ADMIN)).toBe(true);
    expect(await teamCrest()).toBe(acervoAssetId);
    // nada mais a desfazer
    expect(await revertPanelCrest(db, { type: 'team', id: teamId }, ADMIN)).toBe(false);
    expect(await panelCrestTargets(db, { team: [teamId] })).toEqual(new Set());
    const uploads = await db.select().from(logoUpload).where(eq(logoUpload.targetId, teamId));
    expect(uploads.map((u) => u.targetType)).toEqual(['team', 'team']);
    expect(uploads.every((u) => u.revertedBy === ADMIN)).toBe(true);
  });

  it('mesmo arquivo de novo reaproveita o asset', async () => {
    const a = await setPanelCrest(db, { type: 'team', id: teamId }, file(SHA_A), ADMIN);
    const b = await setPanelCrest(db, { type: 'team', id: teamId }, file(SHA_A), ADMIN);
    expect(b.assetId).toBe(a.assetId);
  });

  it('Voltar não desfaz se o escudo mudou depois do envio', async () => {
    await setPanelCrest(db, { type: 'team', id: teamId }, file(SHA_B), ADMIN);
    await db.update(participant).set({ customLogoAssetId: acervoAssetId }).where(eq(participant.id, teamId));
    expect(await revertPanelCrest(db, { type: 'team', id: teamId }, ADMIN)).toBe(false);
    expect(await teamCrest()).toBe(acervoAssetId);
  });

  it('competição: liga e publica competition:<id>', async () => {
    const r = await setPanelCrest(db, { type: 'competition', id: compId }, file(SHA_A), ADMIN);
    const [row] = await db.select().from(asset).where(eq(asset.id, r.assetId));
    expect(row?.kind).toBe('league_logo');
    const feed = await db
      .select()
      .from(changeFeed)
      .where(and(eq(changeFeed.entityType, 'competition'), eq(changeFeed.entityId, compId)));
    expect(feed.length).toBe(1);
  });

  it('recusa alvo inexistente ou inválido', async () => {
    await expect(
      setPanelCrest(db, { type: 'team', id: '0190a1b2-0000-7000-8000-00000000dead' }, file(SHA_A), ADMIN),
    ).rejects.toBeInstanceOf(CrestTargetError);
    await expect(
      setPanelCrest(db, { type: 'platform' as never, id: teamId }, file(SHA_A), ADMIN),
    ).rejects.toBeInstanceOf(CrestTargetError);
  });
});
