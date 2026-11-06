/**
 * Papéis do Postgres por serviço (docs/runbooks/papeis-do-banco.md). O dono do banco (o usuário do
 * `migrate`, POSTGRES_USER, superusuário criado pela imagem do Postgres) cria e altera as tabelas; cada
 * serviço entra com um papel de login próprio, sem superusuário nem DDL, com GRANT por schema:
 *
 * - leitura: USAGE no schema e SELECT em todas as tabelas e sequências;
 * - escrita: também INSERT, UPDATE e DELETE nas tabelas e USAGE nas sequências (sem TRUNCATE nem DDL);
 * - escrita só em algumas tabelas de um schema (`schema.tabela`), com as sequências delas.
 *
 * `applyRoles` roda no `migrate`, depois das migrations, e é idempotente: cria o que falta, revoga e
 * concede de novo a matriz inteira numa transação (tabela nova de migration já sai com o GRANT) e grava os
 * default privileges do dono (tabela criada fora do `migrate` também). A senha de cada papel vem da URL do
 * serviço (`DB_URL_API`…): com o usuário igual ao nome do papel, o papel ganha LOGIN com essa senha; sem
 * a URL, o papel continua sem login e o serviço segue com a URL do dono (troca sem downtime, um serviço por
 * vez).
 *
 * `demo_auth` (login da demo, Better Auth) é do papel da demo: a demo cria e altera as tabelas dela a cada
 * subida. Por isso o schema é criado aqui, já com esse dono, e as tabelas existentes passam para ele.
 */
import postgres from 'postgres';
import { resolveDbTimeouts, sessionParams } from './client.js';

/** Schemas da aplicação (migrations). Schema novo em migration entra aqui e na matriz (o CI confere). */
export const APP_SCHEMAS = [
  'raw',
  'core',
  'semantic',
  'enrich',
  'ops',
  'api',
  'multisport',
  'equestrian',
] as const;

/** Schema do login da demo (fora das migrations: a demo cria as tabelas na subida). */
export const DEMO_AUTH_SCHEMA = 'demo_auth';

/** Cursor do change feed da demo, lido pelo /metrics da API (packages/observability). */
const DEMO_FEED_CURSOR = 'cache_feed_cursor';

export type RoleService = 'api' | 'demo' | 'ingestor' | 'agents' | 'live' | 'backup';

export interface RoleGrants {
  /** Schemas (ou `schema.tabela`) só de leitura. */
  read: readonly string[];
  /** Schemas (ou `schema.tabela`) com INSERT/UPDATE/DELETE. */
  write: readonly string[];
}

/**
 * Matriz por serviço (o que cada um lê e escreve; o levantamento está no runbook). Leitura larga (ler um
 * schema a mais não estraga nada), escrita estreita.
 */
