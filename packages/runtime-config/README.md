# @galaxie/runtime-config

Registro das flags da operação que mudam sem deploy (status da IA por agente, orçamentos, crons, nível mínimo de
revisão das grades). Resolve cada valor por precedência **banco > variável de ambiente > padrão** e valida pelo tipo.

## Como usar

Os valores gravados no banco ficam em `ops.runtime_setting` (com histórico em `ops.runtime_setting_log`) e são editados em **Ajustes** na demo. A política de IA vem
de `config/ai-policy.yaml`. Para ver uma flag nova na tela, registre-a em `src/registry.ts`.

## Depende de

Nenhum pacote do repo (só `croner`).

## Usado por

`apps/api`, `apps/demo`, `services/ingestor`, `services/ai-agents`, `ai-ledger`, `observability`.
