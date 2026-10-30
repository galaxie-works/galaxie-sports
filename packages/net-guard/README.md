# @galaxie/net-guard

Proteção contra SSRF em toda busca de URL de terceiro: recusa host e IP privados, confere o DNS no momento da conexão
e repete a conferência a cada redirecionamento (`guardedFetch`).

## Como usar

Use `guardedFetch` no lugar de `fetch` sempre que a URL vier de fora (resultado de busca, página de emissora, imagem).
A api-sports **não** passa por aqui: ela tem o `@galaxie/apisports-client`.

## Depende de

Nenhum pacote do repo nem dependência externa.

## Usado por

`services/ingestor`, `services/ai-agents`.
