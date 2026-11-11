# @galaxie/cosmos

Carteira de créditos da Cosmos AI (#989, #992): a IA que o cliente liga e paga por uso, com créditos pré-pagos. Toda
função da Cosmos passa por aqui antes e depois de chamar o modelo. As tabelas ficam no schema `cosmos` de
`@galaxie/db`.

Fica fora do `TokenBudget` e do `ops.llm_usage` dos agentes internos: aquele teto soma todos os agentes, e o uso pago por
cliente não pode tirar IA deles. A Cosmos grava em `cosmos.ledger` e tem um teto de segurança próprio.

## Fluxo de uma chamada

```text
reserve ──► chama o modelo ──► settle (valor real)
   │                  └─ falhou ─► release (devolve tudo)
   └─ recusa: no_wallet, wallet_blocked, insufficient_credits, unknown_function, safety_ceiling
```

| Operação | O que faz |
| --- | --- |
| `reserve(db, { tenantId, functionName, estimatedCredits?, scope?, userId? })` | Tira os créditos do saldo livre numa única instrução (`available >= n`), então o saldo nunca fica negativo, mesmo com várias salas ao mesmo tempo. Vale o maior entre a estimativa e o mínimo da função |
| `settle(db, { tenantId, reservationId, costUsd?, credits?, tokens…, model? })` | Acerta pelo valor real: devolve a sobra ou cobra a diferença até o saldo livre (o que passar fica em `metadata.uncharged`). Um lançamento de uso no extrato; na moderação, um por lote |
| `release(db, { tenantId, reservationId })` | Devolve a reserva inteira, sem lançamento |
| `releaseExpired(db)` | Devolve as reservas abertas que passaram do prazo (processo que morreu no meio) |
| `addEntry(db, { tenantId, kind, credits, idempotencyKey })` | Teste, compra, estorno, ajuste, vencimento do teste, mudança de cota, com o saldo antes e depois. Compra e estorno exigem `idempotencyKey` (única por tenant): repetir devolve o lançamento original (`replayed`) sem somar de novo |
| `listLedger(db, tenantId, filtro)` · `ledgerCsv(linhas, { staff })` | Extrato paginado (cursor pelo id) e filtrável por data, sala, função, usuário e tipo; CSV |

Créditos cobrados = maior entre (custo real × multiplicador ÷ valor do crédito) e o mínimo da função (`creditsFor`),
arredondado para cima na terceira casa.

A reserva grava o preço daquele momento (valor do crédito, multiplicador do tenant e mínimo da função), e o `settle` usa só
esse instantâneo: mudar qualquer um deles no meio da chamada não muda o preço dela. Repetir o `settle` de uma reserva
já acertada devolve o mesmo acerto (`replayed`), sem cobrar de novo; repetir o `release` não devolve duas vezes. Reserva
devolvida ou vencida pelo `releaseExpired` não acerta mais (`reservation_closed`).

## Configuração

| Onde | O quê |
| --- | --- |
| `COSMOS_DAILY_USD_CEILING` (runtime setting, seção Cosmos AI) | Teto de segurança do dia UTC: custo real somado de todos os tenants. Alcançou, a reserva recusa com `safety_ceiling` |
| `COSMOS_CREDIT_USD` (runtime setting) | US$ de custo que valem 1 crédito. Sem padrão no código; vazio, cada chamada cobra o mínimo da função |
| `cosmos.wallet.multiplier` | Multiplicador por tenant (padrão 1) |
| `cosmos.function_def` | Catálogo global: mínimo, permissão e tela de cada função (`upsertFunctionDef`) |

O cliente nunca vê tokens, custo real, modelo nem multiplicador: use `toClientEntry`, `toClientWallet` e o CSV sem
`staff` em tudo que chega ao painel do cliente.

## Testes

`pnpm test` (conversão, flags, CSV) e `pnpm test:integration` (concorrência no Postgres; precisa de `DATABASE_URL`).

## Compra pelo Stripe (#993)

| Peça | Onde |
| --- | --- |
| Pacotes (`cosmos.package`) | `listPackages(db, mercado)`, `upsertPackage`. Preço e créditos são dados, nunca código |
| Intenção de compra (`cosmos.purchase_intent`) | `createPurchaseIntent` copia créditos e valor do pacote; `attachCheckoutSession` liga a sessão do Checkout |
| Checkout | `createCheckoutSession(chave, …)`, com Pix e cartão em reais, cartão em dólar, recibo pelo Stripe e chave de idempotência pela intenção |
| Webhook | `verifyStripeSignature` + `applyStripeEvent`, na rota `POST /webhooks/stripe/cosmos` da API |

`applyStripeEvent` grava o evento (`cosmos.stripe_event`, id único), muda a intenção e credita numa transação só. Evento
repetido sai como `duplicate`; intenção já paga não credita de novo (`already_closed`); valor ou moeda diferentes do
esperado não creditam (`amount_mismatch`). No Pix, `checkout.session.completed` chega com `payment_status: unpaid` e o
crédito vem no `checkout.session.async_payment_succeeded`.

Variáveis: `STRIPE_SECRET_KEY` (demo, abre o checkout) e `STRIPE_WEBHOOK_SECRET` (API, confere a assinatura). Sem elas, a
compra fica indisponível e o webhook responde 503.

## Teste, alertas e recarga automática (#994)

| Peça | O que faz |
| --- | --- |
| `enableCosmos(db, tenantId)` · `disableCosmos` | Liga a Cosmos (desligada, nenhuma função reserva: `cosmos_disabled`; o saldo fica): cria a carteira e concede o teste uma única vez (`COSMOS_TRIAL_CREDITS`, padrão 250; `COSMOS_TRIAL_DAYS`, padrão 90). Religar não dá outro teste |
| Teste no saldo | `wallet.trial_remaining`: o uso gasta o teste primeiro. `expireTrials` tira do saldo o que sobrou no vencimento, com lançamento `trial_expiry`. Comprados não vencem |
| Alertas | Cada entrada de créditos abre um ciclo (`cycle_base`). Em 80% e 90% de uso e no saldo zerado, uma linha em `cosmos.balance_alert`, uma vez por limiar por ciclo |
| Saldo zerado | Carteira `blocked` com `block_reason = depleted`; a próxima entrada de créditos libera. Bloqueio da Galaxie é `staff` e só ela libera |
| Recarga automática | `configureAutoRecharge` exige `accepted: true` (fica quem e quando). A compra seguinte salva o cartão (`saveCard`, só cartão). Abaixo do limiar, o acerto abre uma tentativa (uma aberta por vez); `processRecharges` cobra fora da sessão (só cartão, `payment_method_types[0]=card`), só com a recarga ainda ligada e aceita e a carteira ligada e sem bloqueio da equipe (`staff`), e o crédito entra pelo webhook `payment_intent.succeeded`. Recusa definitiva do cartão (402, `card_declined`, `authentication_required`) desliga a recarga com o motivo; 5xx, 409, 429 e rede voltam a tentativa para a fila, com o mesmo cliente e cartão (gravados na tentativa) e a mesma chave de idempotência. Desligar a recarga, mudá-la ou desligar a Cosmos encerra a tentativa pendente que ainda não chamou o Stripe (`cancelled`); a que já chamou segue com a mesma chave (ou, sem aceite, espera o webhook até `RECHARGE_REPLAY_WINDOW_MS`, 24 h). Mudar preço, moeda ou créditos de um pacote (`upsertPackage`) desliga as recargas daquele pacote e retira o aceite (`package_changed`). Todas as chamadas ao Stripe fixam `Stripe-Version` (`STRIPE_API_VERSION`). `reconcileStuckRecharges` destrava a tentativa presa em `processing` há mais de 15 min. Pagamento confirmado credita mesmo com a tentativa já marcada como falha (chave `recharge:<id>`) |

O endpoint do webhook no Stripe (`POST /webhooks/stripe/cosmos`) precisa dos eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded` e `payment_intent.payment_failed`.

O job `cosmos-upkeep` do ingestor (a cada 5 min) roda `releaseExpired`, `expireTrials` e `processRecharges`.

O envio do e-mail ao dono e do webhook (`cosmos.balance.low`, `cosmos.balance.depleted`) lê `cosmos.balance_alert` e
marca `emailed_at`/`webhook_at`; entra com o registro central de tópicos (#1023). A tela (#995) já lê o estado da
carteira.

## Assistente no app (#1003)

`assistant.ts` monta o pedido do assistente que abre pelo ícone da Cosmos no cabeçalho, em qualquer tela do app:

| Peça | O que faz |
| --- | --- |
| `searchDocs` | Busca por palavras na documentação pública (título vale o dobro), sem embeddings nesta etapa |
| `buildPrompt` | Instruções, a tela (rota, título, texto visível, destinos do menu) e os trechos da documentação, delimitados como dado |
| `estimateAssistantCredits` | "Deve gastar cerca de N créditos": a entrada inteira e meia resposta, pelo valor do crédito, nunca abaixo do mínimo |
| `streamAssistant` | Chamada em fluxo ao provedor; no fim, os tokens reais para o acerto |

`askAssistant` (`assistant-run.ts`) faz a pergunta do começo ao fim, e a rota da demo
(`api/cliente/cosmos/assistente`) só cuida da sessão e do fluxo em NDJSON:

- **Limites antes de reservar** (`ASSISTANT_LIMITS`): uma pergunta em andamento e 10 por minuto por pessoa, 60 por
  minuto por tenant, e no máximo 25% do teto diário de segurança da Cosmos gasto por um tenant no assistente.
- **Reserva** da estimativa, que cresce com o tamanho da pergunta e do contexto (`expectedOutputTokens`), com prazo
  maior que a duração máxima da rota.
- **Nada entregue** (falha ou desistência antes do primeiro pedaço): a reserva volta inteira.
- **Algo entregue** (fim normal, falha no meio, "Parar", navegador fechado): acerta pelo usado, com os tokens do
  provedor ou, sem eles, estimados pelo texto mandado. **O acerto nunca passa da reserva** (`maxCredits`): o cliente
  nunca paga mais que o "cerca de N créditos" que viu. Acerto que falha é repetido e, se ainda falhar, vai para o log
  de erro para conciliação.
- **Cache do provedor** só na parte fixa (instruções e documentação); a tela vai depois do ponto de cache. Escrita no
  cache é cobrada a 1,25 vez a entrada comum; leitura, ao preço de cache.
- **Histórico assinado**: a resposta sai com uma assinatura (HMAC com `BETTER_AUTH_SECRET`); só resposta assinada volta
  ao prompt, para o navegador não inventar uma "resposta da Cosmos" que vire instrução.

O cliente vê só créditos, nunca o modelo nem o custo técnico. A equipe Galaxie acompanhando um tenant não pergunta
(não gasta os créditos do cliente), e o tenant precisa do módulo `cosmos_ai` no contrato.

Para ligar: a função `assistant.ask` ativa em `cosmos.function_def` e a chave da Cosmos no provedor dela
(`COSMOS_<PROVEDOR>_API_KEY`, separada das chaves dos agentes internos; hoje `COSMOS_ANTHROPIC_API_KEY`). O mínimo é
o menor que o banco aceita (0,001 crédito, três casas): a pergunta paga o custo real convertido, e um "Olá" não paga
como uma pergunta longa. Sem a função, sem a chave ou com um provedor que o assistente ainda não chama, o painel
responde "indisponível" e nada é reservado. Busca por palavras na documentação, sem embeddings.

### Provedor e modelo por função (#1088)

Cada função do catálogo guarda o provedor (`anthropic`, `openai`, `gemini`, `deepseek`) e o modelo; vazio = o padrão
(Anthropic, modelo leve do registro). A equipe Galaxie troca em Ajustes → Assinaturas e carteiras → Funções da Cosmos,
com motivo (fica em `cosmos.staff_action`). O preço sai da tabela do ai-ledger, e o crédito do custo real: um modelo
mais barato gasta menos créditos do cliente, sem mexer nos pacotes. Modelo sem preço na tabela (com AI_MODEL_PRICES por
cima) é recusado. O assistente chama a Anthropic direto (ponto de cache depois da documentação) e OpenAI, Gemini e
DeepSeek pelo cliente compartilhado `@galaxie/llm` (`ASSISTANT_STREAMERS`); erro no meio do fluxo traz o uso já gasto,
e o acerto cobra o que o provedor cobrou.