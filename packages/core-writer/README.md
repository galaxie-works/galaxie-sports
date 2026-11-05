# @galaxie/core-writer

Grava no core o lote neutro que os provedores produzem (`NormalizedBatch`, de `@galaxie/providers`). É o único caminho de
escrita do modelo normalizado: o [ingestor](../../services/ingestor/README.md) alimenta o banco por ele, e os testes de
integração que precisam de um cenário no core (agentes de IA, API) semeiam pelo mesmo `upsertBatch`, sem importar o
serviço.

## O que tem

- `upsertBatch` / `upsertBatchInTx`: grava esportes, países, competições, temporadas, participantes, locais, eventos e
  estatísticas de forma idempotente, com a política de precedência entre provedores e o `derby_id` do clássico.
- `event-state`: máquina de estados do evento no banco (`advanceEventClock`, `applyProviderFailure`) e o log de transições.
- `importance-facts`: os fatos de que a importância do jogo é feita (mata-mata, clássico, regulamento).
- `match`: junção do jogo provisório da curadoria com o oficial quando o fornecedor o publica.
- `placeholder-logos`: o que conta como imagem ausente (escudos genéricos, foto de pessoa) para a normalização não religar.
- `sql-helpers`, `uuidv7`, `slugify`, `tidyParticles`: apoio de SQL em lote, identidade e nomes.

## Como usar

```ts
import { upsertBatch } from '@galaxie/core-writer';
import { normalizeFixtures } from '@galaxie/providers';

await upsertBatch(db, normalizeFixtures(fixtures, new Date()));
```

```bash
pnpm --filter @galaxie/core-writer test
```

O que depende do banco é testado nos testes de integração de quem usa (`services/ingestor/test`, `services/ai-agents/test`,
`tests/integration`).

## Depende de

`@galaxie/db`, `@galaxie/providers`, `@galaxie/rules`, `@galaxie/knowledge`, `@galaxie/observability` e
`@galaxie/apisports-client` (só tipos). Camada de **domínio** (ver [docs/15](../../docs/15-organizacao-do-monorepo.md)).
