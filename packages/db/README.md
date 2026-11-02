# @galaxie/db

Dono do schema do banco. Define as tabelas em Drizzle, guarda as migrations e expõe o cliente, o migrator e alguns
helpers de banco compartilhados (trava de job, change feed, grades, widgets, vídeos relacionados).

| Schema Postgres | Conteúdo |
|---|---|
| `raw` | Respostas brutas da api-sports, imutáveis (reprocessar não gasta cota) |
| `core` | Modelo canônico: eventos, competições, temporadas, times, pessoas, classificação, assets |
| `semantic` | Base semântica carregada de `data/knowledge` (clássicos, apelidos, copy) |
| `enrich` | O que a IA e as fontes externas acrescentam (onde assistir, contexto, resumos, vídeos) |
| `multisport` · `equestrian` | Olimpíadas/Pan e hipismo |
| `api` | Tenants, chaves, uso, webhooks, widgets do Builder |
| `ops` | Cota, cursores de sync, jobs, change feed, uso de LLM, configuração em tempo de execução |

Modelo completo: [docs/04](../../docs/04-modelo-de-dados.md).

## Papéis por serviço

`src/roles.ts` define um papel de login por serviço (sem superusuário, sem DDL), e o `migrate` aplica os GRANTs e o
`CONNECTION LIMIT` de cada um a cada deploy (`DB_ROLES=on`). A URL do serviço (`DB_URL_<SERVIÇO>`) troca o dono pelo
papel. Detalhes e passo a passo: [runbook](../../docs/runbooks/papeis-do-banco.md).

| Papel | URL | Lê | Escreve | Conexões |
|---|---|---|---|---|
| `galaxie_api` | `DB_URL_API` | todos os schemas | `api`, `enrich`, `ops` | 45 |
| `galaxie_demo` | `DB_URL_DEMO` | todos, menos `raw` | `ops`, `semantic`, `enrich`, `api`, `core.asset` (dona do `demo_auth`) | 30 |
| `galaxie_ingestor` | `DB_URL_INGESTOR` | todos | `raw`, `core`, `ops`, `semantic`, `enrich`, `multisport`, `equestrian` | 40 |
| `galaxie_agents` | `DB_URL_AGENTS` | todos | `enrich`, `semantic`, `ops`, `core.asset`, `api.tenant_channel_list` | 25 |
| `galaxie_live` | `DB_URL_LIVE` | `core`, `ops`, `raw`, `semantic` | `core`, `raw.api_response`, `ops.change_feed`, `ops.job_run`, `ops.sync_cursor`, `ops.quota_*` | 36 |
| `galaxie_backup` | `DB_URL_BACKUP` | tudo | `ops.job_run` (`CREATEDB` para o ensaio de restauração) | 6 |

Tempos por perfil de conexão (`createDb({ profile })`): `api` 10 s de consulta, `live` 30 s, `job` 10 min, `migrate` sem
teto de consulta.

## Como usar

```bash
pnpm db:migrate     # na raiz: aplica as migrations (idempotente)
pnpm db:generate    # gera migration a partir de src/schema (commite drizzle/)
pnpm db:studio      # Drizzle Studio
```

Mudou `src/schema`? Rode `pnpm db:generate` e commite a pasta `drizzle/`; o CI falha com drift e confere o `when` do
journal (CONTRIBUTING, regra 2). `DB_ROLES` cria os papéis de banco por serviço (`src/roles.ts`).

## Depende de

Nenhum pacote do repo. Precisa de Postgres 17 (`DATABASE_URL`).

## Usado por

Todos os apps e serviços, e `apisports-client`, `ai-ledger`, `knowledge`, `observability`, `rules`, `where-to-watch`.
