# @galaxie/contracts

Contrato da API pública: os DTOs em Zod, o OpenAPI gerado a partir deles e o cliente tipado `createGalaxieClient`.
É a fonte única dos tipos que a API serve e que a demo e os widgets consomem.

## Como usar

```bash
pnpm --filter @galaxie/contracts build
node packages/contracts/scripts/openapi-dump.mjs   # imprime o OpenAPI (usado pelo check "contrato OpenAPI")
```

Uma quebra do `/v1` falha o check do CI (docs/05 §8); quebra de propósito leva o rótulo `quebra-de-contrato`.

## Depende de

Nenhum pacote do repo (só `zod` e `zod-openapi`).

## Usado por

`apps/api`, `apps/demo`, `services/ingestor`, `services/ai-agents`. É o principal candidato a SDK público ([docs/15 §6](../../docs/15-organizacao-do-monorepo.md#6-candidatos-a-repositório-próprio)).
