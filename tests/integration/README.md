# tests/integration

Testes de integração que cruzam a API e o ingestor: o ingestor (normalização, `upsertBatch`, seed de geografia e de
multiesporte, Live Poller, sync de provisórios) semeia o core, e a API serve esses dados em `/v1` e `/mirror`.

São seis arquivos: `events`, `explore`, `live-sse`, `navigation`, `provisional` e `semantic-multisport`. Cada um cria o
próprio banco temporário (`galaxie_test_<hex>`) e o prefixo de chaves do Valkey, então rodam em paralelo sem se tocar.

## Por que ficam aqui e não em `apps/api`

O `pnpm --filter "@galaxie/api..."` do `apps/api/Dockerfile` compila tudo de que a API depende, inclusive as
`devDependencies`. Com o `@galaxie/ingestor` na API, qualquer merge só no ingestor reconstruía e trocava a imagem da
API (#563). Este pacote é uma folha do grafo: depende dos dois, ninguém depende dele, e a entrada de nenhuma imagem o
inclui (`infra/ops/image-inputs.mjs`).

## Como roda

```bash
pnpm infra:up                      # Postgres, Valkey e S3 locais (ou o .env apontando para o NAS)
pnpm test:integration              # todos os pacotes, esta pasta inclusa (o turbo compila as dependências antes)
pnpm --filter @galaxie/integration-tests test:integration
```

Para um arquivo só, dentro desta pasta: `npx vitest run --dir test live-sse`. Precisa de `DATABASE_URL` (o
`vitest.config.ts` lê o `.env` da raiz quando a variável não está no ambiente) e de que `@galaxie/api` e
`@galaxie/ingestor` estejam compilados (`pnpm turbo run build --filter=@galaxie/integration-tests^...`).

`test/sse-client.ts` é uma cópia do cliente SSE de `apps/api/test`, que o teste de realtime da API continua usando.
