import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APP_SCHEMAS,
  DEMO_AUTH_SCHEMA,
  ROLE_CONNECTION_LIMITS,
  ROLE_GRANTS,
  ROLE_SERVICES,
  applyRoles,
  roleName,
  rolePasswordsFromEnv,
  runMigrations,
  type RoleService,
} from '../src/index.js';

/*
 * Papéis por serviço (roles.ts) num banco descartável com todas as migrations: cada papel entra com a
 * própria senha e consegue o que o serviço precisa (e só isso). Papel é do cluster inteiro: prefixo
 * aleatório por execução, apagado no fim.
 */

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

const tag = randomBytes(4).toString('hex');
const dbName = `galaxie_test_${tag}`;
const prefix = `t${tag}_`;
const withDb = (u: string, db: string, user?: { name: string; password: string }) => {
  const url = new URL(u);
  url.pathname = `/${db}`;
  if (user) {
    url.username = user.name;
    url.password = user.password;
  }
  return url.toString();
};
const testUrl = withDb(adminUrl, dbName);
const passwords = Object.fromEntries(
  ROLE_SERVICES.map((s) => [s, randomBytes(18).toString('hex')]),
) as Record<RoleService, string>;

let admin: postgres.Sql;
let owner: postgres.Sql;
const as: Partial<Record<RoleService, postgres.Sql>> = {};
const conn = (s: RoleService) => as[s]!;

