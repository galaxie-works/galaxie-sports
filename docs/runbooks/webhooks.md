# Webhooks para clientes: operação

O worker `webhooks` (stack da VPS, `infra/vps-telemetry/compose.yml`) lê o `ops.change_feed`, cria uma entrega por
mudança × endpoint e faz o POST assinado. Contrato para o cliente: [docs/05 §5.2](../05-api-publica.md) e a página
pública `/docs/tempo-real`. Segurança e formato do segredo: [SECURITY.md › Webhooks](../../SECURITY.md#webhooks).

Todos os comandos abaixo rodam na VPS, na pasta da stack:

```bash
cd /docker/galaxie-sports
wh() { docker compose run --rm --no-deps -T webhooks node dist/cli/webhook.js "$@"; }
wh list
```

`wh` usa a imagem e o ambiente do próprio worker: a KEK (`WEBHOOK_SIGNING_SECRET`) e o `DATABASE_URL` vêm do
`.env`. O script `webhooks/ligar-webhooks.sh` da pasta do projeto faz a primeira ligação (KEK, cifra e teste).

## Ligar na produção (uma vez)

1. Gere a KEK e guarde-a no cofre de senhas **antes** de pôr no `.env` (sem ela os segredos cifrados não abrem, e
   ela não vai para o repositório nem para o backup do banco):
   `openssl rand -base64 32`.
2. `WEBHOOK_SIGNING_SECRET=<kek>` no `.env` e `docker compose up -d --no-deps webhooks demo`. O log do worker deixa
   de mostrar o aviso `WEBHOOK_SIGNING_SECRET não definida`.
3. `wh seal-secrets` (idempotente): cifra os endpoints legados em texto puro, se houver.
4. Depois de `seal-secrets` sem falhas: `WEBHOOK_REJECT_PLAINTEXT_SECRETS=true` no `.env` e suba o worker de novo.
5. Teste com um receptor seu (ex.: um endpoint de teste do webhook.site) num tenant de teste:
   `wh create --tenant <slug> --url https://... --topics score,status`, depois **Enviar teste** no portal
   (`/cliente/webhooks`) ou espere um gol. `wh list` mostra pendentes e DLQ.

A demo também recebe a KEK: é ela que cadastra e rotaciona o segredo no portal do cliente.

## Cadastrar para um cliente

O cliente cadastra sozinho em `/cliente/webhooks` (URL, tópicos, filtros; o segredo aparece uma vez). Pela CLI:

```bash
wh create --tenant <slug> --url https://cliente.example/hooks/galaxie --topics score,status,incidents \
  [--competitions <ids>] [--events <ids>] [--sports football] [--description "<texto>"]
```

O tenant precisa de plano com tempo real (trial não recebe). Mande o segredo por canal seguro, nunca por e-mail
aberto.

## Alertas

| Alerta | Quer dizer | O que fazer |
|---|---|---|
| `WebhookWorkerDown` | Entrega vencida há mais de 5 min sem o worker pegar | [Worker parado](#worker-parado) |
| `WebhookDeadLetters` | A DLQ de um endpoint cresceu na última hora | [DLQ](#dlq) |
| `WebhookEndpointFailing` | Endpoint ativo com 5+ falhas desde o último sucesso, há 15 min | [Endpoint falhando](#endpoint-falhando) |
| `WebhookDeliverySlow` | p95 da mudança à entrega acima de 30 s por 15 min (meta 5 s) | [Lento](#lento) |
| `ChangeFeedStalled` com `consumer="webhooks:default"` | O enfileirador não avança no change feed | Igual ao worker parado |

Métricas (no `/metrics` da API, com rótulos `endpoint` e `tenant`): `galaxie_webhook_pending`,
`galaxie_webhook_dead`, `galaxie_webhook_delivered_last_hour`, `galaxie_webhook_failed_last_hour`,
`galaxie_webhook_consecutive_failures`, `galaxie_webhook_delivery_latency_p95_seconds`,
`galaxie_webhook_endpoint_active` e, sem rótulo, `galaxie_webhook_overdue_seconds`.

### Worker parado

```bash
docker compose ps webhooks
docker compose logs --since 30m webhooks | tail -50
docker compose up -d --no-deps webhooks
```

`falha no ciclo` com erro de conexão: o banco recusou (veja o Postgres). Sem logs novos e contêiner `Up`: reinicie.
As entregas não se perdem: ficam `pending` e saem quando o worker volta.

### DLQ

Uma entrega vai para a DLQ depois de 10 tentativas sem 2xx (cerca de 1h30), ou na hora quando o endpoint foi
desativado, o tenant suspenso ou o plano passou a trial.

```bash
wh dlq --id <endpoint>            # motivo (HTTP, timeout, BlockedTargetError, WebhookSecretError)
wh replay --id <endpoint>         # depois de o cliente corrigir o receptor
```

`WebhookSecretError`: a KEK do `.env` não abre o segredo (KEK trocada sem a antiga na lista). Volte a KEK antiga
como segunda da lista (`nova,antiga`), suba o worker e rode `wh replay`.

### Endpoint falhando

Veja o erro em `wh dlq --id <endpoint>` e avise o cliente (o receptor dele responde fora de 2xx ou não responde em
10 s). Se ele não responder e o endpoint só gerar ruído: `wh disable --id <endpoint>`; quando ele corrigir,
`wh enable --id <endpoint>` e `wh replay --id <endpoint>`.

### Lento

Quase sempre é o receptor do cliente perto dos 10 s de timeout, o que dispara retentativas. Confira
`galaxie_webhook_failed_last_hour` do endpoint. Se todos os endpoints estão lentos ao mesmo tempo, veja CPU e memória
do contêiner `webhooks` (`docker stats --no-stream webhooks`).

## Rotacionar o segredo de um cliente

No portal, **Rotacionar segredo** gera um novo e o mostra uma vez; o antigo deixa de valer na hora, então combine o
momento com o cliente. Pela CLI não há rotação: desative o endpoint e cadastre outro.

## Trocar a KEK

1. Gere a nova e guarde no cofre.
2. `.env`: `WEBHOOK_SIGNING_SECRET=<nova>,<antiga>` (a primeira cifra, todas decifram). Suba `webhooks` e `demo`.
3. `wh seal-secrets` (recifra tudo com a nova).
4. Tire a antiga do `.env` e suba de novo.

## Rollback

Um worker anterior ao #333 assinaria com a string `enc:v1:...` como segredo e todas as assinaturas sairiam
inválidas. Não volte o worker para antes do #333; se for preciso voltar a API inteira, desligue o worker
(`docker compose stop webhooks`) até a volta terminar. As entregas esperam como `pending`.
