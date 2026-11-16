# api-edge-cache

Worker da Cloudflare que guarda na borda as respostas de leitura da API (#1257), na rota
`api.galaxiesports.com/v1/*`. A zona está no plano Free: a Cache Rule não aceita header na chave de cache e a
Cloudflare ignora o `Vary`, então uma regra "Cache Everything" serviria a resposta de uma chave a outra. O Worker monta
a chave ele mesmo e usa a Cache API.

## O que ele faz

| Requisição | Comportamento |
|---|---|
| Não é GET, SSE (`/stream`), com `Authorization` (torcedor), com `?key=`/`?token=` ou **sem chave da API** | Passa direto para a origem, sem olhar nem gravar a borda |
| GET de `/v1/*` com `x-galaxie-key` ou `x-galaxie-publishable-key` | Procura a cópia pela chave abaixo; sem cópia, busca na origem e guarda se a origem deixou |

- **Chave de cache:** URL com a query em ordem + SHA-256 da chave da API (secreta e publicável separadas) + o locale
  que a API usaria (o `Accept-Language` reduzido aos 9 locales da API) + o hash da origem da página (`Origin` ou
  `Referer`, que decidem o CORS e a validade da chave publicável).
- **O que vai à borda:** só a resposta 200 que a origem marcou com `x-galaxie-edge-ttl` (regra em
  `apps/api/src/cache/edge.ts`: GET, TTL do recurso ≥ 1 h, nunca ao vivo, agenda do dia, onde assistir, `no-store`,
  erro, `/internal`, admin ou SSE), com tags (`Cache-Tag` ou `surrogate-key`), sem `Set-Cookie`. A cópia dura o
  valor da marca, no máximo 15 min: uma chave revogada para de receber cópias nesse prazo.
- **Purge:** a cópia guarda o `Cache-Tag`; o `CloudflareCdnPurger` da API purga por tag quando o dado muda.
- **Cliente:** IP (`x-real-ip`, que vira o `CF-Connecting-IP` da sub-requisição) e país (`CF-IPCountry`, lido pelo
  Shopping) seguem até a origem. Limite por minuto e cota não são contados no HIT (decisão de 16/11: sem limite de
  requisições por cliente).
- **Resposta:** `x-galaxie-edge-cache: HIT | MISS`; `If-None-Match` igual ao ETag → 304, da borda ou da origem.

## Testes

Fora do workspace pnpm (não é pacote do monorepo); usa o vitest e o typescript da raiz. No CI:
`.github/workflows/edge-cache.yml`, só quando esta pasta muda.

```bash
pnpm exec vitest run --root infra/cloudflare/api-edge-cache       # funções puras e o handler (Cache API e fetch simulados)
pnpm exec tsc -p infra/cloudflare/api-edge-cache/tsconfig.json    # typecheck
```

## Deploy (à mão; nada aqui roda sozinho)

Pré-requisito: a API em produção já com a versão que emite `x-galaxie-edge-ttl` e `Cache-Tag`.

1. Entrar na conta: `npx wrangler login` (ou `CLOUDFLARE_API_TOKEN` com a permissão **Workers Scripts: Edit** na conta
   e **Workers Routes: Edit** na zona; não é o token de purge da API).
2. Nesta pasta: `npx wrangler deploy`. O `wrangler.toml` cria a rota `api.galaxiesports.com/v1/*` na zona
   `galaxiesports.com`.
3. No painel (Workers Routes da zona), editar a rota e escolher **Fail open (proceed)**: passado o limite diário do
   plano Free dos Workers (100 mil requisições por dia, zera à meia-noite UTC), a requisição vai direto para a origem
   em vez de receber o erro 1027.
4. Conferir:
   - `curl -sI -H "x-galaxie-key: <chave de teste>" https://api.galaxiesports.com/v1/sports` duas vezes: a primeira
     `x-galaxie-edge-cache: MISS`, a segunda `HIT`.
   - Sem chave: nenhum `x-galaxie-edge-cache` (passa direto).
   - `/v1/events/live` com chave: sempre `MISS`.
   - Se toda resposta elegível sai `MISS`, o Worker não está vendo as tags (ver "A confirmar"): `npx wrangler tail`
     e conferir os headers que chegam da origem.
5. Purge: com o `CLOUDFLARE_ZONE_ID` e o `CLOUDFLARE_PURGE_TOKEN` em `/docker/galaxie-sports/.env` na VPS
   (`infra/vps-telemetry/env.example`, docs/05 §7.1), uma mudança na
   competição (`competition:<id>`) deve tirar a cópia: a próxima requisição volta `MISS`.

**Voltar atrás:** apagar a rota no painel (ou `npx wrangler delete`). A API segue igual; sem o Worker, a borda volta a
ser `DYNAMIC`.

## A confirmar no primeiro deploy

- **Tags no Worker.** A documentação diz que a Cloudflare tira o `Cache-Tag` antes de a resposta chegar ao Worker; por
  isso ele lê também o `surrogate-key`. Se nenhum dos dois chegar, o Worker não guarda nada (seguro, mas inútil) e a
  origem precisa mandar as tags num header próprio.
- **`ETag` no Worker.** Há relatos de a sub-requisição perder o `ETag` (compressão). Sem ele, o 304 não sai da borda
  (a resposta vem inteira); nada quebra.
- **Purge por tag na Cache API.** A documentação dos Workers lista o purge por tag como um dos que alcançam o que foi
  gravado pela Cache API (a cópia é por data center; o purge pela API é global). Conferir no passo 5.
