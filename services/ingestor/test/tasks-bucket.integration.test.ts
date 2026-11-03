/**
 * Bucket privado das tarefas (#587) contra o RustFS de verdade (S3_ENDPOINT do .env; pulado sem ele): um bucket
 * descartável criado como o s3-init cria o `galaxie-sports-tasks` (sem política), a leitura anônima recusada (403) no
 * pacote, na listagem e no relatório da prévia, e o `acervo.importar` lendo o pacote e o manifesto de lá, de ponta a ponta
 * na fila (prévia → aprovação → execução). Confere também que o bucket de assets (S3_BUCKET) não lista anonimamente.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetBucketPolicyCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { competition, country, participant, sport, type Database } from '@galaxie/db';
import { takeNext } from '@galaxie/db/queue';
import { approvePreview, getTask, requestTask } from '@galaxie/db/queue-admin';
import { readPreview } from '@galaxie/db/queue-types';
import { loadCountries, loadTargets } from '../src/assets/acervo/import.js';
import { writeManifest } from '../src/assets/acervo/manifest.js';
import {
  openPackage,
  publicBucketWarning,
  S3PackageStore,
  tasksBucket,
  type S3Uri,
} from '../src/assets/acervo/pacote.js';
import { planManifest } from '../src/assets/acervo/plan.js';
import { scanAcervo } from '../src/assets/acervo/scan.js';
import { InMemoryObjectStore } from '../src/assets/object-store.js';
import { acervoImportar, coverageKey } from '../src/tasks/acervo.js';
import { runTask, type TaskHandler } from '../src/tasks/run.js';
import { disposableDb } from './db.js';
import { entriesOf, tgz } from './tgz.js';

const { S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET } = process.env;
const EXEMPLO = fileURLToPath(new URL('./fixtures/acervo-exemplo', import.meta.url));

describe.skipIf(!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY)(
  'bucket privado das tarefas (RustFS)',
  () => {
    // bucket descartável no lugar do galaxie-sports-tasks: o nome passa por S3_TASKS_BUCKET, como em produção
    const BUCKET = `gs-tasks-test-${randomBytes(4).toString('hex')}`;
    const ID = randomBytes(8).toString('hex');
    const PACOTE: S3Uri = { bucket: BUCKET, key: `tasks/${ID}/acervo-exemplo.tgz` };
    const MANIFESTO: S3Uri = { bucket: BUCKET, key: `tasks/${ID}/exemplo.yaml` };
    const env = { ...process.env, S3_TASKS_BUCKET: BUCKET };
    // criados no beforeAll: o corpo do describe roda na coleta mesmo quando ele é pulado (CI sem S3)
    let s3: S3Client;
    let packages: S3PackageStore;
    let testDb: ReturnType<typeof disposableDb>;
    let work: string;
    let db: Database;

    /** GET anônimo (sem assinatura) direto no RustFS, como o `curl` do critério de aceite. */
    const anonymous = (path: string) => fetch(`${S3_ENDPOINT!.replace(/\/$/, '')}/${path}`);

    beforeAll(async () => {
      s3 = new S3Client({
        endpoint: S3_ENDPOINT!,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: S3_ACCESS_KEY!, secretAccessKey: S3_SECRET_KEY! },
      });
      packages = S3PackageStore.fromEnv(env);
      testDb = disposableDb();
      work = mkdtempSync(join(tmpdir(), 'tasks-bucket-'));
      // como o s3-init: cria e não põe política nenhuma
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      db = await testDb.setup();
      await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol' } });
      await db.insert(country).values([
        { code: 'BR', name: { en: 'Brazil', 'pt-BR': 'Brasil' } },
        { code: 'AR', name: { en: 'Argentina' } },
        { code: 'MX', name: { en: 'Mexico', 'pt-BR': 'México' } },
        { code: 'ES', name: { en: 'Spain', 'pt-BR': 'Espanha' } },
      ]);
      for (const [name, countryCode] of [
        ['Palmeiras', 'BR'],
        ['Palmeiras U20', 'BR'],
        ['Flamengo', 'BR'],
        ['America Mineiro', 'BR'],
        ['America RN', 'BR'],
        ['Boca Juniors', 'AR'],
        ['River Plate', 'AR'],
        ['Club America', 'MX'],
        ['Real Madrid', 'ES'],
      ] as const)
        await db.insert(participant).values({ sport: 'football', kind: 'club', name, countryCode });
      await db.insert(competition).values({
        sport: 'football',
        slug: 'serie-a-br',
        name: 'Serie A',
        countryCode: 'BR',
        type: 'league',
      });

      // o pacote e o manifesto (mapeado contra este banco) sobem para tasks/<id>/ do bucket privado
      const [targets, countries] = await Promise.all([loadTargets(db), loadCountries(db)]);
      const manifest = planManifest(
        scanAcervo(EXEMPLO),
        targets,
        countries,
        undefined,
        new Date('2026-11-03T12:00:00Z'),
      ).manifest;
      const manifestFile = join(work, 'exemplo.yaml');
      writeManifest(manifestFile, manifest);
      await packages.upload(PACOTE, tgz(entriesOf(EXEMPLO, 'acervo-exemplo')), 'application/gzip');
      await packages.upload(MANIFESTO, readFileSync(manifestFile), 'application/yaml');
    }, 60_000);

    afterAll(async () => {
      try {
        const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET }));
        const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key! }));
        if (keys.length)
          await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys } }));
        await s3.send(new DeleteBucketCommand({ Bucket: BUCKET }));
      } finally {
        s3?.destroy();
        packages?.close();
        await testDb?.teardown();
        if (work) rmSync(work, { recursive: true, force: true });
      }
    });

    it('GET anônimo de um objeto em tasks/ do bucket privado devolve 403; listar também', async () => {
      expect(await packages.exists(PACOTE)).toBe(true); // com a chave, o objeto está lá
      const object = await anonymous(`${BUCKET}/${PACOTE.key}`);
      expect(object.status).toBe(403);
      await object.arrayBuffer();
      const listing = await anonymous(`${BUCKET}/?list-type=2&prefix=tasks/`);
      expect(listing.status).toBe(403);
      await listing.arrayBuffer();
    });

    it.skipIf(!S3_BUCKET)(
      'o bucket de assets só libera GetObject: listar anonimamente devolve 403',
      async () => {
        const listing = await anonymous(`${S3_BUCKET}/?list-type=2&prefix=tasks/`);
        expect(listing.status).toBe(403);
        await listing.arrayBuffer();
        const policy = await s3.send(new GetBucketPolicyCommand({ Bucket: S3_BUCKET }));
        const statements = (
          JSON.parse(policy.Policy ?? '{}') as { Statement?: { Action?: string | string[] }[] }
        ).Statement;
        const actions = (statements ?? []).flatMap((st) => [st.Action ?? []].flat());
        expect(actions).toEqual(['s3:GetObject']);
      },
    );

    it('o CLI abre o pacote do bucket privado (s3://) com a chave do RustFS, sem aviso', async () => {
      expect(tasksBucket(env)).toBe(BUCKET);
      expect(publicBucketWarning(PACOTE, env)).toBeUndefined();
      const pkg = await openPackage(`s3://${BUCKET}/${PACOTE.key}`, () => packages);
      try {
        expect(scanAcervo(pkg.dir).info.id).toBe('exemplo');
        expect(pkg.sha256).toMatch(/^[0-9a-f]{64}$/);
      } finally {
        pkg.cleanup();
      }
    });

    it('acervo.importar pela fila: prévia com o relatório no bucket privado, aprovação e importação', async () => {
      const objects = new InMemoryObjectStore();
      const handlers: Record<string, TaskHandler> = {
        'acervo.importar': acervoImportar({
          packages: () => packages,
          objects: () => objects,
          manifestDir: join(work, 'nao-usado'),
          bucket: () => tasksBucket(env),
          publicWarning: (uri) => publicBucketWarning(uri, env),
        }),
      };
      const params = {
        pacote: `s3://${BUCKET}/${PACOTE.key}`,
        acervo: 'exemplo',
        manifesto: `s3://${BUCKET}/${MANIFESTO.key}`,
        lote: 10,
      };
      const { id: previewId } = await requestTask(db, {
        type: 'acervo.importar',
        params,
        previa: true,
        requestedBy: 'teste',
      });
      expect(await runTask(db, (await takeNext(db, 'w', ['acervo.importar']))!, { handlers })).toBe('done');
      const plan = readPreview((await getTask(db, previewId)).checkpoint);
      expect(plan?.contagens).toMatchObject({ ligados: 7, lotes: 4 });
      const report: S3Uri = { bucket: BUCKET, key: coverageKey(previewId) };
      expect(plan?.resumo).toContain(`s3://${BUCKET}/${report.key}`);
      expect(await packages.exists(report)).toBe(true);
      const anon = await anonymous(`${BUCKET}/${report.key}`);
      expect(anon.status).toBe(403);
      await anon.arrayBuffer();

      const { id: realId } = await approvePreview(db, previewId, 'aprovador');
      expect(await runTask(db, (await takeNext(db, 'w', ['acervo.importar']))!, { handlers })).toBe('done');
      expect((await getTask(db, realId)).status).toBe('done');
      const linked = await db.execute<{ n: number }>(sql`
      select (select count(*) from core.participant where custom_logo_asset_id is not null)
           + (select count(*) from core.competition where custom_logo_asset_id is not null) as n`);
      expect(Number(linked[0]!.n)).toBe(7);
      expect(objects.objects.size).toBeGreaterThan(0);
    });
  },
);
