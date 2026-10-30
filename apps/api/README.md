# @galaxie/api

API pública do Galaxie Sports (Fastify). É a única porta de entrada dos clientes e da demo para os dados.

| Rota | O que entrega | Doc |
|---|---|---|
| `/mirror/{sport}/...` | Espelho da api-sports com o mesmo envelope de resposta, servido do raw (zero cota) | [docs/05 §2](../../docs/05-api-publica.md) |
| `/v1/...` | Modelo canônico: eventos, competições, times, pessoas, onde assistir, contexto, semântica, busca | [docs/05](../../docs/05-api-publica.md) |
| `/v1/stream` | Tempo real por SSE | [docs/05 §5](../../docs/05-api-publica.md) |
| `/internal/admin/*` | Onboarding de tenants, chaves e uso (chave administrativa) | [docs/05 §1.2](../../docs/05-api-publica.md#12-onboarding-autoatendimento-e-uso) |
| `/docs` | Referência interativa gerada do OpenAPI de `@galaxie/contracts` | — |
| `/metrics` | Prometheus (protegido por `METRICS_TOKEN`; fora do roteador público) | [docs/14](../../docs/14-slos-e-error-budget.md) |

## Como rodar

```bash
pnpm infra:up && pnpm build && pnpm db:migrate        # na raiz
pnpm --filter @galaxie/api tenant:create --slug demo-local   # imprime a chave (x-galaxie-key)
pnpm --filter @galaxie/api dev                        # http://localhost:8080 (API_PORT)
```

| Comando | O que faz |
|---|---|
| `dev` · `start` | Servidor em modo dev (recompila) ou a partir do `dist` |
| `tenant:create --slug <slug>` | Cria/atualiza um tenant a partir de `config/plans.yaml` e gera uma chave |
| `admin:key` | Gera uma chave administrativa e o hash para `ADMIN_KEY_HASHES` |
| `webhooks:worker` | Worker que enfileira (a partir do `ops.change_feed`) e entrega os webhooks assinados |
| `webhook create\|list\|dlq\|replay\|seal-secrets` | Administração dos webhooks |
| `keys:migrate` | Migração das chaves antigas ([runbook](../../docs/runbooks/migracao-de-chaves.md)) |
| `f1:auditoria` | Auditoria dos perfis de pilotos da F1 |

## Organização

`src/server.ts` monta o Fastify; `src/routes/{mirror,v1,internal}` têm as rotas; `auth`, `rate-limit.ts`, `cache`,
`security` e `usage` cuidam de chave, limite, cache em Valkey, cabeçalhos e medição por tenant; `realtime` é o SSE;
`webhooks` é o worker; `cli` são os comandos acima.

## Depende de

- **Pacotes**: `db`, `contracts` (DTOs e OpenAPI), `providers`, `rules`, `knowledge`, `where-to-watch`, `geo`,
  `runtime-config`, `observability`, `apisports-client` (só para ler o raw e o plano; a API **não** chama a api-sports).
- **Serviços**: Postgres (`DATABASE_URL`) e Valkey (`REDIS_URL`). Os dados chegam pelo `services/ingestor`.
- **Arquivos**: `config/plans.yaml`, `config/rules`, `config/assets/denylist.yaml`, `data/knowledge` (via
  `PLANS_CONFIG_PATH`, `RULES_DIR`, `MEDIA_DENYLIST_PATH`, `KNOWLEDGE_DIR`).
- **Variáveis principais**: `DATABASE_URL`, `REDIS_URL`, `ASSETS_PUBLIC_BASE_URL`, `CORS_ORIGINS`, `TRUST_PROXY`,
  `STREAM_TOKEN_SECRET`, `WEBHOOK_SIGNING_SECRET`, `ADMIN_KEY_HASHES`, `METRICS_TOKEN`. Lista completa em `.env.example`.

## Deploy

Imagem `galaxie-sports-api` (`Dockerfile`, build a partir da raiz). Na VPS ela roda `api`, `api-candidate` e o
`migrate` (aplica as migrations antes de subir a nova versão). Ver [infra/README.md](../../infra/README.md).

Mudou um DTO? O check "contrato OpenAPI" do CI compara com o `main` (CONTRIBUTING, regra 9).
