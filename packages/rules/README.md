# @galaxie/rules

Motor de regras determinístico: calcula a classificação localmente (critérios de desempate, zonas, grupos) e o
contexto competitivo de cada jogo ("avança com empate", "precisa vencer por dois gols"). É a base factual que o agente
de cenário só redige.

## Como usar

Os regulamentos ficam em `config/rules/*.yaml` (um por competição, mais `default.yaml`), lidos de `RULES_CONFIG_DIR`.
Rótulos e convenções: [docs/rules](../../docs/rules/README.md).

```bash
pnpm --filter @galaxie/rules test
pnpm --filter @galaxie/rules docs:labels   # regera docs/rules/rotulos.md
```

## Depende de

`@galaxie/db`.

## Usado por

`apps/api`, `services/ingestor`, `services/ai-agents`.
