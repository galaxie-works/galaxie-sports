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
`.env`. O script [`infra/vps-telemetry/ligar-webhooks.sh`](../../infra/vps-telemetry/ligar-webhooks.sh) era a primeira
ligação à mão (KEK, cifra e teste); hoje o deploy e o worker fazem isso sozinhos (abaixo).

## Ligar na produção

Não tem passo manual (#360):

1. O deploy gera a KEK (`WEBHOOK_SIGNING_SECRET`) no `.env` da VPS quando ela falta (`ensure-secrets.sh`, junto dos
   outros segredos internos) e nunca troca a que já existe. Na primeira vez, a saída do deploy avisa
   `WARN  WEBHOOK_SIGNING_SECRET nova`: vale guardar uma cópia no cofre de senhas, mas perder a chave não é desastre:
   o deploy gera outra, e cada cliente rotaciona o segredo do webhook dele no portal.
2. Dois minutos depois da subida (a troca lado a lado já terminou), o worker cifra os segredos legados em texto puro
   (e recifra os de uma KEK antiga), e tenta de novo a cada 15 s se algo falhar. Com tudo cifrado, a
   recusa de segredo sem cifra passa a valer sozinha. O painel (Ajustes → Webhooks) e
   `WEBHOOK_REJECT_PLAINTEXT_SECRETS` no `.env` ainda mandam quando gravados.
3. A demo recebe a mesma KEK: é ela que cadastra e rotaciona o segredo no portal do cliente.

Se mesmo assim a KEK faltar (o deploy não conseguiu gerar), o início de Ajustes mostra a credencial faltando, o portal
do cliente diz que o cadastro está indisponível e Ajustes → Webhooks mostra "Chave de cifra no worker" desligada.

Para testar com um receptor seu (ex.: um endpoint de teste do webhook.site) num tenant de teste:
`wh create --tenant <slug> --url https://... --topics score,status`, depois **Enviar teste** no portal
(`/cliente/webhooks`) ou espere um gol. `wh list` mostra pendentes e DLQ.

## Ajustes → Webhooks (painel de admin)

- **Situação:** chave de cifra no worker (o worker relata em `ops.runtime_env`, serviço `webhooks`, a cada 15 s;
  é também o sinal de vida dele no painel) e no painel, worker no ar, webhooks cadastrados, fila, DLQ e segredos
  sem cifra.
- **Entregas ligadas:** a pausa geral. Desligada, o worker segue enfileirando, mas não envia nada; as entregas ficam
  `pending`, sem gastar tentativa nem ir para a DLQ, e saem quando religar. Use num incidente (ex.: payload errado
  saindo para os clientes). Com a pausa, `galaxie_webhook_delivery_paused` = 1 e o `WebhookWorkerDown` não dispara.
- **Recusar segredo sem cifra** e **Cifrar segredos antigos:** os passos 3 e 4 acima.
- A KEK nunca é criada nem trocada pelo painel: gravada no banco, ela ficaria ao lado dos segredos que protege.

Os controles ficam em `ops.runtime_setting` (`WEBHOOK_DELIVERY`, `WEBHOOK_REJECT_PLAINTEXT_SECRETS`), com histórico
em `ops.runtime_setting_log`.

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
| `WebhookWorkerDown` | Entrega vencida há mais de 5 min sem o worker pegar (fora da pausa do painel) | [Worker parado](#worker-parado) |
| `WebhookDeadLetters` | A DLQ de um endpoint cresceu na última hora | [DLQ](#dlq) |
| `WebhookEndpointFailing` | Endpoint ativo com 5+ falhas desde o último sucesso, há 15 min | [Endpoint falhando](#endpoint-falhando) |
| `WebhookDeliverySlow` | p95 da mudança à entrega acima de 30 s por 15 min (meta 5 s) | [Lento](#lento) |
| `ChangeFeedStalled` com `consumer="webhooks:default"` | O enfileirador não avança no change feed | Igual ao worker parado |

Métricas (no `/metrics` da API, com rótulos `endpoint` e `tenant`): `galaxie_webhook_pending`,
`galaxie_webhook_dead`, `galaxie_webhook_delivered_last_hour`, `galaxie_webhook_failing_deliveries_last_hour`,
`galaxie_webhook_consecutive_failures`, `galaxie_webhook_delivery_latency_p95_seconds`,
`galaxie_webhook_endpoint_active` e, sem rótulo, `galaxie_webhook_overdue_seconds` e `galaxie_webhook_delivery_paused`.

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

**Circuit breaker.** O worker desativa sozinho o endpoint que passa 24 h só falhando (nenhuma entrega com sucesso
desde a primeira falha) e com pelo menos 3 entregas na DLQ nesse período. O portal do cliente mostra "Desativado por
falhas", com quando e o último erro, e o log do worker registra `endpoint desativado pelo circuit breaker`. Reativar
(pelo portal, `wh enable` ou o painel) zera a marca; depois, `wh replay` reenvia a DLQ. Falha nossa (segredo que não
abre sem a KEK) não conta. `WEBHOOK_BREAKER_HOURS` muda o prazo (0 desliga).

**Rate limit por endpoint.** Cada endpoint recebe no máximo 600 entregas por minuto por worker; acima disso a entrega
espera a próxima janela sem gastar tentativa. `WEBHOOK_ENDPOINT_RATE_PER_MIN` muda o teto (0 desliga).

### Lento

Quase sempre é o receptor do cliente perto dos 10 s de timeout, o que dispara retentativas. Confira
`galaxie_webhook_failing_deliveries_last_hour` do endpoint. Se todos os endpoints estão lentos ao mesmo tempo, veja CPU e memória
do contêiner `webhooks` (`docker stats --no-stream webhooks`).

## Rotacionar o segredo de um cliente

No portal, **Rotacionar segredo** gera um novo e o mostra uma vez; o antigo deixa de valer na hora, então combine o
momento com o cliente. Pela CLI não há rotação: desative o endpoint e cadastre outro.

## Trocar a KEK

1. Gere a nova e guarde no cofre.
2. `.env`: `WEBHOOK_SIGNING_SECRET=<nova>,<antiga>` (a primeira cifra, todas decifram). Suba `webhooks` e `demo`.
3. `wh seal-secrets` (recifra os segredos dos webhooks com a nova).
4. Tire a antiga do `.env` e suba de novo.
5. A mesma KEK cifra o token das sugestões do app, que o `seal-secrets` não recifra: cole-o de novo em Ajustes → Plataforma
   → Sugestões e reportes ([runbook](sugestoes-do-app.md)).

## Rollback

Um worker anterior ao #333 assinaria com a string `enc:v1:...` como segredo e todas as assinaturas sairiam
inválidas. Não volte o worker para antes do #333; se for preciso voltar a API inteira, desligue o worker
(`docker compose stop webhooks`) até a volta terminar. As entregas esperam como `pending`.
