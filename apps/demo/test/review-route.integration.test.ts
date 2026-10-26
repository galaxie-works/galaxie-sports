import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, createDb, runMigrations } from '@galaxie/db';
import { loadKnowledge, seedSemantic } from '@galaxie/knowledge';

/*
 * Rotas da revisão semântica (Ajustes → Revisão) contra um Postgres descartável com a base real
 * (migrations + seed de data/knowledge). A sessão é simulada; o resto (SQL, auditoria, status nas
 * tabelas da API e change feed) é o de verdade.
 */

const session = vi.hoisted(() => ({
  current: null as null | { user: { id: string; email: string; role: string } },
}));
vi.mock('@/lib/auth/server', () => ({ auth: { api: { getSession: async () => session.current } } }));
// o cache da demo: a rota revalida as tags da mudança na hora (fora de uma requisição do Next, só registra)
const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: cache.revalidateTag }));

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração.');
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

const ADMIN = { id: 'u-admin', email: 'teste.admin@galaxie.test', role: 'admin' };

let sql: Client;
let list: typeof import('../src/app/api/ajustes/revisao/route');
let item: typeof import('../src/app/api/ajustes/revisao/[id]/route');

beforeAll(async () => {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();
  await runMigrations(testUrl);
  const db = createDb(testUrl, { max: 2 });
  await seedSemantic(db, await loadKnowledge());
  await closeDb(db);
  sql = new Client({ connectionString: testUrl });
  await sql.connect();
  // o pool da demo lê a URL ao ser importado
  process.env.DEMO_DATABASE_URL = testUrl;
  list = await import('../src/app/api/ajustes/revisao/route');
  item = await import('../src/app/api/ajustes/revisao/[id]/route');
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

const ctx = (id: string) => ({ params: Promise.resolve({ id: encodeURIComponent(id) }) });
const getList = (query: string) => list.GET(new Request(`http://demo.test/api/ajustes/revisao${query}`));
const getItem = (id: string) => item.GET(new Request('http://demo.test/x'), ctx(id));
const post = (id: string, body: unknown) =>
  item.POST(new Request('http://demo.test/x', { method: 'POST', body: JSON.stringify(body) }), ctx(id));

const teamStatus = async (slug: string) =>
  (await sql.query('select review_status, texts from semantic.team_profile where slug = $1', [slug])).rows[0];

describe('acesso', () => {
  it('sem sessão → 401; sessão sem admin → 403', async () => {
    session.current = null;
    expect((await getList('')).status).toBe(401);
    session.current = { user: { ...ADMIN, role: 'user' } };
    expect((await getList('')).status).toBe(403);
    expect((await post('team:palmeiras', { action: 'approve' })).status).toBe(403);
  });
});

describe('revisão de um perfil', () => {
  beforeAll(() => {
    session.current = { user: ADMIN };
  });

  it('voltar para rascunho e filtrar os rascunhos do mercado, com contagens por status', async () => {
    const res = await post('team:palmeiras', { action: 'draft', comment: 'conferir fontes' });
    expect(res.status).toBe(200);
    expect((await teamStatus('palmeiras')).review_status).toBe('draft');

    const body = await (await getList('?tipo=team&mercado=BR&status=draft&esporte=football')).json();
    const items = body.data.items as { id: string; kind: string; market: string }[];
    expect(items.map((i) => i.id)).toContain('team:palmeiras');
    expect(items.every((i) => i.kind === 'team' && i.market === 'BR')).toBe(true);
    expect(body.data.counts.draft).toBeGreaterThan(0);
    expect(body.data.options.sports).toContain('football');
  });

  it('aprovar: status servido na hora, auditoria e aviso no change feed para purgar o cache', async () => {
    cache.revalidateTag.mockClear();
    const res = await post('team:palmeiras', { action: 'approve' });
    expect(await res.json()).toEqual({ data: { state: 'approved', unchanged: false } });
    expect((await teamStatus('palmeiras')).review_status).toBe('approved');

    const decision = (
      await sql.query(`select * from semantic.review_decision where item_id = 'team:palmeiras'`)
    ).rows[0];
    const catalog = (
      await sql.query(`select review_hash from semantic.review_item where id = 'team:palmeiras'`)
    ).rows[0];
    expect(decision).toMatchObject({ status: 'approved', decided_by: ADMIN.email, decided_by_id: ADMIN.id });
    expect(decision.review_hash).toBe(catalog.review_hash);

    const log = (
      await sql.query(
        `select action, from_status, to_status::text, actor from semantic.review_log
          where item_id = 'team:palmeiras' order by created_at`,
      )
    ).rows;
    expect(log.at(-1)).toEqual({
      action: 'approve',
      from_status: 'draft',
      to_status: 'approved',
      actor: ADMIN.email,
    });

    const change = await sql.query(
      `select topic, entity_type, entity_id from ops.change_feed
        where entity_type = 'team_profile' and entity_id = 'palmeiras'`,
    );
    expect(change.rows).toContainEqual({
      topic: 'semantic.review',
      entity_type: 'team_profile',
      entity_id: 'palmeiras',
    });
    // o cache da demo expira na hora com as mesmas tags que a API purga
    expect(cache.revalidateTag.mock.calls).toEqual([
      ['team_profile:palmeiras', { expire: 0 }],
      ['team_profile', { expire: 0 }],
    ]);

    // aprovar de novo não grava nada (nem revalida)
    cache.revalidateTag.mockClear();
    expect(await (await post('team:palmeiras', { action: 'approve' })).json()).toEqual({
      data: { state: 'approved', unchanged: true },
    });
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });

  it('sugerir edição exige comentário e só aceita campos do item', async () => {
    let res = await post('team:palmeiras', { action: 'suggest', comment: '  ' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'comment_required' });
    res = await post('team:palmeiras', { action: 'suggest', comment: 'x', fields: { campo_inexistente: 1 } });
    expect(await res.json()).toEqual({ code: 'invalid_fields' });
    res = await post('team:palmeiras', { action: 'publicar' });
    expect(await res.json()).toEqual({ code: 'invalid_action' });
  });

  it('sugestão guardada: item fica "precisa de revisão", sai da API e aparece no detalhe com histórico', async () => {
    const fields = { nicknames: ['Verdão', 'Porco', 'Palestra', 'Alviverde'] };
    const res = await post('team:palmeiras', { action: 'suggest', comment: 'Falta Alviverde.', fields });
    expect(await res.json()).toEqual({ data: { state: 'needs_review', unchanged: false } });
    expect((await teamStatus('palmeiras')).review_status).toBe('draft');

    const detail = (await (await getItem('team:palmeiras')).json()).data;
    expect(detail).toMatchObject({
      state: 'needs_review',
      suggestion: { comment: 'Falta Alviverde.', fields },
      sourceFile: 'data/knowledge/football/teams/br.yaml',
      preview: { endpoint: 'GET /v1/teams/palmeiras/semantic' },
    });
    expect(detail.preview.body.nicknames.length).toBeGreaterThan(0);
    // o "voltar para rascunho" do começo só entra no histórico se o YAML não dizia draft
    expect(detail.log.map((l: { action: string }) => l.action).slice(0, 2)).toEqual(['suggest', 'approve']);
    expect(detail.log[0]).toMatchObject({
      comment: 'Falta Alviverde.',
      proposed: fields,
      actor: ADMIN.email,
    });

    const body = await (await getList('?status=needs_review')).json();
    expect(body.data.items.map((i: { id: string }) => i.id)).toEqual(['team:palmeiras']);
    expect(body.data.counts.needs_review).toBe(1);
  });
});

describe('veredito e edição da IA (job review-suggestions)', () => {
  const verdict = {
    outcome: 'rejected',
    reason: 'Alviverde já aparece como cor, não como apelido.',
    fields: null,
    adjustments: [],
    validation: [],
    by: 'gemini',
    model: 'gemini-3.8-flash',
    at: '2026-10-24T12:00:00.000Z',
  };

  it('recusa da IA: o motivo aparece na lista e no detalhe; o item segue "precisa de revisão"', async () => {
    await sql.query(`update semantic.review_decision set ai_verdict = $1 where item_id = 'team:palmeiras'`, [
      verdict,
    ]);
    const body = await (await getList('?status=needs_review')).json();
    expect(body.data.items[0]).toMatchObject({
      id: 'team:palmeiras',
      state: 'needs_review',
      openSuggestion: 'Falta Alviverde.',
      aiRejection: verdict.reason,
      edited: false,
    });
    const detail = (await (await getItem('team:palmeiras')).json()).data;
    expect(detail.aiVerdict).toEqual(verdict);
  });

  it('uma sugestão nova apaga o veredito (a IA avalia de novo)', async () => {
    await post('team:palmeiras', { action: 'suggest', comment: 'Conferir os apelidos de novo.' });
    const row = (
      await sql.query(`select ai_verdict from semantic.review_decision where item_id = 'team:palmeiras'`)
    ).rows[0];
    expect(row.ai_verdict).toBeNull();
    expect((await (await getItem('team:palmeiras')).json()).data.aiVerdict).toBeNull();
  });

  it('edição em vigor no banco: marcada na lista e mostrada campo a campo no detalhe', async () => {
    const { rows } = await sql.query(
      `select review_hash, content from semantic.review_item where id = 'glossary:pt-BR.torcedor'`,
    );
    const { review_hash: hash, content } = rows[0] as { review_hash: string; content: { example: string } };
    await sql.query(
      `insert into semantic.review_override (item_id, fields, base, review_hash, source, reason)
       values ('glossary:pt-BR.torcedor', $1, $2, $3, 'gemini', 'Exemplo mais natural.')`,
      [{ example: content.example }, { example: 'A torcida encheu o estádio.' }, hash],
    );
    const list = await (await getList('?tipo=glossary&q=torcedor')).json();
    expect(list.data.items.find((i: { id: string }) => i.id === 'glossary:pt-BR.torcedor').edited).toBe(true);
    const detail = (await (await getItem('glossary:pt-BR.torcedor')).json()).data;
    expect(detail.override).toMatchObject({
      fields: { example: content.example },
      base: { example: 'A torcida encheu o estádio.' },
      source: 'gemini',
      reason: 'Exemplo mais natural.',
      at: expect.any(String),
    });
  });
});

describe('piso editorial da API', () => {
  it('sem relato da API o piso fica desconhecido; com relato, o detalhe e a lista trazem o piso', async () => {
    expect((await (await getItem('team:palmeiras')).json()).data.serving).toEqual({
      floor: null,
      reportedAt: null,
    });
    await sql.query(
      `insert into ops.runtime_env (service, key, value, configured, reported_at)
       values ('api', 'SEMANTIC_MIN_REVIEW_STATUS', 'draft', true, now())`,
    );
    const detail = (await (await getItem('team:palmeiras')).json()).data;
    expect(detail.serving.floor).toBe('draft');
    expect(detail.serving.reportedAt).toEqual(expect.any(String));
    expect((await (await getList('')).json()).data.serving.floor).toBe('draft');
  });
});

describe('outros tipos', () => {
  it('tradução: aprovação grava o status dentro de texts do perfil, com o original no detalhe', async () => {
    const id = 'translation:team:palmeiras:es';
    const detail = (await (await getItem(id)).json()).data;
    expect(detail.original).toHaveProperty('identity');
    expect(detail.originalLocale).toBe('pt-BR');
    await post(id, { action: 'draft' });
    expect((await post(id, { action: 'approve' })).status).toBe(200);
    expect((await teamStatus('palmeiras')).texts.es.review_status).toBe('approved');
  });

  it('clássico: grava o status e avisa o change feed pelo id do clássico', async () => {
    const { rows } = await sql.query(
      `select id, key from semantic.review_item where kind = 'derby' order by id limit 1`,
    );
    const { id, key } = rows[0] as { id: string; key: string };
    await post(id, { action: 'draft' });
    expect((await post(id, { action: 'approve' })).status).toBe(200);
    const derby = (
      await sql.query('select id::text, review_status from semantic.derby where slug = $1', [key])
    ).rows[0];
    expect(derby.review_status).toBe('approved');
    const change = await sql.query(
      `select 1 from ops.change_feed where entity_type = 'derby' and entity_id = $1`,
      [derby.id],
    );
    expect(change.rowCount).toBeGreaterThan(0);
  });

  it('histórico geral: do clássico grava no all_time dele; o do par, na lista de confrontos', async () => {
    expect((await post('all-time:derby:choque-rei', { action: 'approve' })).status).toBe(200);
    const derby = (
      await sql.query(`select all_time->>'review_status' as s from semantic.derby where slug = 'choque-rei'`)
    ).rows[0];
    expect(derby.s).toBe('approved');
    expect((await post('all-time:pair:palmeiras-fluminense', { action: 'approve' })).status).toBe(200);
    const pair = (
      await sql.query(
        `select review_status, all_time->>'review_status' as s from semantic.head_to_head where slug = 'palmeiras-fluminense'`,
      )
    ).rows[0];
    expect(pair).toEqual({ review_status: 'approved', s: 'approved' });
    const change = await sql.query(
      `select 1 from ops.change_feed where entity_type = 'head_to_head' and entity_id = 'palmeiras-fluminense'`,
    );
    expect(change.rowCount).toBeGreaterThan(0);
  });

  it('decisão desatualizada (conteúdo mudou) com o YAML no mesmo status: aprovar grava o hash novo', async () => {
    const id = 'team:flamengo';
    expect((await post(id, { action: 'draft' })).status).toBe(200);
    expect((await post(id, { action: 'approve' })).status).toBe(200);
    // o conteúdo do item mudou depois da decisão (outro review_hash no catálogo)
    await sql.query(`update semantic.review_decision set review_hash = 'hash-antigo' where item_id = $1`, [
      id,
    ]);
    const { yaml_status: yaml, review_hash: hash } = (
      await sql.query(`select yaml_status::text, review_hash from semantic.review_item where id = $1`, [id])
    ).rows[0] as { yaml_status: string; review_hash: string };
    expect(yaml).toBe('approved');
    expect((await (await getItem(id)).json()).data).toMatchObject({ state: 'approved', stale: true });

    expect(await (await post(id, { action: 'approve' })).json()).toEqual({
      data: { state: 'approved', unchanged: false },
    });
    const decision = (
      await sql.query(`select review_hash from semantic.review_decision where item_id = $1`, [id])
    ).rows[0];
    expect(decision.review_hash).toBe(hash);
    expect((await (await getItem(id)).json()).data.stale).toBe(false);
  });

  it('perfil editorial da F1: aprovar avisa o change feed e expira o cache da página do piloto', async () => {
    const { rows } = await sql.query(
      `select id, key from semantic.review_item where kind = 'editorial' order by id limit 1`,
    );
    const { id, key } = rows[0] as { id: string; key: string };
    await post(id, { action: 'draft' });
    cache.revalidateTag.mockClear();
    expect((await post(id, { action: 'approve' })).status).toBe(200);
    const change = await sql.query(
      `select topic from ops.change_feed where entity_type = 'f1_editorial' and entity_id = $1`,
      [key],
    );
    expect(change.rows).toContainEqual({ topic: 'semantic.review' });
    // `f1_editorial` é a tag do GET /v1/teams/{id}/editorial na API e do getTeamEditorial na demo
    expect(cache.revalidateTag).toHaveBeenCalledWith('f1_editorial', { expire: 0 });
  });

  it('item inexistente → 404', async () => {
    expect((await getItem('team:nao-existe')).status).toBe(404);
    expect((await post('team:nao-existe', { action: 'approve' })).status).toBe(404);
  });
});

describe('conexão do pool da demo', () => {
  it('Postgres encerrando conexões ociosas (restart, DROP ... WITH FORCE) não vira erro não tratado', async () => {
    const { pool } = await import('../src/lib/auth/db');
    // duas consultas simultâneas deixam duas conexões ociosas no pool
    await Promise.all([pool.query('select pg_sleep(0.05)'), pool.query('select pg_sleep(0.05)')]);
    expect(pool.idleCount).toBeGreaterThanOrEqual(2);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // o que o DROP DATABASE ... WITH FORCE do teardown ou um restart fazem: 57P01 em cada conexão
      await sql.query(
        `select pg_terminate_backend(pid) from pg_stat_activity
          where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'`,
      );
      await expect.poll(() => pool.totalCount, { timeout: 5_000 }).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        '[demo-db] conexão ociosa do pool encerrada pelo Postgres',
        expect.objectContaining({ code: '57P01' }),
      );
    } finally {
      warn.mockRestore();
    }
    // o pool descartou as conexões mortas e reconecta na próxima consulta
    expect((await pool.query<{ ok: number }>('select 1 as ok')).rows).toEqual([{ ok: 1 }]);
  });
});
