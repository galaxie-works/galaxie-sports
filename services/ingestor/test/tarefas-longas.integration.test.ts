/**
 * Tarefas longas (#543) de ponta a ponta no Postgres: o `acervo.importar` em prévia e de verdade (cortado por um
 * "deploy" no meio, retomado do checkpoint e com o mesmo resultado de uma execução sem corte), a `carga.historica`
 * que volta à fila quando a cota do dia acaba, e o scheduler em QUEUE_MODE=enqueue.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { competition, country, jobRequest, jobRun, participant, sport, type Database } from '@galaxie/db';
import { takeNext } from '@galaxie/db/queue';
import { approvePreview, getTask, requestTask } from '@galaxie/db/queue-admin';
import { readPreview, readProgress, TASK_TYPES } from '@galaxie/db/queue-types';
import { enqueueJob, queueDedupeKey } from '@galaxie/scheduler';
import { importAcervo, loadCountries, loadTargets } from '../src/assets/acervo/import.js';
import { writeManifest, type AcervoManifest } from '../src/assets/acervo/manifest.js';
import { InMemoryPackageStore } from '../src/assets/acervo/pacote.js';
import { planManifest } from '../src/assets/acervo/plan.js';
import { scanAcervo } from '../src/assets/acervo/scan.js';
import { InMemoryObjectStore } from '../src/assets/object-store.js';
import { logger } from '../src/logger.js';
import { DEFAULT_JOBS } from '../src/scheduler/schedule.js';
import { acervoImportar, coverageKey } from '../src/tasks/acervo.js';
import { cargaHistorica, cargaLots, type CargaDeps } from '../src/tasks/carga.js';
import { runTask, type TaskHandler } from '../src/tasks/run.js';
import { disposableDb } from './db.js';
import { entriesOf, tgz } from './tgz.js';

const EXEMPLO = fileURLToPath(new URL('./fixtures/acervo-exemplo', import.meta.url));
const BUCKET = 'galaxie-teste';
const PACOTE = `s3://${BUCKET}/tasks/pacote-1/acervo-exemplo.tgz`;
const MANIFESTO = `s3://${BUCKET}/tasks/pacote-1/exemplo.yaml`;

const testDb = disposableDb();
let db: Database;
const work = mkdtempSync(join(tmpdir(), 'tarefas-longas-'));
const packages = new InMemoryPackageStore();
let manifest: AcervoManifest;

beforeAll(async () => {
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
  await db
    .insert(competition)
    .values({ sport: 'football', slug: 'serie-a-br', name: 'Serie A', countryCode: 'BR', type: 'league' });

  // o pacote e o manifesto (mapeado contra este banco) no "S3"
  const [targets, countries] = await Promise.all([loadTargets(db), loadCountries(db)]);
  manifest = planManifest(
    scanAcervo(EXEMPLO),
    targets,
    countries,
    undefined,
    new Date('2026-11-03T12:00:00Z'),
  ).manifest;
  const manifestFile = join(work, 'exemplo.yaml');
  writeManifest(manifestFile, manifest);
  packages.objects.set(MANIFESTO, new Uint8Array(readFileSync(manifestFile)));
  packages.objects.set(PACOTE, new Uint8Array(tgz(entriesOf(EXEMPLO, 'acervo-exemplo'))));
}, 60_000);
afterAll(async () => {
  await testDb.teardown();
  rmSync(work, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.delete(jobRequest);
  await db.delete(jobRun);
});

/** O que a importação deixou no banco: quem tem logo do acervo e qual (pelo arquivo do pacote). */
async function linked(): Promise<string[]> {
  const rows = await db.execute<{ name: string; source_url: string }>(sql`
    select p.name, a.source_url from core.participant p join core.asset a on a.id = p.custom_logo_asset_id
    union all
    select c.name, a.source_url from core.competition c join core.asset a on a.id = c.custom_logo_asset_id
    order by 1`);
  return rows.map((r) => `${r.name} → ${r.source_url}`);
}

