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
| `addEntry(db, { tenantId, kind, credits })` | Teste, compra, estorno, ajuste, vencimento do teste, mudança de cota, com o saldo antes e depois |
| `listLedger(db, tenantId, filtro)` · `ledgerCsv(linhas, { staff })` | Extrato paginado (cursor pelo id) e filtrável por data, sala, função, usuário e tipo; CSV |

Créditos cobrados = maior entre (custo real × multiplicador ÷ valor do crédito) e o mínimo da função (`creditsFor`),
arredondado para cima na terceira casa.

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
| Webhook | `verifyStripeSignature` + `applyStripeEvent`, na rota `POST /internal/cosmos/stripe/webhook` da API |

`applyStripeEvent` grava o evento (`cosmos.stripe_event`, id único), muda a intenção e credita numa transação só. Evento
repetido sai como `duplicate`; intenção já paga não credita de novo (`already_closed`); valor ou moeda diferentes do
esperado não creditam (`amount_mismatch`). No Pix, `checkout.session.completed` chega com `payment_status: unpaid` e o
crédito vem no `checkout.session.async_payment_succeeded`.

Variáveis: `STRIPE_SECRET_KEY` (demo, abre o checkout) e `STRIPE_WEBHOOK_SECRET` (API, confere a assinatura). Sem elas, a
compra fica indisponível e o webhook responde 503.
