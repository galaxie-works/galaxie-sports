# cloudflare

O que roda na Cloudflare, na frente de `galaxiesports.com` (#635). Nada daqui é publicado pelo CI: cada pasta tem o
passo a passo do deploy à mão.

| Pasta | O que é |
|---|---|
| [`api-edge-cache/`](api-edge-cache/README.md) | Worker de cache de borda da API (#1257): guarda por chave da API, idioma e origem as respostas que a API marcou, com purge por tag |
