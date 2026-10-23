import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asset, competition, country, participant, sport, type Database } from '@galaxie/db';
import {
  acervoStorageKey,
  detachAcervo,
  importAcervo,
  loadCountries,
  loadTargets,
} from '../src/assets/acervo/import.js';
import type { AcervoManifest } from '../src/assets/acervo/manifest.js';
import { planManifest } from '../src/assets/acervo/plan.js';
import { scanAcervo } from '../src/assets/acervo/scan.js';
import { InMemoryObjectStore } from '../src/assets/object-store.js';
import { disposableDb } from './db.js';

const EXEMPLO = fileURLToPath(new URL('./fixtures/acervo-exemplo', import.meta.url));
const PALMEIRAS_LOGO = 'https://media.api-sports.io/football/teams/121.png';

const testDb = disposableDb();
let db: Database;
const ids = new Map<string, string>();
let providerLogoId: string;

beforeAll(async () => {
  db = await testDb.setup();
  await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
  await db.insert(country).values([
    { code: 'BR', name: { en: 'Brazil', 'pt-BR': 'Brasil' } },
    { code: 'AR', name: { en: 'Argentina' } },
    { code: 'MX', name: { en: 'Mexico', 'pt-BR': 'México' } },
    { code: 'ES', name: { en: 'Spain', 'pt-BR': 'Espanha' } },
  ]);
  const [logo] = await db
    .insert(asset)
    .values({ kind: 'team_logo', sourceUrl: PALMEIRAS_LOGO, storageKey: 'football/teams/121.png' })
    .returning({ id: asset.id });
  providerLogoId = logo!.id;
  const teams: [string, string, string][] = [
    ['Palmeiras', 'BR', 'club'],
    ['Palmeiras U20', 'BR', 'club'],
    ['Flamengo', 'BR', 'club'],
    ['America Mineiro', 'BR', 'club'],
    ['America RN', 'BR', 'club'],
    ['Boca Juniors', 'AR', 'club'],
    ['River Plate', 'AR', 'club'],
    ['Club America', 'MX', 'club'],
    ['Real Madrid', 'ES', 'club'],
  ];
  for (const [name, countryCode] of teams) {
    const [p] = await db
      .insert(participant)
      .values({
        sport: 'football',
        kind: 'club',
        name,
        countryCode,
        ...(name === 'Palmeiras' ? { logoAssetId: providerLogoId } : {}),
      })
      .returning({ id: participant.id });
    ids.set(name, p!.id);
  }
  const [serieA] = await db
    .insert(competition)
    .values({ sport: 'football', slug: 'serie-a-br', name: 'Serie A', countryCode: 'BR', type: 'league' })
    .returning({ id: competition.id });
  ids.set('Serie A', serieA!.id);
}, 60_000);
afterAll(() => testDb.teardown());

async function manifestFor(previous?: AcervoManifest): Promise<AcervoManifest> {
  const [targets, countries] = await Promise.all([loadTargets(db), loadCountries(db)]);
  return planManifest(scanAcervo(EXEMPLO), targets, countries, previous, new Date('2026-10-23T12:00:00Z'))
    .manifest;
}

const customLogo = async (name: string) =>
  (
    await db
      .select({ custom: participant.customLogoAssetId, provider: participant.logoAssetId })
      .from(participant)
      .where(eq(participant.id, ids.get(name)!))
  )[0]!;