export const ROLE_GRANTS: Record<RoleService, RoleGrants> = {
  // API pública e /internal: chaves, uso, webhooks, onde assistir pelo admin, erros de reprodução e
  // runtime_env/publishable_key/change_feed em ops
  api: { read: [...APP_SCHEMAS, `${DEMO_AUTH_SCHEMA}.${DEMO_FEED_CURSOR}`], write: ['api', 'enrich', 'ops'] },
  // demo (painel de Ajustes): revisão semântica, grades e logos, escudos de time e competição, vídeos,
  // operação, widgets e chaves
  demo: {
    read: APP_SCHEMAS.filter((s) => s !== 'raw'),
    write: ['ops', 'semantic', 'enrich', 'api', 'core.asset', 'core.participant', 'core.competition'],
  },
  // ingestor (agendador e CLIs manuais, inclusive o seed semântico do pós-deploy); o cursor do cache da demo é
  // piso da poda do change feed (change-feed-prune)
  ingestor: {
    read: [...APP_SCHEMAS, `${DEMO_AUTH_SCHEMA}.${DEMO_FEED_CURSOR}`],
    write: ['raw', 'core', 'ops', 'semantic', 'enrich', 'multisport', 'equestrian'],
  },
  // agentes de IA (mesma imagem do ingestor, perfil agents)
  agents: {
    read: [...APP_SCHEMAS],
    write: ['enrich', 'semantic', 'ops', 'core.asset', 'api.tenant_channel_list'],
  },
  // ao vivo (live-run, live-reconcile, events-clock; serviço próprio da mesma imagem do ingestor). Levantamento
  // pelo código, não pela issue: o cliente da api-sports grava TODA resposta em raw.api_response (retention
  // `live`, com o UPDATE de last_seen_at/seen_count quando o corpo se repete), então o raw entra na escrita.
  // - core: upsertBatch (eventos, incidentes, participantes, detalhe, tabelas, catálogo que o lote traz),
  //   advanceEventClock (event_state_log) e recomputeStandings (core.standing);
  // - ops: change_feed (publishChange e os triggers do core.event), job_run, sync_cursor (estado do ao vivo e
  //   cursores do detalhe/reconciliação) e o Quota Governor (quota_ledger, quota_snapshot, quota_budget);
  // - leitura: core, ops (sobrescritas do painel, uso da cota), raw (cache do cliente) e semantic (os pares de
  //   clássico do createDerbyLookup). Sem escrita em semantic, enrich, api, multisport e equestrian;
  // - o scheduler do serviço (perfil `live`, #535): relata o env ao painel (ops.runtime_env, que também é o sinal de
  //   vida) e atende o "rodar agora" do live-reconcile e do events-clock (ops.job_request).
  live: {
    read: ['core', 'ops', 'raw', 'semantic'],
    write: [
      'core',
      'raw.api_response',
      'ops.change_feed',
      'ops.job_run',
      'ops.job_request',
      'ops.runtime_env',
      'ops.sync_cursor',
      'ops.quota_ledger',
      'ops.quota_snapshot',
      'ops.quota_budget',
    ],
  },
  // pg_dump lê tudo pelo pg_read_all_data (inclusive demo_auth e drizzle); grava o próprio ops.job_run e
  // cria/apaga o banco do ensaio de restauração (CREATEDB)
  backup: { read: [], write: ['ops.job_run'] },
};

export const ROLE_SERVICES = Object.keys(ROLE_GRANTS) as RoleService[];

/** Variável de ambiente com a URL do serviço (usuário = papel, senha = a do papel). */
export const ROLE_URL_ENV: Record<RoleService, string> = {
  api: 'DB_URL_API',
  demo: 'DB_URL_DEMO',
  ingestor: 'DB_URL_INGESTOR',
  agents: 'DB_URL_AGENTS',
  live: 'DB_URL_LIVE',
  backup: 'DB_URL_BACKUP',
};

