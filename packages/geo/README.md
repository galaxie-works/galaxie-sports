# @galaxie/geo

Geografia da navegação: confederações e membros, audiência por mercado e o escopo das competições de cada país. Valida
e agrupa a configuração de `config/geo`. Os países do menu não ficam aqui: vêm do catálogo no banco (os que têm liga
nacional de primeira divisão, `@galaxie/explore`), agrupados pelas confederações e ordenados pelo `featured` daqui.

## Como usar

Arquivos: `config/geo/confederations.yaml`, `competition-scope.yaml`, `market-audience.yaml`, lidos de `GEO_CONFIG_DIR`.
O `services/ingestor` grava no banco com `geo:seed`.

Mercados: `markets` (relevância por país) e `wtw_markets` (Onde Assistir, subconjunto de `markets`, um por
dicionário em `config/broadcasters`). O `WTW_MARKET_CODES` do `@galaxie/runtime-config` é o espelho que o painel e o
navegador usam; o teste deste pacote reprova se ele divergir do yaml.

## Depende de

Nenhum pacote do repo em produção; os testes usam `@galaxie/runtime-config` para conferir o espelho dos mercados.

## Usado por

`apps/api`, `services/ingestor`, `services/ai-agents`.
