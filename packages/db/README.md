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