/**
 * `CONNECTION LIMIT` de cada papel (o Postgres recusa a conexão que passa disso com 53300). É o teto do vazamento: um
 * serviço com pool sem freio ou em laço de reconexão para no limite dele e não esgota o `max_connections` (130, 3
 * reservadas ao superusuário) que a API também usa. A soma dos tetos passa do `max_connections` de propósito: o
 * teto não reserva vaga, só contém um papel; o que tem de caber é o pico real (README da infra › Conexões).
 *
 * Conta de cada um, com `DB_POOL_MAX` (client.ts) e uma conexão de trava (advisory lock) por processo de job:
 * - api: pool 10 × 3 (no ar, o novo durante a troca e o candidato do deploy) + worker de webhooks 5 × 2 + 5 de CLI = 45;
 * - demo (a imagem roda como `site` e `console`, #546): site = login 5 + Builder 3 + change feed 2 = 10; console =
 *   login 5 + Builder 3 + tarefas 2 = 10. No pior momento do deploy ficam no ar os dois e os dois candidatos (40; na
 *   troca, um deles em duas cópias, 30; na primeira troca, a demo antiga ao lado dos dois, 30), mais folga para CLI: 60;
 * - ingestor: scheduler 2 + `SCHEDULER_MAX_JOBS` 1 × (4 + 1) = 7 (a stack passa 1: o trabalho longo foi para o worker),
 *   mais o ao vivo quando ele roda aqui (`SCHEDULER_LIVE=internal`: o dev e a volta para uma versão anterior ao serviço
 *   `live`, que não refaz o teto do papel: 3 × (4 + 1) = 15) = 22; o worker da fila (#542), no mesmo papel: pai 2 +
 *   `WORKER_MAX_TASKS` 2 × (2 do `runTask` + 4 do contexto do job) = 14, duas cópias durante a troca do deploy = 28;
 *   mais CLI à mão: 55. Com o `live` no ar (#535) o pico aqui é 7 + 28; o teto só cai quando a volta para antes dele
 *   deixar de ser opção;
 * - agents: scheduler 2 + `AGENTS_MAX_JOBS` 3 × (4 + 1) = 17, mais CLI: 25;
 * - live: 2 cópias sempre, mais a nova durante a troca (#537). Cada cópia: scheduler 2 + live-run (4 + trava da cópia
 *   + trava `live:leader`) = 8; `live-reconcile` e `events-clock` (4 + 1 cada) rodam numa cópia por vez em todo o
 *   banco: 3 × 8 + 10 = 34, mais as travas tentadas e soltas na hora e folga: 45;
 * - backup: pg_dump 1, ensaio de restauração 1, psql da verificação 1: 6 com folga.
 * O dono do banco (migrate, CLI de manutenção, sincronização) é superusuário e não tem limite.
 */
export const ROLE_CONNECTION_LIMITS: Record<RoleService, number> = {
  api: 45,
  demo: 60,
  ingestor: 55,
  agents: 25,
  live: 45,
  backup: 6,
};

export const roleName = (service: RoleService, prefix = 'galaxie_'): string => `${prefix}${service}`;

export interface ApplyRolesOptions {
  /** Prefixo dos papéis (padrão `galaxie_`; os testes usam um aleatório: papel é do cluster inteiro). */
  prefix?: string;
  /** Senha por serviço (LOGIN); sem senha, o papel fica sem login. */
  passwords?: Partial<Record<RoleService, string>>;
}

export interface ApplyRolesResult {
  roles: string[];
  /** Papéis que ganharam (ou renovaram) LOGIN com senha nesta execução. */
  login: string[];
}

/**
 * Senhas dos papéis a partir das URLs dos serviços (`DB_URL_API`…). Só vale a URL cujo usuário é o nome do
 * papel: a URL do dono (antes da troca) é ignorada. Usuário de papel com URL sem senha é erro (o serviço
 * não entraria).
 */
export function rolePasswordsFromEnv(
  env: NodeJS.ProcessEnv,
  prefix = 'galaxie_',
): Partial<Record<RoleService, string>> {
  const out: Partial<Record<RoleService, string>> = {};
  for (const service of ROLE_SERVICES) {
    const raw = env[ROLE_URL_ENV[service]]?.trim();
    if (!raw) continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`${ROLE_URL_ENV[service]} não é uma URL válida`);
    }
    if (decodeURIComponent(url.username) !== roleName(service, prefix)) continue;
    const password = decodeURIComponent(url.password);
    if (password.length < 16)
      throw new Error(`${ROLE_URL_ENV[service]}: senha do papel ausente ou curta (mínimo 16 caracteres)`);
    // o backup lê a senha da mesma URL em shell, sem decodificar (infra/backup/lib.sh): só letras e números
    if (!/^[A-Za-z0-9]+$/.test(password))
      throw new Error(
        `${ROLE_URL_ENV[service]}: senha do papel só com letras e números (openssl rand -hex 32)`,
      );
    out[service] = password;
  }
  return out;
}