/** Erro de permissão (42501) da consulta. */
const denied = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect((err as { code?: string } | null)?.code).toBe('42501');
};

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${dbName}`);
  await runMigrations(testUrl);
  owner = postgres(testUrl, { max: 1, onnotice: () => {} });
  // tabela da demo que já existia antes dos papéis (criada pelo dono): passa para o papel da demo
  await owner.unsafe(`create schema ${DEMO_AUTH_SCHEMA}`);
  await owner.unsafe(`create table ${DEMO_AUTH_SCHEMA}.legacy (id bigserial primary key, email text)`);
  await applyRoles(testUrl, { prefix, passwords });
  for (const s of ROLE_SERVICES)
    as[s] = postgres(withDb(adminUrl, dbName, { name: roleName(s, prefix), password: passwords[s] }), {
      max: 1,
      onnotice: () => {},
    });
}, 120_000);

afterAll(async () => {
  await Promise.all(Object.values(as).map((c) => c?.end({ timeout: 5 })));
  await owner?.end({ timeout: 5 });
  await admin.unsafe(`drop database if exists ${dbName} with (force)`);
  for (const s of ROLE_SERVICES) await admin.unsafe(`drop role if exists "${roleName(s, prefix)}"`);
  await admin.end();
});

describe('papéis por serviço', () => {
  it('todo schema das migrations está na matriz (schema novo precisa de GRANT)', async () => {
    const rows = await owner<{ nspname: string }[]>`
      select nspname from pg_namespace
       where nspname not like 'pg\\_%' and nspname not in ('information_schema', 'public', 'drizzle', ${DEMO_AUTH_SCHEMA})`;
    expect(rows.map((r) => r.nspname).sort()).toEqual([...APP_SCHEMAS].sort());
  });

  it('nenhum papel é superusuário; só o do backup cria banco', async () => {
    const rows = await owner<
      { rolname: string; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }[]
    >`
      select rolname, rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname like ${`${prefix}%`}`;
    expect(rows).toHaveLength(ROLE_SERVICES.length);
    for (const r of rows) {
      expect(r.rolsuper).toBe(false);
      expect(r.rolcreaterole).toBe(false);
      expect(r.rolcreatedb).toBe(r.rolname === roleName('backup', prefix));
    }
  });

  it('cada papel lê e escreve exatamente o que a matriz diz, tabela por tabela', async () => {
    const tables = await owner<{ schema: string; name: string }[]>`
      select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'p') and n.nspname in ${owner([...APP_SCHEMAS])}`;
    expect(tables.length).toBeGreaterThan(50);
    for (const service of ROLE_SERVICES) {
      if (service === 'backup') continue; // pg_read_all_data: conferido no teste do backup
      const { read, write } = ROLE_GRANTS[service];
      const role = roleName(service, prefix);
      const covers = (scopes: readonly string[], t: { schema: string; name: string }) =>
        scopes.includes(t.schema) || scopes.includes(`${t.schema}.${t.name}`);
      const wrong: string[] = [];
      for (const t of tables) {
        const [p] = await owner<{ sel: boolean; ins: boolean; upd: boolean; del: boolean; trunc: boolean }[]>`
          select has_table_privilege(${role}, ${`${t.schema}.${t.name}`}, 'select') as sel,
                 has_table_privilege(${role}, ${`${t.schema}.${t.name}`}, 'insert') as ins,
                 has_table_privilege(${role}, ${`${t.schema}.${t.name}`}, 'update') as upd,
                 has_table_privilege(${role}, ${`${t.schema}.${t.name}`}, 'delete') as del,
                 has_table_privilege(${role}, ${`${t.schema}.${t.name}`}, 'truncate') as trunc`;
        const w = covers(write, t);
        const r = w || covers(read, t);
        if (p!.sel !== r || p!.ins !== w || p!.upd !== w || p!.del !== w || p!.trunc)
          wrong.push(`${service} ${t.schema}.${t.name}: ${JSON.stringify(p)}`);
      }
      expect(wrong).toEqual([]);
    }
  });

  it('papel de serviço não faz DDL nem comando de superusuário', async () => {
    for (const s of ROLE_SERVICES) {
      await denied(conn(s).unsafe('create table core.invasor (id int)'));
      await denied(conn(s).unsafe("copy (select 1) to program 'id'"));
      await denied(conn(s).unsafe('alter table core.sport add column x int'));
    }
    await denied(conn('api').unsafe('create schema invasor'));
  });

  it('ingestor: grava raw e core; o trigger do change feed grava em ops', async () => {
    const ing = conn('ingestor');
    await ing`insert into core.sport (slug, name) values ('teste-papel', '{"pt-BR":"Teste"}')`;
    await ing`update core.sport set name = '{"pt-BR":"Teste 2"}' where slug = 'teste-papel'`;
    await ing`delete from core.sport where slug = 'teste-papel'`;
    await denied(conn('agents')`insert into core.sport (slug, name) values ('x', '{}')`);
    await denied(conn('demo')`insert into core.sport (slug, name) values ('x', '{}')`);
  });

  it('agents e demo: grade (enrich.platform) dispara o change feed sem erro de permissão', async () => {
    for (const s of ['agents', 'demo'] as const) {
      const slug = `br-teste-${s}`;
      await conn(s)`
        insert into enrich.platform (slug, name, kind, country) values (${slug}, 'Teste', 'streaming', 'BR')`;
      await conn(s)`update enrich.platform set name = 'Teste 2' where slug = ${slug}`;
      await conn(s)`delete from enrich.platform where slug = ${slug}`;
    }
    const [feed] = await owner<{ n: number }[]>`select count(*)::int as n from ops.change_feed`;
    expect(feed!.n).toBeGreaterThan(0);
    await denied(conn('api')`insert into raw.api_response (endpoint) values ('x')`);
  });

  it('demo é dona do demo_auth: cria, altera e lê as tabelas do login', async () => {
    const demo = conn('demo');
    // `create schema if not exists` confere o CREATE no banco antes de ver que o schema existe: a demo só cria
    // quando falta (lib/auth/setup.ts)
    await denied(demo.unsafe(`create schema if not exists ${DEMO_AUTH_SCHEMA}`));
    await demo.unsafe(`create table if not exists ${DEMO_AUTH_SCHEMA}.zz_nova (id bigserial primary key)`);
    await demo.unsafe(`alter table ${DEMO_AUTH_SCHEMA}.legacy add column if not exists extra text`);
    await demo.unsafe(`create index if not exists legacy_email_idx on ${DEMO_AUTH_SCHEMA}.legacy (email)`);
    await demo`insert into demo_auth.legacy (email) values ('a@b.test')`;
    // o cursor do change feed já existe e a API o lê (o /metrics); o resto do login, não
    await demo`insert into demo_auth.cache_feed_cursor (name, last_change_id) values ('teste', 1)`;
    expect(await conn('api')`select name from demo_auth.cache_feed_cursor`).toHaveLength(1);
    // piso da poda do change feed
    expect(await conn('ingestor')`select name from demo_auth.cache_feed_cursor`).toHaveLength(1);
    await denied(conn('api')`select * from demo_auth.legacy`);
    await denied(conn('ingestor')`select * from demo_auth.legacy`);
  });

  it('backup lê tudo (inclusive demo_auth e drizzle), grava o próprio job_run e cria banco', async () => {
    const b = conn('backup');
    await b`select count(*) from drizzle.__drizzle_migrations`;
    await b`select count(*) from demo_auth.legacy`;
    await b`select count(*) from core.event`;
    const [run] = await b<
      { id: string }[]
    >`insert into ops.job_run (job, status) values ('pg-backup', 'running') returning id`;
    await b`update ops.job_run set status = 'ok' where id = ${run!.id}`;
    await denied(b`update core.sport set name = '{}'`);
    const drill = `${dbName}_drill`;
    await b.unsafe(`create database ${drill}`);
    await b.unsafe(`drop database ${drill} with (force)`);
  });

  it('live: grava o que o tick grava (core, raw.api_response, ops estreito) e mais nada', async () => {
    const live = conn('live');
    // core: o upsert do lote e o relógio dos eventos
    await live`insert into core.sport (slug, name) values ('teste-live', '{"pt-BR":"Teste"}')`;
    await live`update core.sport set name = '{"pt-BR":"Teste 2"}' where slug = 'teste-live'`;
    await live`delete from core.sport where slug = 'teste-live'`;
    // raw: o cliente grava a resposta (retention live) e, com o corpo repetido, só estende o "visto em"
    const [resp] = await live<{ id: string }[]>`
      insert into raw.api_response (sport, api_version, endpoint, params, request_hash, status_code, body, body_hash, retention)
      values ('football', 'v3', '/fixtures', '{"live":"all"}', 'h', 200, '{}', 'b', 'live') returning id`;
    await live`update raw.api_response set seen_count = seen_count + 1, last_seen_at = now() where id = ${resp!.id}`;
    // ops: change feed (publishChange), job_run, sync_cursor (estado do ao vivo), Quota Governor
    const [id] = await live<
      { id: string }[]
    >`select ops.publish_change('live', 'event', 'e1', '{"a":1}'::jsonb)::text as id`;
    expect(Number(id!.id)).toBeGreaterThan(0);
    const [run] = await live<{ id: string }[]>`
      insert into ops.job_run (job, status) values ('live:run', 'running') returning id`;
    await live`update ops.job_run set status = 'ok' where id = ${run!.id}`;
    await live`
      insert into ops.sync_cursor (sport, endpoint, key, cursor) values ('football', 'live:scheduler', 'state', '{}')
      on conflict (provider, sport, endpoint, key) do update set cursor = excluded.cursor`;
    // o scheduler do serviço: relato ao painel e "rodar agora" do live-reconcile e do events-clock
    for (const t of ['quota_ledger', 'quota_snapshot', 'quota_budget', 'runtime_env', 'job_request'])
      expect(
        (
          await owner<{ ok: boolean }[]>`
            select has_table_privilege(${roleName('live', prefix)}, ${`ops.${t}`}, 'insert') as ok`
        )[0]!.ok,
      ).toBe(true);
    // lê o que o recálculo, o cache do cliente e o createDerbyLookup precisam
    for (const t of ['core.event', 'ops.runtime_setting', 'raw.api_response', 'semantic.derby'])
      await live.unsafe(`select 1 from ${t} limit 1`);
  });

  it('live: INSERT em semantic, enrich, api e nas tabelas de ops fora do ao vivo é recusado', async () => {
    const live = conn('live');
    await denied(
      live`insert into semantic.derby (slug, name, scope, intensity) values ('x', 'x', 'city', 1)`,
    );
    await denied(
      live`insert into enrich.platform (slug, name, kind, country) values ('x', 'x', 'streaming', 'BR')`,
    );
    // as demais tabelas de ops e o api: sem INSERT (a escrita de ops do ao vivo é por tabela)
    for (const t of ['ops.llm_usage', 'ops.normalize_failure', 'ops.runtime_setting', 'api.tenant']) {
      const [p] = await owner<{ ins: boolean; upd: boolean; del: boolean }[]>`
        select has_table_privilege(${roleName('live', prefix)}, ${t}, 'insert') as ins,
               has_table_privilege(${roleName('live', prefix)}, ${t}, 'update') as upd,
               has_table_privilege(${roleName('live', prefix)}, ${t}, 'delete') as del`;
      expect(p, t).toEqual({ ins: false, upd: false, del: false });
    }
  });

  it('CONNECTION LIMIT de cada papel vem de ROLE_CONNECTION_LIMITS', async () => {
    const rows = await owner<{ rolname: string; rolconnlimit: number }[]>`
      select rolname, rolconnlimit from pg_roles where rolname like ${`${prefix}%`}`;
    expect(rows).toHaveLength(ROLE_SERVICES.length);
    for (const r of rows) {
      const service = ROLE_SERVICES.find((s) => roleName(s, prefix) === r.rolname)!;
      expect(r.rolconnlimit).toBe(ROLE_CONNECTION_LIMITS[service]);
    }
  });

  it('o limite recusa a conexão que passa dele (53300) e libera quando uma cai', async () => {
    // Uma conexão por pool (max 1): no postgres.js 4 um pool que já tem conexão aberta não falha com o 53300, põe a
    // consulta na fila de uma das abertas; o pool sem nenhuma tenta de novo (backoff) até o connect_timeout e só
    // então rejeita com o 53300.
    const url = withDb(adminUrl, dbName, { name: roleName('backup', prefix), password: passwords.backup });
    const open = (connectTimeout: number) =>
      postgres(url, { max: 1, connect_timeout: connectTimeout, onnotice: () => {} });
    const limit = ROLE_CONNECTION_LIMITS.backup;
    // o backup pode já ter conexão aberta pelos outros testes (conn('backup')): conta antes de encher
    const [before] = await admin<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity where usename = ${roleName('backup', prefix)}`;
    const held: postgres.Sql[] = [];
    try {
      let refused: unknown = null;
      for (let i = 0; i <= limit && !refused; i++) {
        const c = open(2);
        held.push(c);
        refused = await c`select 1`.then(
          () => null,
          (e: unknown) => e,
        );
      }
      expect((refused as { code?: string } | null)?.code).toBe('53300');
      // entraram exatamente as que cabiam no CONNECTION LIMIT; a última foi a recusada
      expect(held.length - 1).toBe(limit - before!.n);
      await held.pop()!.end({ timeout: 5 });
      // uma cai e a vaga volta: a próxima conexão entra
      await held.shift()!.end({ timeout: 5 });
      const next = open(10);
      held.push(next);
      await next`select 1`;
    } finally {
      await Promise.all(held.map((c) => c.end({ timeout: 5 })));
    }
    await conn('backup')`select 1`;
  });

  it('tabela criada depois pelo dono já sai com o GRANT (default privileges), sequência inclusa', async () => {
    await owner.unsafe('create table ops.zz_futura (id bigserial primary key, v text)');
    await owner.unsafe('create table core.zz_futura (id bigserial primary key, v text)');
    await conn('api')`insert into ops.zz_futura (v) values ('ok')`;
    expect(await conn('agents')`select * from core.zz_futura`).toHaveLength(0);
    await denied(conn('agents')`insert into core.zz_futura (v) values ('não')`);
    await conn('ingestor')`insert into core.zz_futura (v) values ('ok')`;
  });

  it('idempotente: aplicar de novo não muda nada nem derruba as senhas', async () => {
    await applyRoles(testUrl, { prefix });
    await conn('api')`select 1`;
    await conn('api')`insert into ops.zz_futura (v) values ('de novo')`;
  });

  it('a senha vem da URL do serviço só quando o usuário é o papel', () => {
    const pw = 'a'.repeat(32);
    expect(
      rolePasswordsFromEnv(
        {
          DB_URL_API: `postgres://${prefix}api:${pw}@postgres:5432/db`,
          DB_URL_DEMO: `postgres://galaxie:${pw}@postgres:5432/db`,
        },
        prefix,
      ),
    ).toEqual({ api: pw });
    expect(() =>
      rolePasswordsFromEnv({ DB_URL_AGENTS: `postgres://${prefix}agents:curta@postgres/db` }, prefix),
    ).toThrow(/senha/);
    // codificada na URL: o backup leria a senha sem decodificar (lib.sh), então nem o papel a recebe
    expect(() =>
      rolePasswordsFromEnv(
        { DB_URL_BACKUP: `postgres://${prefix}backup:${'a'.repeat(20)}%40x@postgres/db` },
        prefix,
      ),
    ).toThrow(/letras e números/);
  });
});