describe('assets:acervo (importação idempotente)', () => {
  const objects = new InMemoryObjectStore();
  let manifest: AcervoManifest;

  it('mapeia pelo banco: 7 ligados, o América brasileiro ambíguo, o fictício sem par', async () => {
    manifest = await manifestFor();
    const by = (key: string) => manifest.logos.find((l) => l.key === key)!;
    expect(by('teams/br/palmeiras').target_id).toBe(ids.get('Palmeiras'));
    expect(by('teams/mx/america').target_id).toBe(ids.get('Club America'));
    expect(by('competitions/br/serie-a').target_id).toBe(ids.get('Serie A'));
    expect(by('teams/br/america').match).toBe('ambiguous');
    expect(by('teams/br/clube-ficticio').match).toBe('unmatched');
    expect(manifest.logos.filter((l) => l.match === 'auto')).toHaveLength(7);
  });

  it('a prévia não grava nada', async () => {
    const report = await importAcervo({ db, objects, manifest, dir: EXEMPLO, dryRun: true });
    expect(report).toMatchObject({ linked: 7, uploaded: 0, changed: 0, detached: 0 });
    expect(objects.objects.size).toBe(0);
    expect((await customLogo('Palmeiras')).custom).toBeNull();
  });

  it('espelha, grava a origem e a paleta e liga sem tocar no logo do fornecedor', async () => {
    const report = await importAcervo({ db, objects, manifest, dir: EXEMPLO, batchSize: 3 });
    expect(report).toMatchObject({ linked: 7, uploaded: 7, changed: 7, detached: 0, skipped: 0 });
    const palSha = manifest.logos.find((l) => l.key === 'teams/br/palmeiras')!.sha256;
    const palKey = `acervo/football/teams/${ids.get('Palmeiras')}.${palSha.slice(0, 12)}.svg`;
    expect(acervoStorageKey('team', ids.get('Palmeiras')!, palSha, 'image/svg+xml')).toBe(palKey);
    expect(objects.objects.get(palKey)?.contentType).toBe('image/svg+xml');
    // o nome publicado é só nosso: nem o id do acervo nem o nome do arquivo do pacote
    for (const key of objects.objects.keys()) {
      expect(key).toMatch(/^acervo\/football\/(teams|leagues)\/[0-9a-f-]{36}\.[0-9a-f]{12}\.svg$/);
      expect(key).not.toMatch(/exemplo|palmeiras|serie-a/);
    }

    const pal = await customLogo('Palmeiras');
    expect(pal.provider).toBe(providerLogoId);
    const [row] = await db.select().from(asset).where(eq(asset.id, pal.custom!));
    expect(row).toMatchObject({
      kind: 'team_logo',
      origin: 'acervo',
      acervo: 'exemplo',
      sourceUrl: 'acervo://exemplo/teams/br/palmeiras.svg',
      storageKey: palKey,
      width: 512,
      height: 512,
    });
    expect(row!.palette).toMatchObject({ dominant: '#0b6e3a', monochrome: false });
    const [provider] = await db
      .select({ origin: asset.origin })
      .from(asset)
      .where(eq(asset.id, providerLogoId));
    expect(provider!.origin).toBe('provider');

    const [serieA] = await db
      .select({ custom: competition.customLogoAssetId, kind: asset.kind })
      .from(competition)
      .innerJoin(asset, eq(asset.id, competition.customLogoAssetId))
      .where(eq(competition.id, ids.get('Serie A')!));
    expect(serieA!.kind).toBe('league_logo');
    expect((await customLogo('Palmeiras U20')).custom).toBeNull();
  });

  it('rodar de novo não regrava nada', async () => {
    const before = await db.select({ id: asset.id, createdAt: asset.createdAt }).from(asset);
    const report = await importAcervo({ db, objects, manifest, dir: EXEMPLO });
    expect(report).toMatchObject({ linked: 7, uploaded: 0, changed: 0, detached: 0 });
    expect(await db.select({ id: asset.id, createdAt: asset.createdAt }).from(asset)).toEqual(before);
  });

  it('logo que sai do manifesto desliga o time, mas o asset fica', async () => {
    const pal = manifest.logos.find((l) => l.key === 'teams/br/palmeiras')!;
    const assetId = (await customLogo('Palmeiras')).custom!;
    pal.match = 'rejected';
    pal.target_id = null;
    // curadoria do ambíguo: o América do manifesto é o Mineiro
    const ame = manifest.logos.find((l) => l.key === 'teams/br/america')!;
    ame.match = 'manual';
    ame.target_id = ids.get('America Mineiro')!;
    const remapped = await manifestFor(manifest);
    expect(remapped.logos.find((l) => l.key === 'teams/br/america')).toMatchObject({ match: 'manual' });

    const report = await importAcervo({ db, objects, manifest: remapped, dir: EXEMPLO });
    expect(report).toMatchObject({ linked: 7, uploaded: 1, changed: 1, detached: 1 });
    expect(await customLogo('Palmeiras')).toMatchObject({ custom: null, provider: providerLogoId });
    expect((await customLogo('America Mineiro')).custom).not.toBeNull();
    expect(await db.select({ id: asset.id }).from(asset).where(eq(asset.id, assetId))).toHaveLength(1);
  });

  it('arquivo divergente do manifesto é ignorado', async () => {
    const tampered = structuredClone(manifest);
    tampered.logos.find((l) => l.key === 'teams/ar/boca-juniors')!.sha256 = 'outro';
    const report = await importAcervo({ db, objects, manifest: tampered, dir: EXEMPLO });
    expect(report).toMatchObject({ skipped: 1, detached: 0 });
    expect((await customLogo('Boca Juniors')).custom).not.toBeNull();
  });

  it('desvincular o acervo devolve todos ao logo do fornecedor', async () => {
    expect(await detachAcervo(db, 'exemplo', true)).toBe(7);
    expect(await detachAcervo(db, 'exemplo')).toBe(7);
    const linked = await db
      .select({ id: participant.id })
      .from(participant)
      .where(eq(participant.sport, 'football'));
    for (const p of linked)
      expect(
        (
          await db
            .select({ c: participant.customLogoAssetId })
            .from(participant)
            .where(eq(participant.id, p.id))
        )[0]!.c,
      ).toBeNull();
    expect((await db.select({ id: asset.id }).from(asset).where(eq(asset.acervo, 'exemplo'))).length).toBe(8);
  });
});
