# @galaxie/explore

O resumo da home "Explorar" (`GET /v1/explore/summary`, [docs/05 §3.1.2](../../docs/05-api-publica.md)) sem idioma,
sem tenant e sem imagens: contadores por esporte e por país, competições e clubes em destaque, liga principal, o jogo
de maior relevância e os anunciados de cada país. A conta pesada (um ano de jogos para os clubes em destaque e as
competições com jogos recentes) sai do caminho da requisição (#596): o job `explore-summary` do
[ingestor](../../services/ingestor/README.md) grava o resultado em `core.explore_summary`, e a
[API](../../apps/api/README.md) lê numa consulta só e junta nomes, logos e os eventos dos destaques por id.

## O que tem

- `choices`: as escolhas em funções puras (`rankTopCompetitions`, `pickMainCompetition`, `countryActivity`,
  `announcedCandidates`, `pickAnnounced`, `compareHighlight`). A relevância sai com os códigos e os pontos dos motivos;
  os textos, no idioma pedido, são da API.
- `window`: a janela de 7 dias e `selectWindowEvents`, a consulta dos jogos que o resumo e a agenda
  (`/v1/explore/agenda`) usam, para os dois contarem igual.
- `market`: o bônus de mercado da relevância (docs/06 §3.2) que a API e o resumo pré-calculado precisam dar igual.
- `live`: o que conta como "ao vivo de verdade" (`actuallyLiveCond`, `IN_PLAY`).
- `snapshot`: `computeExploreSnapshot` (a conta inteira, sem recorte de plano) e `selectForScope` (o recorte de esportes
  do plano do tenant: os jogos de cada país ficam separados por esporte, e somar os do plano dá a mesma conta).
- `store`: gravação (`saveExploreSnapshot`, troca tudo numa transação), leitura (`loadExploreSnapshot`) e
  `exploreRefreshReason`, que diz ao job se precisa recalcular.

## Quando recalcula

O job roda a cada minuto e só faz a conta quando: não há resumo (ou é de outra `EXPLORE_SNAPSHOT_VERSION`), o resumo
passou de 10 min (`EXPLORE_REFRESH_MS`), ou, passado o freio desde a última conta, o change feed trouxe mudança de jogo
(status, importância recalculada, jogo anunciado) ou entrou jogo novo na janela (o jogo novo do fornecedor não passa
pelo change feed).

O freio é `EXPLORE_MIN_INTERVAL_SEC` (painel › Agenda, padrão 180 s, 0 = sem freio; `exploreMinIntervalMs`): com jogo
ao vivo algum status muda quase todo minuto, e sem o freio a conta inteira (a janela de jogos, uns 2,7 s no banco de
dev) rodava quase a cada minuto. A mudança que chega dentro do freio não se perde: a checagem olha desde a última
conta, então ela entra assim que o freio passa (a home atrasa no máximo isso). Sem nada a fazer, a decisão é a linha de
controle, o change feed pelo índice de `created_at` e, só quando ele não disparou, o jogo novo pelo índice
`event_created_at_idx` (migration 0190): frações de milissegundo. A API usa o
pré-calculado mesmo velho: acima de 30 min (`EXPLORE_MAX_AGE_MS`) registra um aviso e segue servindo; só acima de 24 h
(`EXPLORE_STALE_MAX_AGE_MS`), ou sem ele, faz a mesma conta na requisição (a consulta pesada: `topTeams` mediu 24,6 s na
produção em 17/11, acima do `statement_timeout` de 10 s da API). A idade aparece em `galaxie_explore_summary_age_seconds` no `/metrics` da API (alerta `ExploreSummaryStale`).

## Como usar

```ts
import { computeExploreSnapshot, loadExploreSnapshot, saveExploreSnapshot, selectForScope } from '@galaxie/explore';

await saveExploreSnapshot(db, await computeExploreSnapshot(db, geo, new Date())); // ingestor
const selection = selectForScope((await loadExploreSnapshot(db))!, geo.navigationCountries, tenantSports); // API
```

```bash
pnpm --filter @galaxie/explore test
pnpm --filter @galaxie/ingestor explore:summary --forcar   # recalcula agora
```

O que depende do banco é testado em `tests/integration/test/explore.integration.test.ts` (o job grava, a API lê o mesmo
corpo que calcularia na hora).

## Depende de

`@galaxie/db`, `@galaxie/geo`, `@galaxie/contracts` e `@galaxie/providers` (o frescor do ao vivo). Camada de
**domínio** (ver [docs/15](../../docs/15-organizacao-do-monorepo.md)).

## Usado por

`apps/api`, `services/ingestor`.
