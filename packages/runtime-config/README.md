# @galaxie/runtime-config

Registro das flags da operação que mudam sem deploy (status da IA por agente, orçamentos, crons, nível mínimo de
revisão das grades). Resolve cada valor por precedência **banco > variável de ambiente > padrão** e valida pelo tipo.

## Como usar

Os valores gravados no banco ficam em `ops.runtime_setting` (com histórico em `ops.runtime_setting_log`) e são editados em **Ajustes** na demo. A política de IA vem
de `config/ai-policy.yaml`. Para ver uma flag nova na tela, registre-a em `src/registry.ts`.

O catálogo do espelho da api-sports (`sync:mirror`) fica em `src/mirror.ts`: período padrão de cada endpoint por tier,
grupos de prioridade e orçamento, com a validação das flags `MIRROR_*`. O job, o painel e o mapa de frescor do alerta
`RawEndpointOverdue` leem dali (docs/03 §11.5).

## Depende de

Nenhum pacote do repo (só `croner`).

## Usado por

`apps/api`, `apps/demo`, `services/ingestor`, `services/ai-agents`, `ai-ledger`, `observability`.
