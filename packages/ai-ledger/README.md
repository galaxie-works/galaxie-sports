# @galaxie/ai-ledger

Livro-caixa diário da IA (`ops.llm_usage`): tabela de preços por modelo, tetos em tokens e em US$ por agente e a
**reserva antes de cada chamada**, para que nenhum agente passe do orçamento do dia mesmo rodando em paralelo.

## Como usar

Política em `config/ai-policy.yaml` (`AI_POLICY_FILE`); tetos e status também via `@galaxie/runtime-config`
(`AI_DAILY_TOKEN_BUDGET`, `AI_AGENT_USD_BUDGETS`, `AI_AGENT_STATUS`). Ver [docs/07](../../docs/07-ia-tempo-real-e-enriquecimento.md).

## Depende de

`@galaxie/db`, `@galaxie/runtime-config`.

## Usado por

`services/ai-agents`, `services/ingestor`.
