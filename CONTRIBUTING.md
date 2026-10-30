# Contribuindo com o Galaxie Sports

Guia curto para quem (pessoa ou agente) implementa issues do [backlog](https://github.com/users/galaxie-works/projects/4).

## Stack e comandos

- Node.js 24, pnpm 11, TypeScript 6 (estrito, ESM — imports relativos terminam em `.js`), Turborepo.
- PostgreSQL 17 + Drizzle (`packages/db`), Valkey, RustFS/S3 — `pnpm infra:up` (Postgres na porta **5433**).
- Qualidade (o CI roda exatamente isto):

```bash
pnpm install
pnpm format:check && pnpm lint && pnpm build && pnpm typecheck
pnpm test                 # unitários (src/**/*.test.ts)
pnpm test:integration     # integração (test/**/*.integration.test.ts) contra o Postgres local
```

## Organização

Cada pasta abaixo tem um `README.md` próprio. Mapa geral, dependências e fronteiras: [docs/15](docs/15-organizacao-do-monorepo.md).
Apps e serviços não importam uns aos outros; código compartilhado vai para `packages/`, e `packages/` nunca importa `apps/` nem `services/`.

| Onde | O quê |
|---|---|
| `packages/db` | Schema Drizzle (`src/schema/*`), migrations (`drizzle/`), cliente e migrator |
| `packages/apisports-client` | Único ponto de saída para a api-sports (cache no raw, plano, Quota Governor, limite por minuto) |
| `packages/observability` | Logger JSON compartilhado (pino) e métricas Prometheus lidas do banco (cota, jobs, frescor, ao vivo) |
| `packages/providers` | Camada de provedores plugável (`SportsDataProvider`, lote normalizado neutro, `ApiSportsProvider`) e lógica pura do evento (máquina de estados, momentum, importância) |
| `packages/contracts` | DTOs Zod → OpenAPI compartilhados entre API e demo |
| `packages/rules` | Motor de regras determinístico: tabelas calculadas e stakes; regulamentos em `config/rules/*.yaml` ([docs/rules](docs/rules/README.md)) |
| `packages/knowledge` | Base semântica (`data/knowledge`): validação (`pnpm knowledge:validate`), seed (`pnpm db:seed:semantic`), resolução de IDs (`pnpm resolve:ids`), detecção de clássico e `selectCopy` |
| `packages/geo` | Geografia da navegação (`config/geo`): confederações e membros, países do menu, escopo das competições por país (validação + agrupamento) |
| `services/ingestor` | Jobs de bootstrap, sync, live, assets e normalização raw → core; CLIs em `src/cli` |
| `packages/where-to-watch` | Onde assistir determinístico: dicionário de emissoras e tabela de direitos (`config/broadcasters`, `config/broadcast-rights`), validador, versionamento, correção editorial, auditoria e métricas |
| `services/ai-agents` | Camada de LLM independente de provedor (OpenAI/Anthropic, orçamento de tokens) e agentes de IA (onde assistir, cenário, live scheduler, curadoria) |
| `packages/runtime-config` | Flags da operação que mudam sem deploy (banco > env > padrão), editadas em Ajustes na demo |
| `packages/ai-ledger` | Orçamento diário de IA (`ops.llm_usage`): preços, tetos em tokens e US$ e reserva antes de cada chamada |
| `packages/net-guard` | Proteção contra SSRF: use `guardedFetch` para qualquer URL de terceiro |
| `packages/widgets` | Widgets React, item de registry shadcn do Builder e embed `<galaxie-widget>` |
| `apps/api` | API pública (Fastify): `/mirror/...` e `/v1/...` |
| `apps/demo` | Next.js: demo, portal do cliente, Builder e ajustes da operação; dado esportivo só pela API |
| `docs/` | Documentação (pt-BR). Atualize o doc relevante junto com o código |

## Regras

1. **Toda chamada à api-sports passa pelo `ApiSportsClient`** — nunca `fetch` direto. Testes usam `fetch` falso; não gaste cota real em testes.
2. **Banco**: mudou `packages/db/src/schema`? Rode `pnpm db:generate` e commite `drizzle/` (o CI falha se houver drift). Migrations podem ser renumeradas pelo coordenador na hora do merge; a renumerada precisa de `when` (em `drizzle/meta/_journal.json`) maior que o da última migration do `main`, senão o migrator a pula em silêncio num banco que já tem as outras — acerte o `when` ou regere a migration (o CI confere).
3. **Testes**: unitários ao lado do código (`*.test.ts`); integração em `test/` criando um banco descartável a partir de `DATABASE_URL` (ver `packages/db/test`). Sem `.env` (ex.: worktrees), exporte `DATABASE_URL=postgres://galaxie:galaxie@localhost:5433/galaxie_sports`.
4. **Idioma**: código e identificadores em inglês; comentários, docs, mensagens de CLI e de erro voltadas a pessoas em **português**.
5. **Neutralidade**: nenhuma marca de cliente, operadora ou fornecedor interno em código, dados, docs, issues ou commits.
6. **Privacidade**: nunca envie e-mail ou dado pessoal em requisições externas (User-Agent genérico, ex.: `galaxie-sports/0.1`).
7. **Segredos**: só em `.env` (ignorado pelo Git). Nunca commite chaves.
8. **Commits**: mensagem em português, convencional (`feat(escopo): ...`), com `Closes #N` quando fechar issue.
9. **Contrato da API**: mudou `packages/contracts`? O check "contrato OpenAPI" falha com quebra do `/v1` (docs/05 §8); quebra de propósito leva o rótulo `quebra-de-contrato`.
10. **PRs**: um PR por conjunto coeso de issues, descrição com resumo, como testar e o que ficou fora; `Closes #N` para cada issue concluída.
