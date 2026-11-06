# @galaxie/crests

Escudos e logos de times e competições: o que a importação do acervo (`assets:acervo`) e o envio no painel
(Ajustes → Escudos) usam igual.

- `imageInfo`: tipo e dimensões pelos primeiros bytes (PNG, GIF, JPEG, WebP, SVG).
- `paletteFromPng` / `paletteFromSvg`: cores do time a partir do escudo.
- `unsafeSvgReason`: recusa SVG com script, evento, `<foreignObject>` ou link externo.
- `sizedLogos`: PNG e WebP em 64, 128 e 256 px (`sharp`).
- `prepareCrest(kind, id, arquivo)`: confere o arquivo enviado no painel e monta o SVG, o PNG/WebP de 512 px, os
  tamanhos fixos, a paleta e as chaves do storage (`crestStorageKey`, a mesma nomenclatura do acervo). Não grava
  nada: quem chama sobe os objetos e registra com `setPanelCrest` (`@galaxie/db/crests`).

## Depende de

`@galaxie/db` (tipos do asset) e `sharp`.

## Usado por

`services/ingestor` (espelho de mídia, acervo, Commons) e `apps/demo` (Ajustes → Escudos).
