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

## Migrations: expandir e contrair

A troca de versão no deploy é lado a lado, e o candidato aplica a migration **antes** da troca: por alguns segundos a
versão antiga e a nova rodam sobre o mesmo schema. Por isso toda migration precisa servir às duas, e o que quebra a
antiga (contrair) só sai num deploy seguinte, depois que nenhum código usa mais o que vai embora.

| Expandir: em qualquer PR | Contrair: só em PR próprio, com o rótulo `contrair` |
|---|---|
| `CREATE TABLE`, `ADD COLUMN` opcional (ou com `DEFAULT`) | `DROP TABLE`, `DROP COLUMN`, `DROP CONSTRAINT`, `DROP INDEX` (mesmo o trocado por outro) |
| `CREATE INDEX` (em tabela grande, com `-- galaxie:concurrently`) | `RENAME` de tabela, coluna, constraint ou índice |
| tabela ou coluna nova que o código novo lê e o antigo ignora | `ALTER COLUMN … TYPE`, `SET NOT NULL`, `ADD COLUMN … NOT NULL` sem `DEFAULT`, `TRUNCATE` |

Ordem para tirar ou trocar algo: (1) PR que expande e passa o código para o novo; (2) deploy; (3) PR que contrai,
rotulado `contrair`, depois que o deploy do passo 2 está no ar e estável. Com uma migration `contrair` aplicada, **voltar
o código para a versão anterior é proibido** (a antiga quebra no schema novo; o `restore_previous` do `deploy-gh.sh` já
recusa a volta com migration nova aplicada): o caminho é corrigir para frente, ou o dump de antes do migrate.

O CI confere: o passo "Migration destrutiva sem o rótulo contrair" lê os `.sql` que o PR acrescenta em `drizzle/`
(`src/destructive-migrations.ts`) e reprova o PR sem o rótulo `contrair`; na fila de merge e no push na main só avisa.
O rótulo `contrair` existe no repositório; depois de colocá-lo, reexecute o job `checks` (o rótulo é lido na hora).
Regras, receitas (renomear coluna, mudar tipo, tornar obrigatória, trocar índice) e o que o check não pega:
[docs/runbooks/migrations.md](../../docs/runbooks/migrations.md).

## Depende de

Nenhum pacote do repo. Precisa de Postgres 17 (`DATABASE_URL`).

## Usado por

Todos os apps e serviços, e `apisports-client`, `ai-ledger`, `knowledge`, `observability`, `rules`, `where-to-watch`.