const splitScope = (scope: string): { schema: string; table: string | null } => {
  const [schema, table] = scope.split('.');
  return { schema: schema!, table: table ?? null };
};

/** Cria/atualiza os papéis e aplica a matriz de GRANTs no banco da URL (conectado como o dono). */
export async function applyRoles(url: string, options: ApplyRolesOptions = {}): Promise<ApplyRolesResult> {
  const prefix = options.prefix ?? 'galaxie_';
  if (!/^[a-z][a-z0-9_]*$/.test(prefix)) throw new Error(`prefixo de papel inválido: ${prefix}`);
  // perfil migrate (lock_timeout curto): o ALTER OWNER do demo_auth não enfileira a demo atrás de um job longo
  const sql = postgres(url, {
    max: 1,
    onnotice: () => {},
    connection: sessionParams(resolveDbTimeouts('migrate'), 'galaxie-migrate-roles'),
  });
  const role = (s: RoleService) => sql(roleName(s, prefix));
  const login: string[] = [];
  try {
    const [me] = await sql<{ owner: string }[]>`select current_user as owner`;
    const owner = me!.owner;
    if (ROLE_SERVICES.some((s) => roleName(s, prefix) === owner))
      throw new Error(`o migrate não pode rodar com um papel de serviço (${owner}): use o dono do banco`);

    // papéis: cluster inteiro, fora da transação (CREATE ROLE concorrente de dois bancos do mesmo cluster)
    for (const service of ROLE_SERVICES) {
      const name = roleName(service, prefix);
      await sql`
        do $$ begin
          create role ${sql.unsafe(`"${name}"`)} nologin;
        exception when duplicate_object then null;
        end $$`;
      await sql`alter role ${role(service)} nosuperuser nocreaterole noreplication nobypassrls`;
      await sql`alter role ${role(service)} connection limit ${sql.unsafe(String(ROLE_CONNECTION_LIMITS[service]))}`;
      await sql`alter role ${role(service)} ${sql.unsafe(service === 'backup' ? 'createdb' : 'nocreatedb')}`;
    }
    await sql`grant pg_read_all_data to ${role('backup')}`;

    const existing = new Set(
      (
        await sql<{ nspname: string }[]>`
          select nspname from pg_namespace where nspname in ${sql([...APP_SCHEMAS, DEMO_AUTH_SCHEMA])}`
      ).map((r) => r.nspname),
    );

    await sql.begin(async (tx) => {
      // demo_auth: schema e tabelas da demo
      const demo = roleName('demo', prefix);
      if (!existing.has(DEMO_AUTH_SCHEMA))
        await tx`create schema ${tx(DEMO_AUTH_SCHEMA)} authorization ${tx(demo)}`;
      else await tx`alter schema ${tx(DEMO_AUTH_SCHEMA)} owner to ${tx(demo)}`;
      await tx`
        create table if not exists ${tx(DEMO_AUTH_SCHEMA)}.${tx(DEMO_FEED_CURSOR)} (
          name text primary key,
          last_change_id bigint not null,
          updated_at timestamptz not null default now()
        )`;
      const demoObjects = await tx<{ kind: string; name: string }[]>`
        select case when c.relkind = 'S' then 'sequence' when c.relkind = 'v' then 'view' else 'table' end as kind,
               c.relname as name
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = ${DEMO_AUTH_SCHEMA} and c.relkind in ('r', 'p', 'v', 'S')
           and pg_get_userbyid(c.relowner) <> ${demo}
           -- sequência de coluna serial muda de dono junto com a tabela
           and not (c.relkind = 'S' and exists (
             select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('a', 'i')))`;
      for (const o of demoObjects)
        await tx`alter ${tx.unsafe(o.kind)} ${tx(DEMO_AUTH_SCHEMA)}.${tx(o.name)} owner to ${tx(demo)}`;

      for (const service of ROLE_SERVICES) {
        const r = role(service);
        // começa do zero em cada schema da aplicação (a matriz pode ter encolhido)
        for (const schema of APP_SCHEMAS) {
          if (!existing.has(schema)) continue;
          await tx`revoke all on all tables in schema ${tx(schema)} from ${r}`;
          await tx`revoke all on all sequences in schema ${tx(schema)} from ${r}`;
          await tx`revoke all on schema ${tx(schema)} from ${r}`;
          await tx`alter default privileges in schema ${tx(schema)} revoke all on tables from ${r}`;
          await tx`alter default privileges in schema ${tx(schema)} revoke all on sequences from ${r}`;
        }
        if (service !== 'demo') {
          await tx`revoke all on all tables in schema ${tx(DEMO_AUTH_SCHEMA)} from ${r}`;
          await tx`revoke all on schema ${tx(DEMO_AUTH_SCHEMA)} from ${r}`;
        }

        const { read, write } = ROLE_GRANTS[service];
        const schemas = new Set([...read, ...write].map((s) => splitScope(s).schema));
        for (const schema of schemas) {
          if (!existing.has(schema) && schema !== DEMO_AUTH_SCHEMA) continue;
          await tx`grant usage on schema ${tx(schema)} to ${r}`;
        }
        for (const scope of read) {
          const { schema, table } = splitScope(scope);
          if (!existing.has(schema) && schema !== DEMO_AUTH_SCHEMA) continue;
          if (table) {
            await tx`grant select on ${tx(schema)}.${tx(table)} to ${r}`;
            continue;
          }
          await tx`grant select on all tables in schema ${tx(schema)} to ${r}`;
          await tx`grant select on all sequences in schema ${tx(schema)} to ${r}`;
          await tx`alter default privileges in schema ${tx(schema)} grant select on tables to ${r}`;
          await tx`alter default privileges in schema ${tx(schema)} grant select on sequences to ${r}`;
        }
        for (const scope of write) {
          const { schema, table } = splitScope(scope);
          if (!existing.has(schema)) continue;
          if (table) {
            const target = `${schema}.${table}`;
            const exists = await tx<{ ok: boolean }[]>`select to_regclass(${target}) is not null as ok`;
            if (!exists[0]!.ok) continue;
            await tx`grant select, insert, update, delete on ${tx(schema)}.${tx(table)} to ${r}`;
            const seqs = await tx<{ seq: string }[]>`
              select pg_get_serial_sequence(${target}, a.attname) as seq
                from pg_attribute a
               where a.attrelid = to_regclass(${target}) and a.attnum > 0 and not a.attisdropped
                 and pg_get_serial_sequence(${target}, a.attname) is not null`;
            for (const { seq } of seqs) await tx`grant usage, select on sequence ${tx.unsafe(seq)} to ${r}`;
            continue;
          }
          await tx`grant select, insert, update, delete on all tables in schema ${tx(schema)} to ${r}`;
          await tx`grant usage, select on all sequences in schema ${tx(schema)} to ${r}`;
          await tx`alter default privileges in schema ${tx(schema)} grant select, insert, update, delete on tables to ${r}`;
          await tx`alter default privileges in schema ${tx(schema)} grant usage, select on sequences to ${r}`;
        }
      }
      // tabela que a demo criar depois no demo_auth: o cursor do change feed já foi criado acima
    });

    for (const service of ROLE_SERVICES) {
      const password = options.passwords?.[service];
      if (!password) continue;
      const name = roleName(service, prefix);
      // a senha vira literal no servidor (format %L); nunca entra em log
      const [stmt] = await sql<{ q: string }[]>`
        select format('alter role %I with login password %L', ${name}::text, ${password}::text) as q`;
      await sql.unsafe(stmt!.q);
      login.push(name);
    }
    return { roles: ROLE_SERVICES.map((s) => roleName(s, prefix)), login };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
