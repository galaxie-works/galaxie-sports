# @galaxie/geo

Geografia da navegação: confederações e membros, audiência por mercado e o escopo das competições de cada país. Valida
e agrupa a configuração de `config/geo`. Os países do menu não ficam aqui: vêm do catálogo no banco (os que têm liga
nacional de primeira divisão, `@galaxie/explore`), agrupados pelas confederações e ordenados pelo `featured` daqui.

## Como usar

Arquivos: `config/geo/confederations.yaml`, `competition-scope.yaml`, `market-audience.yaml`, lidos de `GEO_CONFIG_DIR`.
O `services/ingestor` grava no banco com `geo:seed`.

## Depende de

Nenhum pacote do repo.

## Usado por

`apps/api`, `services/ingestor`, `services/ai-agents`.