describe('acervo.importar', () => {
  it('prévia → aprovação → execução cortada por um deploy, que retoma do checkpoint e termina igual', async () => {
    const objects = new InMemoryObjectStore();
    const handler = acervoImportar({
      packages: () => packages,
      objects: () => objects,
      manifestDir: join(work, 'nao-usado'),
      bucket: () => BUCKET,
    });
    const handlers: Record<string, TaskHandler> = { 'acervo.importar': handler };
    const params = { pacote: PACOTE, acervo: 'exemplo', manifesto: MANIFESTO, lote: 10 };

    // destrutiva: só entra em prévia
    await expect(requestTask(db, { type: 'acervo.importar', params, requestedBy: 'ana' })).rejects.toThrow(
      /prévia/,
    );
    const { id: previewId } = await requestTask(db, {
      type: 'acervo.importar',
      params,
      previa: true,
      requestedBy: 'ana',
    });
    const preview = await takeNext(db, 'worker-1', ['acervo.importar']);
    expect(await runTask(db, preview!, { handlers })).toBe('done');
    const plan = readPreview((await getTask(db, previewId)).checkpoint);
    expect(plan?.contagens).toMatchObject({ ligados: 7, desligados: 0, ignorados: 0, lotes: 4 });
    expect(plan?.resumo).toContain(`s3://${BUCKET}/${coverageKey(previewId)}`);
    expect(
      new TextDecoder().decode(packages.objects.get(`s3://${BUCKET}/${coverageKey(previewId)}`)),
    ).toMatch(/Cobertura|cobertura/);
    // a prévia não grava nada
    expect(objects.objects.size).toBe(0);
    expect(await linked()).toEqual([]);

    // aprovação; o "deploy" chega depois do primeiro lote (AR): a tomada para entre lotes e devolve a tarefa
    const { id: realId } = await approvePreview(db, previewId, 'bia');
    const stop = new AbortController();
    const first = await takeNext(db, 'worker-1', ['acervo.importar']);
    expect(first!.id).toBe(realId);
    const put = objects.put.bind(objects);
    objects.put = async (...args) => {
      stop.abort(); // SIGTERM durante o primeiro lote
      return put(...args);
    };
    expect(await runTask(db, first!, { handlers, signal: stop.signal })).toBe('released');
    objects.put = put;
    const cut = await getTask(db, realId);
    expect(cut.status).toBe('pending');
    expect(cut.attempts).toBe(0); // o deploy não gasta tentativa
    expect(readProgress(cut.checkpoint)).toMatchObject({ feitos: 1, total: 4 });
    expect((await linked()).length).toBeGreaterThan(0);

    // outro worker retoma do checkpoint e termina
    const second = await takeNext(db, 'worker-2', ['acervo.importar']);
    expect(second!.resumedFrom).not.toBeNull();
    expect(await runTask(db, second!, { handlers })).toBe('done');
    const done = await getTask(db, realId);
    expect(done.status).toBe('done');
    expect(done.runs.map((r) => r.status)).toEqual(['interrupted', 'ok']);
    expect(readProgress(done.checkpoint)).toMatchObject({ feitos: 4, total: 4 });
    const afterCut = await linked();
    expect(afterCut).toHaveLength(7);

    // o mesmo resultado de uma execução sem corte, e rodar de novo não muda nada
    const again = await importAcervo({ db, objects, manifest, dir: EXEMPLO });
    expect(again).toMatchObject({ linked: 7, uploaded: 0, changed: 0, detached: 0 });
    expect(await linked()).toEqual(afterCut);
  });
});

describe('acervo.importar: a aprovação vale para o que a prévia viu', () => {
  it('manifesto trocado no S3 depois da prévia: a execução aprovada é recusada na hora, sem nova tentativa', async () => {
    const objects = new InMemoryObjectStore();
    const handlers: Record<string, TaskHandler> = {
      'acervo.importar': acervoImportar({
        packages: () => packages,
        objects: () => objects,
        manifestDir: join(work, 'nao-usado'),
        bucket: () => BUCKET,
      }),
    };
    const params = { pacote: PACOTE, acervo: 'exemplo', manifesto: MANIFESTO, lote: 10 };
    const { id: previewId } = await requestTask(db, {
      type: 'acervo.importar',
      params,
      previa: true,
      requestedBy: 'ana',
    });
    expect(await runTask(db, (await takeNext(db, 'w', ['acervo.importar']))!, { handlers })).toBe('done');
    const original = packages.objects.get(MANIFESTO)!;
    packages.objects.set(
      MANIFESTO,
      new Uint8Array([...original, ...new TextEncoder().encode('# trocado' + String.fromCharCode(10))]),
    );
    try {
      const { id: realId } = await approvePreview(db, previewId, 'bia');
      expect(await runTask(db, (await takeNext(db, 'w', ['acervo.importar']))!, { handlers })).toBe('error');
      const real = await getTask(db, realId);
      expect(real.status).toBe('error');
      expect(real.lastError).toMatch(/manifesto mudou depois da prévia/);
      expect(objects.objects.size).toBe(0);
    } finally {
      packages.objects.set(MANIFESTO, original);
    }
  });
});

