# @galaxie/ingestor

Tudo o que traz dado para dentro do banco: o espelho da api-sports (raw), a normalização para o modelo canônico (core),
o ao vivo, os assets e as fontes abertas (Wikidata, Wikimedia Commons, F1DB, hipismo). Roda como um **scheduler** de
longa duração que dispara os CLIs deste pacote em horários fixos.

Estratégia de cota e jobs: [docs/03](../../docs/03-ingestao-e-economia-de-chamadas.md) · Ao vivo:
[docs/07 §2.1](../../docs/07-ia-tempo-real-e-enriquecimento.md#21-live-scheduler-o-agendamento-inteligente).

## Como rodar

```bash
pnpm infra:up && pnpm build && pnpm db:migrate      # na raiz
pnpm --filter @galaxie/ingestor quota                # cota do dia (não gasta cota)
pnpm --filter @galaxie/ingestor sync:daily --plan    # mostra o que gastaria, sem chamar
pnpm --filter @galaxie/ingestor scheduler            # o agendador, como na VPS
```

Sem `APISPORTS_KEY`, o cliente entra em modo offline e só lê o raw (bom para dev com `pnpm snapshot:restore`).
Os jobs de cota aceitam `--plan`, `--max-chamadas N`, `--sem-live` e `--forcar`, e retomam de onde pararam.

## CLIs por área

A lista completa, com o que cada um faz, está na tabela "Como rodar" do [README da raiz](../../README.md#como-rodar).

| Área | Comandos |
|---|---|
| Cota e raw | `quota`, `raw:import`, `raw:compactar-historico`, `snapshot:export`, `snapshot:import`, `data:retention`, `change-feed:prune` |
| Bootstrap e sync (api-sports) | `bootstrap:catalog`, `bootstrap:seasons`, `bootstrap:details`, `bootstrap:people`, `bootstrap:perfis`, `bootstrap:sports`, `sync:daily`, `mma`, `fixture-people` |
| Normalização raw → core | `normalize:football`, `normalize:sports`, `names:derive`, `standings:recompute`, `standings:limpar-grupo-vazio`, `pessoas:separar-tecnicos` |
| Evento e ao vivo | `events:clock`, `events:importance`, `live:run`, `live:reconcile`, `live:simulate`, `postgame:close`, `provisional:sync` |
| Assets e imagens | `assets:mirror`, `assets:palette`, `assets:acervo`, `assets:commons*`, `assets:competition-logos`, `assets:official-logos`, `assets:platform-logos`, `assets:fotos-wikidata` |
| Fontes abertas | `multisport:seed`, `multisport:wikidata`, `multisport:qa`, `titulos:wikidata`, `pessoas:wikidata-por-time`, `canais:wikidata`, `f1db:import`, `f1:biografia`, `equestrian:import`, `geo:seed` |
| Qualidade | `quality:run` (confere a API publicada; `QUALITY_API_URL` + `QUALITY_API_KEY`) |
| Agendador | `scheduler` |

## Scheduler e o perfil `agents`

`src/scheduler/schedule.ts` define os jobs. `SCHEDULER_PROFILE=ingestor` (padrão) roda ingestão, normalização, ao vivo e
manutenção. `SCHEDULER_PROFILE=agents` roda só os agentes de IA, executando os CLIs de
[`services/ai-agents`](../ai-agents/README.md) pelo caminho `../ai-agents`. Por isso a imagem do ingestor empacota os
dois pacotes, e a VPS sobe a mesma imagem duas vezes (`ingestor` e `agents`). Essa dependência não aparece no
`package.json` (ver [docs/15 §5, F4](../../docs/15-organizacao-do-monorepo.md#5-fronteiras-confusas-hoje)).

## Depende de

- **Pacotes**: `apisports-client` (única saída para a api-sports), `db`, `providers`, `rules`, `knowledge`,
  `where-to-watch`, `geo`, `contracts`, `runtime-config`, `ai-ledger`, `net-guard`, `observability`.
- **Serviços**: Postgres, S3 (assets) e a api-sports (`APISPORTS_KEY`, `APISPORTS_PLAN_*`).
- **Arquivos**: `config/competitions`, `config/rules`, `config/geo`, `config/fixtures`, `config/assets`, `data/knowledge`
  (a imagem recria o layout em `/srv`; ver [config/README.md](../../config/README.md)).

## Deploy

Imagem `galaxie-sports-ingestor` (`Dockerfile`, build a partir da raiz). Na VPS: serviços `ingestor` e `agents`.
