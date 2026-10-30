# @galaxie/geo

Geografia da navegação: confederações e membros, países do menu, audiência por mercado e o escopo das competições de
cada país. Valida e agrupa a configuração de `config/geo`.

## Como usar

Arquivos: `config/geo/confederations.yaml`, `competition-scope.yaml`, `market-audience.yaml`, lidos de `GEO_CONFIG_DIR`.
O `services/ingestor` grava no banco com `geo:seed`.

## Depende de

Nenhum pacote do repo.

## Usado por

`apps/api`, `services/ingestor`, `services/ai-agents`.