describe('carga.historica com provedor falso', () => {
  it('cota esgotada: finish com runAfter no próximo dia de cota, sem falhar nem gastar tentativa', async () => {
    const lots = cargaLots({ etapas: ['temporadas', 'pessoas'] }, [71]);
    let calls = 0;
    const deps = (): CargaDeps => ({
      lots: async () => lots,
      plan: async () => ({ rede: 1, cache: 0, feitos: 0 }),
      run: async () =>
        ++calls === 2
          ? { status: 'cota', chamadas: 3, pendentes: 10 }
          : { status: 'ok', chamadas: 5, pendentes: 0 },
      prepareDay: async () => {},
      close: async () => {},
    });
    // data longe no futuro: o takeNext abaixo compara o runAfter com o relógio real (com 2026 fixo, o teste quebrou em 04/11/2026 00:30 UTC)
    const now = new Date('2099-11-03T18:00:00Z');
    const handlers = { 'carga.historica': cargaHistorica(deps, () => now) };
    const { id } = await requestTask(db, {
      type: 'carga.historica',
      params: { etapas: ['temporadas', 'pessoas'], ligas: [71] },
      requestedBy: 'ana',
    });
    const task = await takeNext(db, 'worker-1', ['carga.historica']);
    expect(await runTask(db, task!, { handlers })).toBe('deferred');
    const row = await getTask(db, id);
    expect(row.status).toBe('pending');
    expect(row.runAfter).toEqual(new Date('2099-11-04T00:30:00Z'));
    expect(row.attempts).toBe(0);
    expect(row.lastError).toBeNull();
    expect(row.runs.map((r) => r.status)).toEqual(['ok']);
    expect(row.checkpoint).toMatchObject({ concluidos: ['temporadas:71'], totais: { chamadas: 8 } });
    // antes do dia de cota, nenhum worker pega
    expect(await takeNext(db, 'worker-1', ['carga.historica'])).toBeNull();

    // no dia seguinte, retoma do lote que parou
    await db
      .update(jobRequest)
      .set({ runAfter: sql`now()` })
      .where(eq(jobRequest.id, id));
    const next = await takeNext(db, 'worker-1', ['carga.historica']);
    expect(await runTask(db, next!, { handlers })).toBe('done');
    expect((await getTask(db, id)).checkpoint).toMatchObject({
      concluidos: ['temporadas:71', 'pessoas'],
      totais: { chamadas: 13 },
    });
  });
});

describe('QUEUE_MODE=enqueue no scheduler', () => {
  const mirror = DEFAULT_JOBS.find((j) => j.name === 'assets-mirror')!;

  it('o horário só enfileira a tarefa, uma por job e dia, com os padrões do tipo', async () => {
    const now = new Date('2026-11-03T01:30:00Z');
    const a = await enqueueJob(db, mirror, { trigger: 'schedule', logger, now });
    const b = await enqueueJob(db, mirror, { trigger: 'catchup', logger, now });
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    const rows = await db.select().from(jobRequest);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'assets.espelhar',
      dedupeKey: queueDedupeKey(mirror, now),
      requestedBy: 'scheduler:assets-mirror',
      maxAttempts: 5,
      params: { descobrirRaw: true, limite: 2000, lote: 200, retentarAusentes: false, concorrencia: 3 },
    });
    expect(queueDedupeKey(mirror, now)).toBe('assets-mirror:2026-11-03');
  });

  it('tipo destrutivo ou params inválidos não entram na fila', async () => {
    const r1 = await enqueueJob(
      db,
      { ...mirror, task: { type: 'acervo.importar', params: {} } },
      { trigger: 'schedule', logger, registry: TASK_TYPES },
    );
    const r2 = await enqueueJob(
      db,
      { ...mirror, task: { type: 'assets.espelhar', params: { limite: -1 } } },
      { trigger: 'schedule', logger },
    );
    expect([r1.status, r2.status]).toEqual(['error', 'error']);
    expect(await db.select().from(jobRequest)).toHaveLength(0);
  });
});
