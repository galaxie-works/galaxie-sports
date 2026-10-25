# 05 · API pública Galaxie Sports

A API tem **duas faces**:

1. **Espelho compatível** (`/mirror/{sport}/{endpoint}`) — mesma URL relativa, mesmos parâmetros e **o mesmo envelope** da api-sports. Quem já integrou a api-sports só troca a URL base e a chave.
2. **API canônica** (`/v1/...`) — orientada a evento, multiesporte, localizada e enriquecida (onde assistir, semântica, contexto, momentum).

Especificação formal: OpenAPI 3.1 gerada a partir dos schemas Zod de `packages/contracts` (biblioteca `zod-openapi`), servida em **`/openapi.json`**, com referência interativa (Scalar) em **`/docs`** — ambas públicas. O mesmo pacote exporta o cliente tipado `createGalaxieClient({ baseUrl, apiKey, locale })` usado pelo demo. O CI valida o documento contra o schema oficial do OpenAPI 3.1.

## 1. Autenticação, tenants e limites

| Item | Regra |
|---|---|
| Autenticação | Header `x-galaxie-key: <chave do tenant>` (chaves rotacionáveis, escopos por módulo); no navegador, `x-galaxie-publishable-key` só para leitura (§1.3) |
| Tenant | Cada cliente tem plano (Core Data, Fan Experience, Live Intelligence, Enterprise), mercados ativos e esportes contratados |
| Rate limit | Por tenant e por rota; headers `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` |
| Locale | `Accept-Language` ou `?locale=` (pt-BR, es-AR, es-MX, es-CO, es-CL, es-PE, es-UY, es-EC) |
| Fuso | `?tz=America/Sao_Paulo` (padrão UTC) |
| Cache | `ETag` + `Cache-Control` por tipo de recurso; `If-None-Match` retorna 304 |

### 1.1 Implementação (schema `api`)

**Chaves.** Formato `gs_<live|test>_<prefixo>_<segredo>` — prefixo de 12 caracteres hex (guardado em claro em `api.api_key.prefix` para localizar a chave) e segredo de 32 bytes em base64url, guardado **só como hash scrypt com sal** (`scrypt$N$r$p$sal$hash`, via `node:crypto`). A chave completa é exibida uma única vez, na criação. A verificação positiva fica em cache em memória por 60 s (revogação e mudança de plano valem em até 1 min). `last_used_at` é atualizado no máximo a cada 5 min.

**Tenants e planos.** `api.tenant` guarda `plan`, `modules`, `markets` (países ISO2; vazio = todos), `sports` (vazio = todos), `rate_limit_per_minute` e `status` (`active`/`suspended`). Módulos: `core_data`, `where_to_watch`, `semantic`, `live_intelligence`, `multisport` e o add-on `related_content` (vídeos relacionados, [12](12-conteudo-relacionado.md); incluído no `enterprise`, contratável à parte em qualquer plano). Cada chave pode restringir os módulos do tenant (`api.api_key.scopes`; `null` = herda).

| Plano | Módulos padrão |
|---|---|
| `core_data` | `core_data` |
| `fan_experience` | `core_data`, `where_to_watch`, `semantic` |
| `live_intelligence` | + `live_intelligence`, `multisport` |
| `enterprise` | todos (inclusive `related_content`) |

Cada rota declara o módulo exigido (`/mirror` e o catálogo `/v1` exigem `core_data`). Chave sem o módulo → 403 `MODULE_NOT_IN_PLAN`; esporte fora de `sports` no espelho → 403 `MODULE_NOT_IN_PLAN`; país fora de `markets` (rotas por país, como onde assistir) → 403 `MARKET_NOT_IN_PLAN`.

**Rate limit.** Janela fixa de 60 s por **tenant × rota** (padrão da rota, ex.: `GET /v1/competitions/:id`), com contadores no Valkey (`<prefixo>rl:<tenant>:<rota>`), compartilhados entre instâncias. Headers `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` (segundos) em toda resposta autenticada; 429 inclui `retry-after`. Se o Valkey cair, o limite é ignorado (*fail-open*) e o evento é registrado em log.

**Locale.** `?locale` (um dos 8 locales; outro valor → 400) tem precedência; senão `Accept-Language` (tag exata, ou só o idioma: `es-*` → `es-AR`, `pt-*` → `pt-BR`); padrão `pt-BR`. A resposta traz `Content-Language`. Textos i18n do banco seguem a cadeia `es-XX → es → en` (`pt-BR → pt → en`); sem correspondência, cai no nome oficial. Textos livres da base semântica (fatos, mascote, origem de clássico) seguem `es-XX → es → original`, com `text_locale` na resposta ([docs/06 §3.3](06-semantica-e-conteudo.md#33-textos-livres-por-idioma)). **Fuso:** `?tz` aceita qualquer fuso IANA (inválido → 400); instantes saem em ISO 8601 com o offset do fuso (padrão UTC, sufixo `Z`).

**Chave local para desenvolvimento:**

```bash
pnpm --filter @galaxie/api tenant:create --slug demo-local --plan enterprise --label dev
# padrões do modelo do plano (config/plans.yaml, §1.2); ajustes: --markets BR,AR --sports football
# --rate-limit 600 --daily-quota 50000|none --scopes core_data --env live
```

### 1.2 Onboarding, autoatendimento e uso

**Modelos de plano** — [`config/plans.yaml`](../config/plans.yaml) define, para cada plano comercial (Core Data, Fan Experience, Live Intelligence, Enterprise — docs/01 §6), os módulos, mercados e esportes padrão, `rateLimitPerMinute`, `dailyRequestQuota` (informativa; `null` = sem cota) e o ambiente da chave inicial. O arquivo é validado na subida da API (Zod); o teste unitário garante que os módulos batem com `PLAN_MODULES`. Mudar o arquivo não altera tenants existentes (use `applyTemplate`).

**API administrativa** — `/internal/admin/*`, só registrada quando `ADMIN_KEY_HASHES` está definida. Exige a chave administrativa no header `x-galaxie-admin-key` (`gs_admin_<32 bytes>`; gere com `pnpm --filter @galaxie/api admin:key`, que imprime a chave **uma vez** e o hash `sha256$...` para o ambiente) e, com `ADMIN_IP_ALLOWLIST` (IPs/CIDRs), responde **404** fora da allowlist. O proxy público já devolve 404 para `/internal/*` ([Caddyfile](../infra/caddy/Caddyfile)); o acesso é pela rede privada/VPN. Respostas `no-store`, sem CORS. Corpo e parâmetros validados com Zod (`.strict()`: campo desconhecido → 400).

| Rota | Uso |
|---|---|
| `GET /internal/admin/plans` | Modelos de plano carregados |
| `POST /internal/admin/tenants` | Onboarding: `{ slug, name, plan, modules?, markets?, sports?, rateLimitPerMinute?, dailyRequestQuota?, key?: { label?, scopes?, env?, expiresAt? } \| false }` → 201 com o tenant e a **chave exibida uma única vez**; slug repetido → 409 `CONFLICT` |
| `GET /internal/admin/tenants?status=&plan=&limit=&offset=` | Lista |
| `GET /internal/admin/tenants/{id\|slug}` | Tenant + metadados das chaves (nunca hash/segredo) |
| `PATCH /internal/admin/tenants/{id\|slug}` | Plano, módulos, mercados, esportes, limites, `status` (`suspended` bloqueia todas as chaves); `applyTemplate: true` reaplica o modelo do plano antes dos demais campos |
| `POST /internal/admin/tenants/{id}/keys` | Emite chave (escopos ⊆ módulos do tenant) |
| `POST /internal/admin/tenants/{id}/keys/{keyId}/rotate` | Nova chave (mesmo rótulo/escopos/ambiente/validade); a antiga expira em `graceSeconds` (padrão 86400; 0 = revoga já; máx. 7 dias). Chave já rotacionada ou tenant com 20 chaves válidas → 409 `CONFLICT` |
| `POST /internal/admin/tenants/{id}/keys/{keyId}/revoke` | Revoga |
| `GET /internal/admin/tenants/{id}/usage?from=&to=` | Uso por dia e rota (dias UTC; padrão últimos 7; máx. 92) |
| `GET /internal/admin/usage?from=&to=` | Total por tenant no período |
| `POST /internal/admin/usage/flush` | Força a consolidação Valkey → Postgres |

```bash
curl -X POST http://localhost:8080/internal/admin/tenants \
  -H "x-galaxie-admin-key: $GALAXIE_ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"slug":"portal-esportivo","name":"Portal Esportivo","plan":"fan_experience","markets":["BR","AR"]}'
```

**Autoatendimento do tenant** — `/v1/account/*` exige uma chave válida, mas nenhum módulo (todo tenant gerencia a própria conta). Respostas `no-store`; documentadas no OpenAPI (tag *Conta*).

| Rota | Uso |
|---|---|
| `GET /v1/account` | Plano, módulos, mercados, esportes, limites e a chave em uso (`effectiveModules` = módulos ∩ escopos) |
| `GET /v1/account/keys` | Chaves do tenant (prefixo, rótulo, escopos, status, último uso) |
| `POST /v1/account/keys/rotate` | Rotaciona **a chave usada na requisição**: `{ graceSeconds? }` (padrão 86400) → 201 com a chave nova (exibida uma vez) |
| `GET /v1/account/usage?from=&to=` | Uso por dia e rota + `dailyRequestQuota` |

A chave nova herda o rótulo, os escopos, o ambiente e a **validade** (`expiresAt`) da antiga: rotacionar não estende o prazo de uma chave com validade (ex.: trial). Cada chave só é rotacionada uma vez: a antiga, já no período de graça, recebe 409 `CONFLICT` (quem tem só a chave vazada não gera outra a partir dela), e a rotação é recusada (409) quando o tenant já tem 20 chaves válidas — revogue as que não usa.

Revogação, suspensão e mudança de plano valem em até 60 s (cache do autenticador por instância).

**Contadores de uso** — toda requisição autenticada incrementa um `Map` em memória (tenant × dia UTC × padrão de rota; sem I/O na requisição). A cada 1 s (`USAGE_FLUSH_MS`) o buffer agregado vira **um** pipeline de `HINCRBY` no Valkey (`<prefixo>usage:<dia>:<tenant>`, campo = rota; set `<prefixo>usage:<dia>:tenants`; TTL 4 dias). A cada 60 s (`USAGE_PERSIST_MS`) uma instância (trava `SET NX`) consolida em `api.usage_daily` todos os dias ainda retidos no Valkey (os 4 do TTL, para não perder uso se o Postgres ficar fora mais de um dia) com `greatest(...)` — idempotente e sem regredir se o Valkey for reiniciado. Cada hash tem uma **época** (`#epoca` = `<instante>-<aleatório>`, gravada antes do primeiro incremento); `api.usage_daily` guarda a época da última consolidação e `epoch_base`, o consolidado das épocas anteriores. Mesma época: `requests = greatest(requests, epoch_base + contador)` (idempotente; um AOF truncado que volte o contador não regride nem soma de novo; uma réplica ou rollback com a versão anterior, que grava `greatest(requests, contador)`, não faz o total crescer em dobro). Época mais nova (o Valkey perdeu o hash): `epoch_base := requests` e a contagem nova soma, em vez de o `greatest()` congelar o uso até o contador novo passar o antigo. Época mais velha que a gravada (snapshot atrasado): ignorada. A consolidação nunca escreve no Valkey; perde-se só o que foi contado e não consolidado antes da queda. Rollback para uma versão sem épocas: a consulta de uso antiga lê `#epoca` como rota e mostra total null para os dias ainda no Valkey (até 4 dias); a consolidação antiga não é afetada. As consultas combinam o consolidado com os contadores vivos. Em queda abrupta da instância perde-se no máximo o último segundo. A 10k req/s isso dá ~1 round-trip/s por instância.

### 1.3 Chave publicável (widgets no navegador)

O Galaxie Sports Builder gera widgets que a operadora instala no app dela como componente shadcn. Esses widgets chamam a API **do navegador do torcedor**, e a chave secreta (`x-galaxie-key`) não pode ir para lá: quem abre o DevTools leva a chave e o plano inteiro. Para isso existe a **chave publicável**, que é pública por definição e por isso alcança pouco.

| Item | Regra |
|---|---|
| Formato | `gs_pk_live_<32 bytes em base64url>`; o banco guarda só o **sha256** (`ops.publishable_key.key_hash`) e um prefixo visível (`gs_pk_live_AbCd1234`) para a lista. A chave completa é exibida uma única vez, na criação |
| Header | `x-galaxie-publishable-key` (nunca por query string). Se a requisição trouxer também `x-galaxie-key`, vale a secreta |
| Alcance | Só `GET`/`HEAD` em rotas `/v1/*` que exigem módulo, com os módulos, mercados e esportes do tenant. Escrita, `/v1/account/*`, `/v1/stream` (SSE), `/mirror` e `/internal/*` → 403 `PUBLISHABLE_KEY_NOT_ALLOWED` |
| Origens | `allowed_origins` da chave: origem exata (`https://app.exemplo.com`, `http://localhost:3000`) ou curinga de subdomínio (`https://*.exemplo.com`, que aceita `app.exemplo.com` e `a.b.exemplo.com`, mas não `exemplo.com`). Esquema e porta precisam bater. A API confere o `Origin` (ou, sem ele, a origem do `Referer`); fora da lista ou sem nenhum dos dois → 403 `ORIGIN_NOT_ALLOWED` |
| Widget | `widget_id` opcional prende a chave a um widget: a chave só alcança os módulos daquele tipo (`WIDGET_KIND_MODULES`: `match_card` e `where_to_watch` → `core_data` + `where_to_watch`; `live_list` e `standings` → `core_data`) e deixa de valer quando o widget é arquivado |
| Rate limit | Próprio, por **chave × IP** (todas as rotas somadas), janela de 60 s, padrão 60 req (`PUBLISHABLE_RATE_LIMIT_PER_MINUTE`), nunca acima de `rate_limit_per_minute` do tenant. Não consome o limite tenant × rota da chave secreta. Mesmos headers `x-ratelimit-*` e 429 `RATE_LIMITED` |
| CORS | A resposta só leva `Access-Control-Allow-Origin` (a própria origem, sem credenciais) quando a origem bateu com a chave usada. O preflight (`OPTIONS`, que chega sem chave) é respondido com `GET, HEAD` para as origens de alguma chave ativa; vale também sem `CORS_ORIGINS` |
| Revogação | `revoked_at`; vale em até 60 s (cache da verificação por instância, positivo e negativo). Chave revogada, inexistente ou de tenant suspenso → 401 `INVALID_KEY` |
| Uso | `last_used_at` atualizado no máximo a cada 5 min; as requisições entram nos contadores de uso do tenant (§1.2) |

**Tabelas** (migration `0028_builder_widgets`): `ops.widget` (tipo, nome, `version` que sobe a cada salvamento, `config` jsonb com tema, locale, mercado e recorte padrão, `archived_at`) e `ops.publishable_key`. Os helpers ficam em `@galaxie/db` (`packages/db/src/widgets.ts`): `listWidgets`, `getWidget`, `saveWidget`, `archiveWidget`, `createPublishableKey`, `listPublishableKeys`, `revokePublishableKey` e `verifyPublishableKey`.

```ts
const { id, key } = await createPublishableKey(db, {
  tenantId,
  name: 'App da Operadora Exemplo',
  allowedOrigins: ['https://app.exemplo.com', 'https://*.exemplo.com'],
});
// key = gs_pk_live_... — mostre uma vez; depois só o prefixo aparece em listPublishableKeys
```

```http
GET /v1/events?sport=football&date=2026-10-23
Origin: https://app.exemplo.com
x-galaxie-publishable-key: gs_pk_live_...
```

**O que a chave publicável não protege.** O `Origin` é confiável dentro de um navegador, mas qualquer script fora dele pode forjá-lo. A lista de origens impede que outro site use a chave da operadora nas páginas dele; não impede alguém de copiar a chave e chamar a API de um servidor. O que limita esse abuso é o alcance (só leitura, só o contrato do tenant) e o rate limit por IP. Se isso não basta para a operadora, a alternativa é o proxy abaixo.

**Alternativa: proxy pelo backend da operadora.** Em vez de chamar a Galaxie direto, o widget aponta a URL base para uma rota do próprio app da operadora, que repassa a requisição com a chave **secreta** guardada no servidor (o widget então não envia chave nenhuma):

```ts
// app/api/galaxie/[...path]/route.ts (Next.js) no app da Operadora Exemplo
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path[0] !== 'v1') return new Response('Not found', { status: 404 });
  const url = new URL(req.url);
  const res = await fetch(`https://api.galaxie.sports/${path.join('/')}${url.search}`, {
    headers: {
      'x-galaxie-key': process.env.GALAXIE_API_KEY!,
      'accept-language': req.headers.get('accept-language') ?? 'pt-BR',
    },
  });
  return new Response(res.body, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', 'cache-control': res.headers.get('cache-control') ?? 'no-store' },
  });
}
```

Com o proxy, a chave nunca sai do servidor, não há CORS (mesma origem) e a operadora aplica a autenticação e o rate limit dela própria. O custo é o tráfego passar pelo backend dela e consumir o limite tenant × rota da chave secreta (todos os torcedores atrás do mesmo IP do servidor), então vale cachear as respostas no proxy respeitando o `Cache-Control` da API. Restrinja o proxy a `GET` em `/v1/*`, como faz a chave publicável, para ele não virar uma porta aberta para a conta.

## 2. Espelho compatível — `/mirror`

```http
GET /mirror/football/fixtures?league=71&season=2026&round=Regular Season - 30
x-galaxie-key: gs_live_xxx
```

Resposta (mesmo envelope da api-sports):

```json
{
  "get": "fixtures",
  "parameters": { "league": "71", "season": "2026", "round": "Regular Season - 30" },
  "errors": [],
  "results": 10,
  "paging": { "current": 1, "total": 1 },
  "response": [ { "fixture": { "id": 1234567, "...": "..." }, "league": {}, "teams": {}, "goals": {}, "score": {} } ]
}
```

Extras do espelho (headers, sem alterar o corpo):

| Header | Significado |
|---|---|
| `x-galaxie-source` | `raw-hit` (resposta idêntica já obtida do fornecedor), `rebuilt` (montada a partir do `core`), `stale` (last-known-good) |
| `x-galaxie-fetched-at` | Quando o dado foi obtido do fornecedor |
| `x-galaxie-asset-base` | URL base do nosso CDN de assets (logos/bandeiras reescritos para o nosso storage) |

Esportes do espelho:

| Esporte | Prefixo | Fornecedor original |
|---|---|---|
| ![](images/sports/football.png) Futebol | `/mirror/football` | `v3.football.api-sports.io` |
| ![](images/sports/afl.png) AFL | `/mirror/afl` | `v1.afl.api-sports.io` |
| ![](images/sports/baseball.png) Beisebol | `/mirror/baseball` | `v1.baseball.api-sports.io` |
| ![](images/sports/basketball.png) Basquete | `/mirror/basketball` | `v1.basketball.api-sports.io` |
| ![](images/sports/formula-1.png) Fórmula 1 | `/mirror/formula-1` | `v1.formula-1.api-sports.io` |
| ![](images/sports/handball.png) Handebol | `/mirror/handball` | `v1.handball.api-sports.io` |
| ![](images/sports/hockey.png) Hóquei | `/mirror/hockey` | `v1.hockey.api-sports.io` |
| ![](images/sports/mma.png) MMA | `/mirror/mma` | `v1.mma.api-sports.io` |
| ![](images/sports/nba.png) NBA | `/mirror/nba` | `v2.nba.api-sports.io` |
| ![](images/sports/nfl.png) NFL | `/mirror/american-football` | `v1.american-football.api-sports.io` |
| ![](images/sports/rugby.png) Rúgbi | `/mirror/rugby` | `v1.rugby.api-sports.io` |
| ![](images/sports/volleyball.png) Vôlei | `/mirror/volleyball` | `v1.volleyball.api-sports.io` |

> O espelho **nunca** repassa a requisição ao fornecedor em tempo real. Se a combinação de parâmetros não existir no `raw` nem puder ser remontada do `core`, a resposta é `results: 0` com `x-galaxie-source: miss` e a combinação entra na fila de *backfill* do Quota Governor (prioridade ADHOC).

Como funciona hoje (`apps/api/src/routes/mirror.ts`):

1. `GET /mirror/{sport}/{endpoint...}` — o endpoint pode ter barras (`/mirror/football/fixtures/headtohead?h2h=121-131`). Os parâmetros são normalizados com `normalizeParams` e a identidade é o mesmo `requestHash('api-sports', sport, endpoint, params)` usado pelo `ApiSportsClient` — a ordem dos parâmetros não importa.
2. **Hit** (`x-galaxie-source: raw-hit`): serve o `body` da resposta **mais recente com sucesso** (HTTP 2xx e `errors` vazio) em `raw.api_response` enquanto ela estiver dentro do frescor do endpoint (`ttlFor`: 10 s no ao vivo, 5 min na agenda do dia, 1 min por `id`, 24 h em referências, "para sempre" em temporadas e dias encerrados), com `x-galaxie-fetched-at`. Como o JSONB não preserva a ordem das chaves, o envelope volta na ordem da api-sports (`get, parameters, errors, results, paging, response`); objetos internos podem ter as chaves em outra ordem (mesmo JSON).
3. **Remontado** (`x-galaxie-source: rebuilt`): quando não há raw para a combinação — ou o raw passou do frescor e o `core` tem observação mais nova que ele —, partidas de futebol são remontadas de `core.football_fixture` (resumo `fixture/league/teams/goals/score` do fornecedor, na ordem de chaves da api-sports). `x-galaxie-fetched-at` = maior `last_valid_at` das partidas. Combinações remontáveis (`apps/api/src/routes/mirror-rebuild.ts`):
   - `fixtures?id=` e `fixtures?ids=` (até 20) — com `events`, `lineups`, `statistics` e `players` do detalhe (`[]` quando ainda não sincronizado);
   - `fixtures?live=all|<ligas>` — estado ao vivo do `core` (`live`, `break`, `suspended`), com `events`;
   - `fixtures?date=` ou `fixtures?league=&season=` / `fixtures?team=&season=`, com `round`, `status` (`FT-AET`), `from`/`to` e `timezone` opcionais;
   - `fixtures/headtohead?h2h=A-B`, com `last`, `league`, `season`, `status`, `date`, `from`/`to` e `timezone`.

   `timezone` converte `fixture.date` para o fuso (como o fornecedor). Outros parâmetros (`venue`, `next`, `last` fora do h2h…) e demais endpoints/esportes não são remontados. Remontagem sem nenhuma partida conta como *miss*.
4. **Last-known-good** (`x-galaxie-source: stale`): raw fora do frescor e nada mais novo no `core` — serve o raw com `x-galaxie-fetched-at` e fica no cache por no máximo 60 s.
5. **Miss** (`x-galaxie-source: miss`): envelope vazio (`parameters: []` quando não há parâmetros, como o fornecedor) e upsert em **`api.backfill_request`** (`request_hash` único; repetições somam `hits`; `status` `pending → done/failed/skipped`, a cargo do ingestor). Respostas *miss* não entram no cache.
6. Cache: TTL igual ao frescor do endpoint no cliente da api-sports (`ttlFor`, entre 15 s e 24 h); tags de purge `api_response:<request_hash>` (e `event` nas remontadas).
7. **Mídia**: com `ASSETS_PUBLIC_BASE_URL`, toda URL `media(-N).api-sports.io` do corpo é reescrita para o nosso CDN (`rewriteMediaUrls` de `@galaxie/apisports-client`: `<base>/api-sports/<caminho original>`, chave determinística do Asset Mirror) e `x-galaxie-asset-base` traz a base. URLs da lista de bloqueio (`config/assets/denylist.yaml`, ou `MEDIA_DENYLIST_PATH`) viram `null`; URLs fora da CDN do fornecedor ficam intactas.
8. Erros de autenticação/plano do espelho também saem em `application/problem+json` (§6), e não no formato de erro da api-sports.

## 3. API canônica — `/v1`

### 3.1 Catálogo

| Método e rota | Descrição |
|---|---|
| `GET /v1/sports` | Esportes disponíveis e cobertura |
| `GET /v1/countries` | Países, bandeiras, confederação |
| `GET /v1/countries/{code}` | País com confederação (código + nome localizado) e bandeira (§3.1.1) |
| `GET /v1/countries/{code}/competitions?sport=&max_tier=` | Competições do país por esporte e escopo: domésticas, continentais de clubes, seleção, mundiais (§3.1.1) |
| `GET /v1/navigation` | Menu da demo em uma chamada: 12 esportes (contagens, `has_data`) e países da navegação (§3.1.1) |
| `GET /v1/explore/summary` | Vitrine inicial em uma chamada: por esporte e por país, contadores, competições e clubes em destaque, ao vivo e o jogo de maior relevância (§3.1.2) |
| `GET /v1/explore/agenda?sport=&country=&competition=&day=&market=` | Os jogos dos próximos 7 dias que o resumo conta (mesma consulta): total, por dia, contagens para os filtros, destaques no mercado e os jogos de um dia (§3.1.3) |
| `GET /v1/competitions?sport=&country=&tier=` | Competições com apelidos (semântica) |
| `GET /v1/competitions/{id}` | Detalhe + temporadas |
| `GET /v1/competitions/{id}/seasons/{season}/standings` | Tabela/grupos |
| `GET /v1/competitions/{id}/context` | O que está em jogo: líder, G4/G6, Z4, mata-mata, chaveamento, próximos confrontos decisivos |
| `GET /v1/venues/{id}` | Estádio/circuito/arena: nome atual (curadoria vence o fornecedor), `provider_name` (nome cru do fornecedor) e `former_names` (`{ name, from, until, origin, confidence }`: curadoria `high` primeiro, depois pistas do fornecedor `low`) |

Convenções implementadas:

- Listas completas: `{ "data": [...] }` (`/v1/sports`, `/v1/countries`). Listas paginadas: `{ "data": [...], "next_cursor": "..." | null }` — envie `?cursor=<next_cursor>`; `limit` de 1 a 200 (padrão 50). Detalhes são o objeto sem envelope.
- `/v1/competitions`: filtros `sport`, `country` (código, case-insensitive), `tier` (1–3) e `q` (≥ 2 caracteres; busca em nome oficial, slug, labels e apelidos da base semântica); ordenação por `tier`, nome oficial e id. Cada item traz `name` (localizado), `official_name`, `nicknames` (localizados), `country`, `logo` e `current_season`.
- `/v1/competitions/{id}` aceita **UUID ou slug** e traz `seasons` (mais recente primeiro), `trophy_nickname` e `external_ids` (`{"api-sports": "71"}`).
- Standings: `{season}` é o ano (`2026`) ou `current`; tabela vazia → `groups: []` (a temporada existe, a tabela ainda não foi sincronizada). `updated_at` respeita `?tz`.
- Assets (`logo`, `flag`, `image`): `ASSETS_PUBLIC_BASE_URL` + `core.asset.storage_key` quando o asset já foi espelhado; senão, a `source_url` original.
- `GET /v1/competitions/{id}/context?season=current|AAAA` (padrão `current`) — o que está em jogo, a partir de `core.standing`, das partidas do `core` e do regulamento (`config/rules/<slug>.yaml`, [docs/rules](rules/README.md)):
  - `format` do regulamento (`league`, `cup`, `league_phase`, `groups_and_knockout`; `null` sem arquivo próprio);
  - `groups[]`: por tabela/grupo, `leader` e `zones` (`id`, `kind`, `label` localizado, faixa `from`–`to` e os times que estão nela agora). Sem regulamento, as zonas saem das faixas contíguas de `description` do fornecedor;
  - `bracket[]`: fases de mata-mata em ordem, com os confrontos (`participants`, `legs` com perna 1/2, `aggregate`, `winner_id` e `status` `scheduled`/`in_progress`/`decided`). Com regulamento de ida e volta, o confronto só é dado como decidido com as duas pernas no `core`; o vencedor sai do agregado, depois dos pênaltis da última perna e, por fim, do `winner` do fornecedor;
  - `decisive_events[]`: até 10 próximos jogos (não encerrados, a partir de 3 h atrás) com stakes decisivos (título, vaga, rebaixamento, eliminação, mata-mata) ou finais, por `importance`.

#### 3.1.1 Navegação por país (`apps/api/src/routes/v1/navigation.ts`)

Um país participa de confederações e de campeonatos que outros países também jogam (Libertadores e Sul-Americana para os dez da CONMEBOL). O modelo vem de dois arquivos versionados, validados por `packages/geo` (Zod + testes que cruzam com `config/competitions/*.yaml`):

- [`config/geo/confederations.yaml`](../config/geo/confederations.yaml) — as seis confederações com os 218 membros da FIFA (código de país da api-sports, incl. `GB-ENG`/`GB-SCT`/`GB-WLS`/`GB-NIR` e `XK`; código COI; nome `en`/`pt-BR`/`es`), as regiões dos catálogos dos outros esportes (`SOUTH-AMERICA` → CONMEBOL…) e a navegação da demo: os 10 da CONMEBOL + México + Inglaterra, Espanha, Itália, Alemanha, França e Portugal, e a ordem dos 12 esportes.
- [`config/geo/competition-scope.yaml`](../config/geo/competition-scope.yaml) — por esporte, as competições internacionais com `scope` (`continental_clubs`, `national_teams`, `world_clubs`) e participantes (`confederations`, com `FIFA` = global, e/ou `countries`: convidados da Copa América, México e EUA na Leagues Cup). Competições fora do catálogo (Supercopa da UEFA, Intercontinental, Copa Ouro, Finalíssima) casam pelo `api_sports_id` em `core.provider_map`. `featured` dá a ordem editorial das domésticas (Brasileirão e Copa do Brasil antes dos estaduais); `excluded` tira da navegação o que não tem recorte por país (amistosos de clubes, F1, MMA).

`pnpm --filter @galaxie/ingestor geo:seed` (também roda ao fim do `bootstrap:catalog`) grava em `core.country` a confederação, o código COI e os nomes pt-BR/es, preservando o `en` do fornecedor; é idempotente, não gasta cota e só cria os países da navegação que faltarem. A API usa o YAML como fallback (nome, confederação) quando o banco ainda não tem o dado.

| Rota | Resposta |
|---|---|
| `GET /v1/navigation` | `sports[]` — os 12 esportes na ordem do menu (futebol primeiro): `slug`, `name`, `competitions` (todos os tiers), `events`, `has_data` (há competição ou evento no banco), `mirror`; `countries[]` — países da navegação com `name`, `flag` e `confederation` (`code` + nome localizado); `confederations[]` — seções do menu (CONMEBOL, CONCACAF, UEFA) com os códigos dos países |
| `GET /v1/countries/{code}` | `code`, `name`, `ioc_code`, `flag`, `confederation` e `in_navigation`. Código ISO2 ou extensão (`GB-ENG`), em qualquer caixa; fora do banco e do config/geo → 404 |
| `GET /v1/countries/{code}/competitions` | `country` + `sports[]` (futebol primeiro; só esportes com alguma competição), cada um com `groups[]` na ordem `domestic` → `continental_clubs` → `national_teams` → `world_clubs` (grupo vazio é omitido), com `label` localizado e `competitions[]` no formato de `/v1/competitions` + `scope` e `confederations`. Domésticas: `country_code` = país e `tier ≤ max_tier` (padrão 2 = catalogadas; 3 traz todo o espelho). Ordem no grupo: tier, posição editorial (ordem do arquivo de escopo ou `featured`) e nome |

Todas exigem `core_data`, aceitam `?locale`/`Accept-Language` (nomes com a cadeia `es-XX → es → en`) e ficam 24 h no cache (tags `country`, `competition`, `season`, `sport`). As contagens de eventos de `/v1/navigation` podem atrasar até o TTL (a rota não é purgada a cada evento).

```bash
curl -H "x-galaxie-key: $KEY" "http://localhost:8080/v1/countries/BR/competitions?sport=football&locale=pt-BR"
```

```json
{
  "country": { "code": "BR", "name": "Brasil", "ioc_code": "BRA", "flag": "https://cdn…/api-sports/flags/br.svg",
               "confederation": { "code": "CONMEBOL", "name": "CONMEBOL (América do Sul)" }, "in_navigation": true },
  "sports": [{
    "sport": { "slug": "football", "name": "Futebol" },
    "groups": [
      { "scope": "domestic", "label": "Competições nacionais", "competitions": ["Brasileirão Série A", "Copa do Brasil", "Campeonato Baiano", "…"] },
      { "scope": "continental_clubs", "label": "Copas continentais de clubes", "competitions": ["Libertadores", "Copa Sul-Americana", "Recopa Sul-Americana"] },
      { "scope": "national_teams", "label": "Seleção", "competitions": ["Copa do Mundo", "Eliminatórias Sul-Americanas", "Copa América", "…"] },
      { "scope": "world_clubs", "label": "Mundiais de clubes", "competitions": ["Mundial de Clubes", "FIFA Intercontinental Cup"] }
    ]
  }]
}
```

(Exemplo resumido: cada item de `competitions` é um objeto completo — `id`, `slug`, `name`, `official_name`, `nicknames`, `tier`, `country`, `logo`, `current_season`, `scope` e `confederations`.)

#### 3.1.2 Resumo da home "Explorar" (`apps/api/src/routes/v1/explore.ts`)

`GET /v1/explore/summary?locale=&tz=` alimenta a primeira tela da demo sem N+1: uma chamada traz, para os 12 esportes e os 17 países da navegação (§3.1.1), tudo o que os cards mostram. São sete consultas em lote mais a montagem dos jogos em destaque (uma vez, para todos os países), nenhuma por esporte ou por país; a montagem fica em `apps/api/src/explore/summary.ts`, com as escolhas em funções puras e testadas.

| Campo | Conteúdo |
|---|---|
| `window` | `from`/`to` (UTC) da janela de próximos jogos: 7 dias a partir de agora |
| `sports[]` | Na ordem do menu: `competitions` (catálogo, tier 1–2), `participants` (times, seleções, pilotos, equipes ou lutadores no banco), `upcoming` (jogos que começam na janela, sem adiados, cancelados e abandonados), `live` (em andamento agora, com a regra de `/v1/events/live`: dado parado além do horário previsto não conta) e `top_competitions` (até 4: primeiro as que tiveram jogos nos últimos 12 meses, depois menor tier, maior `prestige` e mais jogos — `id`, `slug`, `sport`, `name` localizado, `type`, `tier`, `logo`) |
| `countries[]` | Na ordem do menu, com `name`, `flag` e `confederation`: `competitions` (domésticas catalogadas, todos os esportes), `main_competition` (a liga de futebol do país: só ligas, menor tier, ordem de `featured` em config/geo, depois mais jogos), `top_teams` (até 5 clubes de futebol do país: os da base semântica primeiro, depois a soma de `importance` dos jogos dos últimos 12 meses; com `logo` e `colors` do escudo), `upcoming` e `live` (jogos da competição do país ou com participante do país, o mesmo recorte de `/v1/events?country=`) e `highlight` |
| `countries[].highlight` | O próximo jogo (na janela) de maior relevância no mercado do país: `Event` completo, como em `/v1/events/{id}`, com `relevance.market` = código do país (bônus de §3.2 e docs/06 §3.2). A relevância empata muito (toda rodada da liga soma o mesmo bônus), então o desempate é: mais clubes de `top_teams` em campo, jogo da `main_competition` e, por fim, o mais cedo. `null` sem jogo do país na janela |
| `confederations[]` | Seções (CONMEBOL, CONCACAF, UEFA) com os códigos dos países, como em `/v1/navigation` |

Exige `core_data`. Os esportes do plano do tenant limitam os jogos contados e os destaques; o catálogo é o mesmo para todos. Cache de **60 s** (tags `sport`, `competition`, `country`, `asset`): de propósito sem a tag `event`, para um placar não purgar o resumo inteiro, então `upcoming` e `live` envelhecem no máximo um minuto. Em `es-AR`/`es-XX` os nomes seguem a cadeia `es-XX → es → en`; `starts_at` do destaque respeita `?tz`.

```bash
curl -H "x-galaxie-key: $KEY" "http://localhost:8080/v1/explore/summary?locale=pt-BR&tz=America/Sao_Paulo"
```

```json
{
  "generated_at": "2026-10-22T19:54:29.317Z",
  "window": { "from": "2026-10-22T19:54:29.317Z", "to": "2026-10-29T19:54:29.317Z" },
  "sports": [
    { "slug": "football", "name": "Futebol", "competitions": 76, "participants": 9094, "upcoming": 378, "live": 3,
      "top_competitions": ["Liga dos Campeões", "Libertadores", "Copa do Mundo", "Liga Europa"] }
  ],
  "countries": [
    { "code": "BR", "name": "Brasil", "flag": "https://cdn…/flags/br.svg",
      "confederation": { "code": "CONMEBOL", "name": "CONMEBOL (América do Sul)" },
      "competitions": 18, "main_competition": "Brasileirão Série A",
      "top_teams": ["Palmeiras", "Flamengo", "Vasco DA Gama", "Fluminense", "Corinthians"],
      "upcoming": 51, "live": 1,
      "highlight": { "participants": ["Santos", "Palmeiras"], "starts_at": "2026-10-28T19:30:00-03:00",
                     "relevance": { "market": "BR", "score": 97, "bonus": 10, "reasons": ["team_from_market", "domestic_competition"] } } }
  ],
  "confederations": [{ "code": "CONMEBOL", "name": "CONMEBOL (América do Sul)", "countries": ["BR", "AR", "…"] }]
}
```

(Exemplo resumido: competições e clubes são objetos completos, e `highlight` é o `Event` inteiro.)

#### 3.1.3 Agenda dos próximos dias (`apps/api/src/explore/agenda.ts`)

`GET /v1/explore/agenda?locale=&tz=&sport=&country=&competition=&day=&market=&limit=&cursor=` lista os jogos que o resumo conta, com a **mesma consulta** (`selectWindowEvents`), a mesma janela (agora até +7 dias, fim exclusivo) e as mesmas regras: sem adiados, cancelados, abandonados e encerrados; `country` é a competição do país ou um participante do país. Sem filtro, `total` é a soma de `sports[].upcoming` do resumo; com `country=BR`, é o `countries[BR].upcoming`.

| Campo | Conteúdo |
|---|---|
| `total` | Jogos da janela com os filtros |
| `days[]` | Cada dia civil que a janela toca, no fuso `tz`, com a contagem (zero incluído) |
| `day` | O dia dos jogos em `data`: o pedido (`day`) ou o primeiro com jogos |
| `facets` | Contagens para os filtros (`sports`, `countries` da navegação, `competitions` com mais jogos), cada uma com os outros filtros aplicados |
| `highlights[]` | Até 6 jogos de maior relevância no mercado (`market`; sem mercado, maior importância), com `relevance`. A nota é a exata (a de `/v1/events/{id}`), calculada sobre os 30 jogos mais importantes da janela e os 30 mais importantes do país do mercado |
| `data[]` | Os jogos de `day`, por horário; `next_cursor` pagina dentro do dia |

Exige `core_data`; os esportes do plano limitam os jogos, como no resumo. Cache de **60 s**, como o resumo.

### 3.2 Eventos

| Método e rota | Descrição |
|---|---|
| `GET /v1/events?date=&from=&to=&sport=&competition=&team=&country=&status=&importance_min=&market=&relevance_min=&stakes=` | Agenda multiesporte paginada por cursor, ordenada por `starts_at`, `importance` ou `relevance` |
| `GET /v1/events/live?sport=&competition=&market=&stakes=` | Eventos ao vivo |
| `GET /v1/events/{id}?market=&stakes=` | Evento completo: participantes, placar, estado, momentum, clássico, contexto, importância, relevância no mercado e em todos os mercados ativos (`relevance_by_market`) |
| `GET /v1/events/{id}/timeline` | Minuto a minuto: lances com peso de momento-chave, placar parcial, marcos do jogo e disputa de pênaltis cobrança a cobrança; instantes em UTC (§3.2.1) |
| `GET /v1/events/{id}/lineups` | Escalações e formação |
| `GET /v1/events/{id}/stats` | Estatísticas por time e jogador |
| `GET /v1/events/{id}/where-to-watch?country=BR&region=SP` | Opções de transmissão (§4) |
| `GET /v1/events/{id}/context?locale=pt-BR` | Cenário pré-jogo / resumo pós-jogo gerado por IA, com fontes |
| `GET /v1/events/{id}.ics` | Arquivo de calendário |
| `GET /v1/events/{id}/h2h` | Histórico do confronto (do espelho, sem nova chamada) |
| `GET /v1/events/{id}/card` | Card de MMA da luta: card principal, preliminares e preliminares iniciais |

Exemplo de evento canônico:

```json
{
  "id": "0192c7e2-6c1f-7a33-9a51-5b3e0f7c2d10",
  "sport": "football",
  "competition": { "id": "…", "slug": "libertadores", "name": "CONMEBOL Libertadores", "nickname": "Glória Eterna" },
  "stage": { "kind": "semi_final", "leg": 2, "name": "Semifinal · Volta" },
  "starts_at": "2026-10-22T00:30:00Z",
  "status": "scheduled",
  "momentum": "today",
  "participants": [
    { "side": "home", "id": "0192c7e2-…-palmeiras", "name": "Palmeiras", "logo": "https://assets.galaxie.sports/api-sports/football/teams/121.png?v=9879fc79",
      "nickname": "Verdão",
      "fan_tags": [{ "code": "advances_with_draw", "priority": 34, "text": { "pt-BR": "Avança com empate" } }],
      "cheer": { "text": "Avanti, Palestra!", "source_url": "https://pt.wikipedia.org/wiki/Sociedade_Esportiva_Palmeiras" } },
    { "side": "away", "id": "0192c7e2-…-fluminense", "name": "Fluminense", "logo": "https://assets.galaxie.sports/api-sports/football/teams/124.png?v=1f0c2a7e",
      "nickname": "Tricolor",
      "fan_tags": [
        { "code": "needs_win_by_2", "priority": 31, "text": { "pt-BR": "Precisa vencer por 2 gols" } },
        { "code": "win_by_1_goes_to_penalties", "priority": 36, "text": { "pt-BR": "Vencer por 1 leva aos pênaltis" } }
      ],
      "cheer": null }
  ],
  "score": { "home": null, "away": null, "aggregate": { "home": 2, "away": 1 } },
  "venue": { "id": "…", "name": "Allianz Parque", "city": "São Paulo" },
  "referee": { "name": "Wilton Pereira Sampaio", "country": "Brazil" },
  "derby": null,
  "competition_context": ["semifinal", "knockout"],
  "stakes": [
    { "team": "home", "team_id": "0192c7e2-…-palmeiras", "code": "advances_with_draw", "text": { "pt-BR": "Avança com empate" },
      "phase": "pre_match", "salient": true },
    { "team": "away", "team_id": "0192c7e2-…-fluminense", "code": "needs_win_by_2", "text": { "pt-BR": "Precisa vencer por 2 gols para avançar direto" },
      "phase": "pre_match", "salient": true },
    { "team": "away", "team_id": "0192c7e2-…-fluminense", "code": "win_by_1_goes_to_penalties", "text": { "pt-BR": "Vitória por 1 gol leva a decisão aos pênaltis" },
      "phase": "pre_match", "salient": true }
  ],
  "data_freshness": { "last_valid_at": "2026-10-21T13:00:05Z", "is_stale": false }
}
```

> Os IDs de times acima são ilustrativos; os IDs reais vêm do `provider_map` após o bootstrap. Os códigos de `stakes` e seus textos nos 8 mercados estão catalogados em [docs/rules](rules/README.md#catálogo-de-códigos); a tabela código → tag do torcedor (`fan_tags`), em [docs/rules/tags-torcedor.md](rules/tags-torcedor.md).

Convenções implementadas (`apps/api/src/routes/v1/events.ts`, montagem em `apps/api/src/events/builder.ts`):

- **Agenda** `GET /v1/events`: `{ data, next_cursor }`, `limit` 1–200 (padrão 50). `date` é o dia civil no fuso `tz` e tem precedência; `from`/`to` aceitam dia civil (início/fim inclusivo do dia no fuso) ou instante ISO 8601; **sem nenhum dos três, a agenda começa hoje** (no fuso). `competition` aceita UUID ou slug; `team` é o UUID do participante; `country` casa o país da competição **ou** de um participante; `status` é lista separada por vírgulas; `importance_min` 0–100. `order=starts_at` (padrão, crescente; cursor `starts_at,id`) ou `order=importance` (decrescente, depois horário; cursor `importance,starts_at,id`). Tenant com `sports` restritos só vê esses esportes; pedir outro → 403.
- **Importância e relevância** (docs/06 §3.1 e §3.2): `importance` (0–100) é global, gravada pelo ingestor, com `importance_breakdown: { tier, phase, derby, decisive, prestige, flags }` (soma limitada a 100; `flags` ⊂ `title`, `relegation`, `elimination`, `qualification`; `null` em evento ainda não recalculado). `relevance: { market, score, bonus, reasons, details }` é calculada na requisição para o mercado de `market` (ISO2, qualquer caixa; inválido → 400) ou, sem ele, para o único mercado do plano do tenant; sem mercado, `null`. Bônus: +10 participante do país, +5 competição do país ou continental da confederação (globais não contam), +5 semifinal de mata-mata cuja outra semifinal tem um time do país (define o adversário dele na final ou, decidida a outra semi e com disputa de 3º lugar, no 3º lugar), teto 10; mais a audiência da competição no país (`config/geo/market-audience.yaml`, 0–40: liga nacional no próprio país +35, Premier League e LaLiga +20…), fora do teto; `bonus` = bônus do país + audiência (0–50) e `score = min(100, importance + bonus)`; `reasons` ⊂ `team_from_market`, `domestic_competition`, `continental_competition`, `decides_final_opponent`, `decides_third_place_opponent`, `market_audience` (lista que pode crescer: trate código desconhecido como genérico). `details[]` repete cada motivo com `points` (do motivo isolado; a soma pode passar do teto), `text` no locale da resposta e `participant` (`{ id, name }` do time da outra semifinal; `null` nos demais). No detalhe (`GET /v1/events/{id}`), `relevance_by_market[]` traz a mesma conta em todos os mercados ativos (`markets` de `config/geo/confederations.yaml` mais os do plano do tenant), da maior nota para a menor; nas listas é `null`. Nas listas (`/v1/events`, `/v1/teams/{id}/events`), `relevance_min` filtra e `order=relevance` ordena (decrescente, depois horário; cursor `relevance,starts_at,id`) — ambos exigem mercado (sem ele → 400). O mercado entra no `vary` do cache; não precisa estar entre os mercados do plano (a relevância usa só dados públicos do catálogo).
- **Jogo provisório** (docs/04 §3.4.1): anunciado oficialmente e ainda não publicado pelo fornecedor. Aparece em todas as listas como qualquer jogo, com `provisional: { announced_by, time_confirmed, sources[], note }` (nos demais, `null`). Com `time_confirmed: false`, só a data vale: `starts_at` traz o meio-dia no fuso do local e `status_detail` é `TBD` — mostre "horário a confirmar". Quando o fornecedor publica, o **mesmo `id`** vira oficial e `provisional` passa a `null`. Na busca, provisórios entram até 90 dias à frente (`event.provisional: true`); no Explorar, cada país traz até 2 em `announced[]`.
- **Ao vivo** `GET /v1/events/live`: `{ data }` (até 500) com `status` `live`, `break` ou `suspended`, por importância; TTL 10 s. A lista é "ao vivo de verdade": fica de fora o que o relógio dos eventos (`events-clock`, docs/04 §3.1) já teria encerrado — `live`/`break` **sem dado fresco** do fornecedor (`is_stale` ou última leitura há mais de 10 min) depois de `ends_at_expected` — e o `suspended` parado há mais de 24 h depois do fim previsto. Assim um job do relógio parado não deixa a lista cheia de jogos "ao vivo" com placar vazio. Ainda dentro da janela, um jogo que entrou em `live` só pelo horário (`temporal_fallback`, sem confirmação do fornecedor) aparece com `score` nulo e `data_freshness.is_stale: true`: o placar é desconhecido, não 0 × 0.
- **Evento**: `competition` com `nickname` (primeiro apelido de `semantic.competition_profile` no locale) e `logo`; `stage.name` localizado (`core.stage.name`) com a perna — `Semifinal · Volta` / `Semifinales · Vuelta`. A perna vem do confronto: duas partidas do mesmo par na mesma fase (a mais antiga é a ida); com regulamento de jogo único, não há perna. `score` traz `halftime`, `extratime`, `penalty` e `aggregate` (só no jogo de volta, com a ida encerrada: ida + placar atual da volta, nos lados da volta). `participants[]` com `logo`, `nickname` (primeiro apelido da base semântica) e `winner`; `clock` e `status_detail` do fornecedor; `importance` gravada pelo ingestor; `momentum` calculado no fuso pedido (docs/04 §3.2).
- **`derby`**: `{ slug, name (localizado), intensity }` de `core.event.derby_id`.
- **`venue`** e **`referee`** (lista e detalhe): `venue` = `{ id, name, city }` de `core.venue` (estádio e cidade) ou `null`; `referee` = árbitro principal de `core.football_fixture.referee` (`fixture.referee` da api-sports, "Nome, País"), separado em `{ name, country }` — `country` é o trecho depois da última vírgula, como o fornecedor escreve (ex.: `Brazil`), ou `null` sem sufixo. Sem escala (ou fora do futebol) → `null`.
- **`competition_context`**: `regular` (pontos corridos/grupos/fase de liga), `knockout`, `semifinal`, `final`, `playoff` (pela fase), `derby`, `lead` (um dos dois é o 1º da tabela), `title`/`relegation` (quando algum stake trata disso).
- **`stakes`**: só para competições **com regulamento próprio** em `config/rules` (sem arquivo, nada é afirmado). Mata-mata (antes e durante o jogo): `knockoutStakes` com as regras da fase (`knockout_round` "1st Round" → `first_round` no YAML); a volta exige a ida encerrada no `core`. Pontos corridos: `leagueMatchStakes` com a tabela de `core.standing` (o grupo que contém os dois times; com dois rótulos de grupo para a mesma liga, vale o de mais jogos somados) e os demais jogos da mesma rodada. Cada item traz **`phase`** e **`salient`**:
  - **Saliência** (padrão): para cada time, no máximo 3 códigos por fase, os mais relevantes; o improvável sai. Um código de briga (título, rebaixamento, eliminação, vaga) só fica se a distância do time para ela, em pontos, cabe em `max(3, ⅓ × pontos em disputa)` (pontos em disputa = jogos restantes × pontos da vitória): com 7 rodadas por jogar, o 2º colocado a 34 pontos do Z4 não "ainda corre risco de rebaixamento" e o 12º a 15 pontos do G4 não "ainda pode garantir a Libertadores". "Garante ao menos X" sai quando há título ou vaga melhor em jogo. Ordem: decididos > decisivos > disputas > situação ([regra completa e testes](rules/README.md#35-saliência-o-que-mostrar-para-cada-time)). Mata-mata e `both` não são cortados. **`?stakes=all`** devolve a lista completa do motor, com `salient: true` nos escolhidos (os códigos não mudam; o cache varia por esse parâmetro). `competition_context` (`title`, `relegation`) segue a lista saliente.
  - **Jogo encerrado de pontos corridos**: o que estava em jogo (`phase: "pre_match"`, com a tabela de **antes** do jogo: a atual menos este jogo e os que começaram no mesmo instante ou depois) e o que o resultado mudou (`phase: "result"`, tabela de antes + só este jogo): posição (`moved_up_to_13` "Subiu para o 13º lugar", `stayed_at_17`), zona (`climbed_out_of_relegation`, `dropped_into_relegation`, `entered_sudamericana`, `left_libertadores_group_stage`, `took_the_lead`), garantias e perdas matemáticas (`clinched_title`, `clinched_safety`, `relegation_confirmed`, `lost_title_chance`, `lost_sudamericana_chance`…) e distância para as zonas depois do jogo (`points_behind_sudamericana_1` "Fica a 1 ponto da vaga para a Sul-Americana", `points_above_relegation_5`, `points_below_safety_2`, `points_behind_leader_2`, `points_ahead_at_top_3`; [catálogo](rules/README.md#catálogo-de-códigos), [regra](rules/README.md#34-jogo-encerrado-o-que-o-resultado-mudou)). Se a tabela atual não bate com os resultados encerrados da temporada (tabela desatualizada), nada é afirmado: `[]`. Mata-mata encerrado continua sem stakes (o desfecho do confronto está no resumo pós-jogo). Ex.: Vasco 3 × 2 Corinthians (rodada 32 de 2026) → Vasco `at_risk_of_relegation` (antes), `moved_up_to_13`, `points_behind_sudamericana_1`, `points_above_relegation_5` (resultado); Corinthians `at_risk_of_relegation`, `points_below_safety_2`, `stayed_at_17`.
  - Demais regras: `text` traz só o locale da resposta. Dados incompatíveis com o regulamento (ex.: mais jogos que o previsto) → `[]`. Cada stake traz `team_id` (o `participants[].id` do lado em `team`; `null` quando `team` é `both`), para o cliente agrupar por time sem depender do mando. **Final** (o confronto decide o título, `decides_title`): ninguém avança, quem vence é campeão; os códigos de avançar saem nas variantes de título (`needs_win_for_title` "Vitória no tempo normal dá o título", `wins_title_with_draw` "Empate dá o título", `needs_win_by_2_for_title`…; [catálogo](rules/README.md#catálogo-de-códigos)). Fora da final, os códigos não mudam. **"Busca o tetra"**: em final ou jogo que pode dar o título, cada time com contagem confiável ganha `seeks_title_{n}` (n = título buscado: `seeks_title_4` "Busca o tetracampeonato" / "Va por el tetracampeonato"), com `titles: { won, seasons, source: "wikidata" }` (ex.: `{ "won": 3, "seasons": ["1999", "2020", "2021"] }`). Os títulos vêm de `core.competition_title` (Wikidata P1346 por edição, com correções curadas documentadas) e só contam se decididos antes da partida, com o time ligado ao QID do Wikidata e a lista de campeões completa até a temporada anterior; senão, o código não sai ([regras](rules/README.md#33-histórico-busca-o-tetra)).
- **`participants[].fan_tags`** (tags do torcedor; só antes e durante o jogo): até 3 rótulos curtos (~30 caracteres), do ponto de vista de quem torce para aquele time, derivados dos `stakes` por uma tabela fixa (`fanTags` em `@galaxie/rules`; tabela completa em [docs/rules/tags-torcedor.md](rules/tags-torcedor.md)) — nada é gerado livremente. Cada item: `code` (o stake de origem), `priority` (menor = mais importante) e `text` no locale da resposta. Stakes `both` valem para os dois participantes; tags de texto idêntico são fundidas (fica a mais relevante); ordem por faixa: título (10–19) > rebaixamento (20–29) > eliminação/classificação no mata-mata (30–39) > vaga continental/acesso (40–49) > demais (50+). Em pontos corridos, as tags de mera possibilidade exigem proximidade real na tabela (`core.standing`): "Na briga pelo título" só até max(6, rodadas restantes) do líder; "Luta contra o rebaixamento" e as tags de permanência ("Vitória garante a permanência", "Pode se salvar hoje", "Livre do rebaixamento") só na zona ou até 6 pontos acima do primeiro time dentro dela; "De olho na X" só até max(6, rodadas restantes) do último time dentro da zona. Os `stakes` continuam matemáticos e as tags decisivas ("Pode ser campeão hoje", "Vencer ou cair") valem sempre ([regras](rules/tags-torcedor.md#relevância-para-o-torcedor-pontos-corridos)). Sem stakes (jogo encerrado, competição sem regulamento) → `[]`. Exemplos: `in_title_race` → "Na briga pelo título" / "En la pelea por el título"; `at_risk_of_relegation` → "Luta contra o rebaixamento"; `can_qualify_for_libertadores_group_stage` → "De olho na Libertadores"; `qualifies_for_sudamericana` → "Garantido na Sul-Americana".
- **`participants[].cheer`**: grito curto da torcida, da base semântica (`semantic.team_profile`, o mesmo perfil do `nickname`): primeiro `copy_hints.<locale>.cheer` (locale exato, o locale do próprio clube quando é o mesmo idioma — gritos do Boca em es-AR também para es-MX — e depois o idioma; pt-BR não cai para espanhol), depois `rallying_cries`. Só passa texto aprovado por `checkChant` sem erro nem aviso — letra de hino ou canção nunca é servida. `{ text, source_url? }` (`source_url` = primeira fonte do perfil) ou `null`. Como o `nickname`, não aplica o piso editorial de `SEMANTIC_MIN_REVIEW_STATUS`.
- **Card personalizado pelo clube do torcedor**: o parceiro que conhece o clube do usuário (perfil, favorito) escolhe o participante pelo `id` e monta o card de chamada da partida com `fan_tags[0]` (ou as três) e, se houver, o `cheer`. Em Palmeiras × RB Bragantino (rodada 32 de 2026), o torcedor do Palmeiras vê "Na briga pelo título" e "Avanti, Palestra!"; o do Bragantino, 9 pontos acima do Z4, não recebe "Luta contra o rebaixamento" (fica com o grito "Vamos, Massa Bruta!"), enquanto o do Vitória, 5 pontos acima, recebe. As frases completas (`stakes` filtrados por `team_id`) servem para o detalhe do card.
- **`/timeline`** (minuto a minuto, §3.2.1): `core.event_incident` na ordem do fornecedor (`sequence`), com `team` (lado e logo), `player`/`assist` (`id` do `core.person`, ou `null` com o nome do fornecedor; foto, camisa e posição da escalação) e `comments`; mais `kind`, `clock`, `occurred_at`, peso de momento-chave, placar parcial, marcos e disputa de pênaltis. Os campos antigos continuam iguais (mudança aditiva).
- **`venue.timezone`** (lista e detalhe): fuso IANA do local, quando conhecido — país do local (ou, sem ele, do mandante e da competição) e, nos países com vários fusos (Brasil, México, EUA…), a cidade. Sem certeza → `null`. É só conveniência de exibição: nenhum instante da API depende dele.
- **`/lineups`** e **`/stats`**: do detalhe da partida (`core.football_fixture.detail`); IDs do fornecedor resolvidos para os nossos via `provider_map` (times e pessoas, com foto). Sem detalhe sincronizado: `available: false` e listas vazias. Outros esportes: `available: false` por ora.
- **Estatísticas de time no `/stats`** (`teams[].statistics[]`, mudança aditiva): cada item mantém `type` e `value` crus do fornecedor e ganha `code` (código estável), `label` (rótulo no locale da resposta: pt-BR, espanhol e inglês de fallback), `numeric` (`"54%"` → 54, `"0.64"` → 0.64; `null` sem número) e `source`. A normalização fica em `@galaxie/providers` (`normalizeTeamStatistics`) e é a mesma que o agente de resumo pós-jogo lê. Tipos do fornecedor ainda não mapeados vêm com `code: null` e `label` = `type`. Sem "Passes %" mas com passes certos e totais, a API acrescenta `pass_accuracy_pct` com `source: "derived"` (certos ÷ totais, arredondado; `type` repete o código). Códigos:

  | `code` | `type` da api-sports | Rótulo (pt-BR) |
  |---|---|---|
  | `possession_pct` | Ball Possession | Posse de bola |
  | `shots_total` | Total Shots | Chutes |
  | `shots_on_goal` | Shots on Goal | Chutes no gol |
  | `shots_off_goal` | Shots off Goal | Chutes para fora |
  | `shots_blocked` | Blocked Shots | Chutes bloqueados |
  | `shots_inside_box` | Shots insidebox | Chutes dentro da área |
  | `shots_outside_box` | Shots outsidebox | Chutes de fora da área |
  | `xg` | expected_goals | Gols esperados (xG) |
  | `goals_prevented` | goals_prevented | Gols evitados |
  | `passes_total` | Total passes | Passes |
  | `passes_accurate` | Passes accurate | Passes certos |
  | `pass_accuracy_pct` | Passes % (ou derivada) | Precisão de passe |
  | `corners` | Corner Kicks | Escanteios |
  | `free_kicks` | Free Kicks | Tiros livres |
  | `fouls` | Fouls | Faltas |
  | `offsides` | Offsides | Impedimentos |
  | `yellow_cards` | Yellow Cards | Cartões amarelos |
  | `red_cards` | Red Cards | Cartões vermelhos |
  | `saves` | Goalkeeper Saves | Defesas |

  Exemplo: `{ "type": "Ball Possession", "value": "54%", "code": "possession_pct", "label": "Posse de bola", "numeric": 54, "source": "provider" }`.
- **`/h2h?limit=`** (1–50, padrão 10): confrontos **encerrados** entre os dois participantes no `core` (qualquer competição, exceto o próprio evento), do mais recente ao mais antigo; `summary` (`played`, `draws`, `wins`/`goals` por time) considera todo o histórico. Nunca chama o fornecedor.
- **`/card`** (só MMA; demais esportes → 404): a noite de lutas (fase `fight_card`) da luta, com `card` (`id`, `name`, `starts_at`, `ends_at`) e `fights` (eventos completos) na ordem de exibição — luta principal, card principal, preliminares, preliminares iniciais. Toda luta de MMA traz `fight`: `card`, `segment` (`main_card`/`prelims`/`early_prelims`, pelos blocos de horário do fornecedor e `is_main`), `main_event` (os dois sobrenomes no nome do card), `weight_class` (`code` do fornecedor e nome no locale) e `result` (`method` canônico — `ko`, `submission`, `decision_unanimous`, `decision_split`, `decision_majority`, `disqualification`, `draw`, `no_contest`, `other` —, `method_name` no locale, `detail`, `round`, `time`, `scorecards`; null até o desfecho chegar). Os cantos saem em ordem (`corner_red`, `corner_blue`), o `/h2h` conta vitórias pelo `winner` e a forma do lutador (`/teams/{id}/overview`) usa o vencedor e o método.
- **`/{id}.ics`**: `text/calendar` (RFC 5545) com um `VEVENT`: `UID <id>@galaxie.sports`, `DTSTART`/`DTEND` em UTC (`starts_at` e `ends_at_expected`), `SUMMARY` "Mandante × Visitante · Competição", `LOCATION`, `STATUS` (`CANCELLED` para cancelado/abandonado, `TENTATIVE` para adiado), linhas CRLF dobradas em 75 octetos. O título segue o locale; os horários não dependem de `tz`.
- **`/context?locale=&kind=scenario|recap`** (módulo `live_intelligence`; `apps/api/src/routes/v1/event-context.ts`): cenário pré-jogo e resumo pós-jogo dos agentes de IA (docs/07 §2.3), lidos de `enrich.event_context` por `readEventContext` (`@galaxie/db`, a mesma leitura dos agentes): a versão vigente por tipo no locale pedido, ignorando as rejeitadas pela revisão editorial — sem fallback entre locales (a copy é por mercado; locale sem texto → `data: []`). Cada item traz `text`, `sentences`, `origin` (`llm` aprovado pelos guardrails ou `fallback` determinístico), `model`, `confidence`, `review_status` (`auto`/`reviewed`), `generated_at` (no `tz`), `fits` (TV/mobile/web) e `sources` (core, regulamento com URL). Sem `kind`, os dois tipos. Evento inexistente → 404; esporte fora do plano → 403. TTL 1 h, purgado por `event.context_published` (tags `event_context:<id>` e `event:<id>`).
- **`context` no detalhe**: para tenants com `live_intelligence`, `GET /v1/events/{id}` traz `context: { scenario, recap }` (texto vigente no locale, `origin` e `generated_at`, ou `null`) — uma consulta indexada a mais; para os demais planos o campo não aparece (a resposta em cache varia por isso).
- **Cache**: detalhe com TTL de 10 s se ao vivo ou começando em até 2 h, 5 min se agendado e 1 h se encerrado; agenda até 5 min. Tags `event:<id>` (e `event` nas listas): `publishChange(db, { entityType: 'event', entityId })` purga. O plano do tenant (esporte) é verificado também quando a resposta vem do cache.

### 3.2.1 Minuto a minuto (`GET /v1/events/{id}/timeline`) e instantes em UTC

**Regra de tempo da API.** Instantes absolutos são RFC 3339 / ISO 8601. Na timeline, todos saem em **UTC com sufixo `Z`** (`occurred_at`, `data_freshness.last_valid_at`, `generated_at`), qualquer que seja o `tz` pedido. O **relógio de jogo** vem em campos separados e independentes de fuso — `clock: { period, minute, extra_minute, display }` (`45+2'` → `minute: 45`, `extra_minute: 2`). O evento traz o fuso IANA do local (`venue.timezone`, e `venue_timezone` na timeline) só para exibição. Nas listas e no detalhe do evento, `starts_at` continua seguindo `tz` (padrão `UTC`). Quem vende ou distribui o minuto a minuto deve guardar o UTC e converter só na tela.

**Resposta** (schema `EventTimeline` no OpenAPI):

| Campo | O quê |
|---|---|
| `status`, `status_detail`, `live`, `clock`, `score` | Estado atual do jogo (`live` = `starting`, `live`, `break` ou `suspended`) |
| `incidents[]` | Lances na ordem do jogo (`sequence` crescente; para "mais novo primeiro", inverta no cliente) |
| `incidents[].kind` | `goal`, `own_goal`, `penalty_goal`, `penalty_missed`, `yellow_card`, `second_yellow`, `red_card`, `substitution`, `var`, `shootout_scored`, `shootout_missed`, `other`. O fornecedor não separa pênalti perdido de defendido: os dois são `penalty_missed`. O segundo amarelo é derivado (vermelho para quem já tinha amarelo) |
| `incidents[].clock` | `period` (`first_half`, `second_half`, `extra_time_first`, `extra_time_second`, `penalty_shootout`), `minute`, `extra_minute`, `display`. Na disputa de pênaltis não há minuto |
| `incidents[].occurred_at`, `occurred_at_source` | Instante UTC (abaixo) |
| `incidents[].weight`, `key_moment`, `flags` | Peso do momento (0–100): **decisivo 100** > pênalti (convertido ou perdido) 80 > vermelho/segundo amarelo 70 > VAR sobre gol, pênalti ou vermelho 65 > gol 60 > cobrança na disputa 45 > outro VAR 40 > amarelo 30 > substituição 10. `key_moment` = peso ≥ 60 (é o filtro "só os principais"). `flags`: `opener`, `go_ahead`, `equalizer` e `decisive` — o gol da vitória (o do vencedor que o pôs à frente de vez) ou a cobrança que decidiu os pênaltis, **só com o jogo encerrado** |
| `incidents[].score_after` | Placar depois do gol (o lado vem de `team`; no gol contra, `team` é quem se beneficiou). Na disputa, o placar da disputa |
| `incidents[].player_in`, `player_out` | Substituição: quem entra e quem sai. O fornecedor manda quem sai em `player` e quem entra em `assist`; se a escalação disser o contrário (reserva em `player`, titular em `assist`), a API corrige |
| `player`, `assist`, `player_in`, `player_out` | `TimelinePerson`: `id` do core (ou `null`), nome, `photo`, `number` e `position` (G, D, M, F) da escalação, quando sincronizada |
| `markers[]` | Marcos derivados do estado: `kickoff`, `halftime`, `second_half`, `end_of_regulation`, `extra_time`, `penalty_shootout`, `full_time` — com `clock` (onde acontecem) e instante quando conhecido. A prorrogação só aparece com evidência (código `ET`/`AET`, lance nela ou gol de prorrogação); `extratime: 0 × 0` sozinho não basta |
| `shootout` | `first_kicker` (quem bateu primeiro), `score`, `winner_side` e `kicks[]`: `order`, `round` (cobrança do time), cobrador, `scored` (✓/✗), placar corrido e `decisive` |
| `venue_timezone`, `data_freshness`, `generated_at` | Fuso do local; última leitura válida do fornecedor; quando a resposta foi montada |

**Como sai o `occurred_at` (UTC, precisão de minuto).** Em ordem de preferência:

1. `clock`: **início do período + relógio de jogo**. O início do 1º e do 2º tempo vem do fornecedor (`fixture.periods`, em `core.football_fixture.summary`) ou, sem ele, do log de estados (`core.event_state_log`): a transição confirmada pelo fornecedor para `1H`, `2H` ou `ET` (o Live Poller registra a hora real em que observou a mudança). Só vale a fronteira de verdade: `2H`/`ET` saindo de um intervalo observado e `1H` até 30 min depois do horário marcado — se o poller pegou o jogo já no meio, essa primeira observação não vira início de período. O lance no minuto `m` (+`e`) de um período que começa no minuto-base `b` (0, 45, 90, 105) recebe `início + (m − b − 1 + e)` minutos — o começo daquele minuto de jogo.
2. `observed`: sem início de período, a primeira gravação do lance pela Galaxie (do UUIDv7 da linha), **só** se o jogo foi acompanhado ao vivo (o fornecedor confirmou um estado em andamento) e até 5 min depois do apito final observado. É um limite superior (o lance aconteceu até ali).
3. Sem nenhum dos dois (jogo importado depois de encerrado, como uma carga histórica): `null`. A API não inventa horário a partir do horário marcado.

Os marcos usam a mesma fonte: `kickoff`/`second_half` do fornecedor (`provider`) ou observados; `halftime`, `end_of_regulation` (intervalo `BT`), `extra_time` e `full_time` (encerramento observado vindo de um estado em andamento) só quando o Live Poller os viu (`observed`).

**Tempo real.** A timeline tem TTL de 10 s ao vivo e 1 h encerrada, e é purgada pelas mesmas mudanças do evento (tag `event:<id>`). Para atualizar sem polling, assine `GET /v1/stream?events=<id>&topics=score,status,incidents` (§5.1) e releia a timeline a cada mudança; a demo faz isso e mantém uma verificação completa a cada 30 s (15 s se o SSE cair).

### 3.3 Times, atletas e semântica

| Método e rota | Descrição |
|---|---|
| `GET /v1/teams?sport=&country=&competition=&q=` | Busca de times/seleções |
| `GET /v1/teams/{id}` | Detalhe do time (estádio, país, cores e gradiente sugerido, IDs externos) |
| `GET /v1/teams/{id}/overview?season=` | Posição no torneio, forma recente (últimos 5), últimos resultados, próximo jogo + onde assistir; com `season`, o time naquele ano |
| `GET /v1/teams/{id}/events?from=&to=` | Jogos do time |
| `GET /v1/teams/{id}/squad?season=` | Elenco e comissão técnica |
| `GET /v1/teams/{id}/career` | F1: carreira do piloto ou do construtor (temporada a temporada, temporada atual com o bloco da sprint, títulos, vitórias, poles, pódios, top 10, abandonos, melhor resultado e melhor largada com a contagem, número do carro, pintura da equipe na época, nascimento, primeira e última corrida, equipes e companheiros) |
| `GET /v1/teams/{id}/traits` | F1: traços do piloto calculados do F1DB (pistas preferidas com o critério, sábado × domingo com o rótulo, duelo com os companheiros por temporada e na carreira, abandonos, pontos por largada, sequências e o nível do perfil) |
| `GET /v1/teams/{id}/editorial?min_review_status=` | F1: perfil editorial do piloto (bio, estilo, pontos fortes, momentos marcantes e rivalidades), cada item com a fonte; módulo `semantic` |
| `GET /v1/sports/formula-1/legends?limit=` | F1: as lendas (campeões mundiais e os 20 com mais vitórias e com mais GPs), por títulos e vitórias, cada uma com a temporada marcante (equipe, pintura da época, número e o carro ao fundo) e o retrato |
| `GET /v1/teams/{id}/photos?role=&season=` | Fotos de licença livre (Wikimedia Commons), cada uma com `credit` (autor, licença, links e a linha pronta) |
| `GET /v1/teams/{id}/semantic?locale=` | Cartão de identidade: apelidos, mascote, torcida, gritos, estádio, rivais, fatos, dicas de copy do mercado |
| `GET /v1/teams/{id}/rivals?locale=` | Rivais e clássicos do time (segmentação/CRM) |
| `GET /v1/derbies?country=&team=` | Clássicos |
| `GET /v1/derbies/upcoming?days=7&country=` | Clássicos dos próximos dias (eventos com `derby_id`) |
| `GET /v1/derbies/{slug}` | Clássico + retrospecto calculado dos eventos do `core` |
| `GET /v1/glossary?locale=&category=` | Glossário esportivo por mercado ("secar", "hinchar por", "le voy al", "hacer fuerza"…) |
| `GET /v1/people/{id}` | Jogador/técnico/piloto |
| `GET /v1/search?q=&types=&sport=&limit=` | Busca global: times, competições, jogos, pessoas, estádios e países por nome e apelido (§3.6) |
| `GET /v1/copy?locale=&sport=&intent=&tone=&affinity_type=&affinity_source=&momentum=&context=&team=&rival=&minutes=` | Microcopy sugerida (badges, chamadas) respeitando `copy_permission` |

**Nome de exibição dos times** (`apps/api/src/teams/display-name.ts`). O `name` de um time é o mesmo em todas as respostas (evento, listas, classificação, contexto, busca, perfil, pessoa) e depende do `locale`:

1. Time com perfil na base semântica no piso editorial (`SEMANTIC_MIN_REVIEW_STATUS`): o rótulo do idioma (`labels`, cadeia es-AR → es → en) ou, sem rótulo, o nome curto curado (`names.short`). É o mesmo nome de `/v1/teams/{id}/semantic` e dos gritos da torcida ("São Paulo", não "Sao Paulo").
2. Sem perfil (ou abaixo do piso): o nome do fornecedor com o corretor de acentos (`teams/accents.ts`). O corretor só troca palavras inteiras de uma lista fixa por idioma, e só quando o país do time é de língua portuguesa (BR, PT, AO, MZ…) ou espanhola (ES e América hispânica). Ex.: "Gremio" → "Grêmio", "Leon" → "León". Pilotos, lutadores e atletas não passam pelo corretor.

O nome do fornecedor segue em `provider_name` (times de evento, `TeamSummary`, `ParticipantRef`, `ExploreTeam` e o confronto direto). `GET /v1/teams?q=` e `/v1/search` acham o time com e sem acento.

#### 3.3.1 Implementação da semântica (`apps/api/src/routes/v1/semantic.ts` e `copy.ts`)

- **Módulo `semantic`** em todas as rotas desta tabela a partir de `/v1/teams/{id}/semantic` (planos `fan_experience`, `live_intelligence` e `enterprise`). As demais rotas de times ficam com `/v1/teams` (#32).
- **`{id}` de time** aceita o UUID do participante (`core.participant`, ligado por `semantic.team_profile.participant_id`) ou o slug do perfil (`palmeiras`). Clássico usa o slug (`choque-rei`).
- **Piso editorial (`review_status`).** Cada item da base tem `draft`, `reviewed` ou `approved`. A API serve só itens com status ≥ ao mínimo efetivo = o maior entre o piso do servidor e `?min_review_status=` — o cliente **endurece, nunca afrouxa**. Piso do servidor: variável `SEMANTIC_MIN_REVIEW_STATUS` (padrão **`approved`**, o de produção; em desenvolvimento local use `draft`, já que toda a base ainda está em revisão). Listas filtram; detalhe abaixo do piso → 404 com `detail` explicando o motivo. Um piso por tenant fica para quando houver configuração por tenant no schema `api`.
- **Perfil da competição** (`semantic.competition_profile`: rótulo, apelidos e `trophy_nickname`): o piso do servidor vale em toda a API que o lê — catálogo e busca de competições, navegação, `/v1/search`, evento, contexto competitivo, campanhas e tabela do time, pessoa e explorar (`apps/api/src/competitions/profile.ts`). Abaixo do piso, a competição sai com o rótulo do catálogo (`core.competition.labels`) ou o nome do fornecedor, sem apelidos nem troféu, e a busca não casa pelos apelidos dela. O status é o que o seed grava (com as decisões do painel de revisão por cima do YAML) e o que o painel atualiza na hora.
- **Locale.** Nomes de time/clássico seguem `labels` com a cadeia `es-XX → es → en`; `copy_hints` usa o locale, o do próprio clube quando é o mesmo idioma e o idioma (`es-MX → es-AR do Boca → es`); o glossário, só o locale e o idioma; nunca outro idioma. Fatos (`identity`), `mascot`, `colors` e `fans` do cartão do time e `origin`/`trivia` do clássico vêm, campo a campo, da tradução do locale, depois da do idioma (`data/knowledge/i18n`, só as que atingem o piso editorial) e por fim do original do YAML; `text_locale` diz de onde veio o texto principal — diferente do pedido quando o mercado ainda não tem tradução publicada ([docs/06 §3.3](06-semantica-e-conteudo.md#33-textos-livres-por-idioma)). `/v1/copy` não tem fallback entre locales (copy é localizada pela intenção).
- **`/v1/derbies`**: lista completa (`{ data }`), por intensidade e slug; `country` casa o país de qualquer um dos dois times; `team` inexistente → 404.
- **`/v1/derbies/upcoming`**: eventos com `core.event.derby_id` entre agora e `days` dias (1–30, padrão 7), sem encerrados/cancelados/adiados; cache de agenda (5 min). Vazia enquanto não houver eventos futuros sincronizados.
- **`/v1/derbies/{slug}`**: retrospecto **calculado só de `core.event`** (status `finished`, placar presente, os dois participantes em qualquer mando) — nunca chama o provedor. Traz vitórias e gols por time, empates, até 3 maiores goleadas (saldo → gols → mais recente), últimos 5, primeiro/último confronto e `next_event`. Pênaltis aparecem em `penalties`, mas o jogo conta como empate. Sem os dois times ligados ao `core`, `retrospect.available = false`. TTL 1 h (muda a cada clássico encerrado).
- **`/v1/teams/{id}/rivals`**: rivais declarados no perfil + clássicos que incluem o time, com `derby`, `intensity` e `mutual` (os dois se declaram rivais); rival abaixo do piso é omitido e clássico abaixo dele vira `derby: null`.
- **`/v1/glossary`**: lido de `data/knowledge/glossary/<locale>.yaml` (validado por `pnpm knowledge:validate`), carregado uma vez por processo; pasta configurável por `KNOWLEDGE_DIR` (padrão: `data/knowledge` do repositório). Cada termo traz `requires` (`declared_rival`/`declared_affinity`) — a mesma regra do `copy_permission`.
- **`/v1/copy`**: templates de `semantic.copy_template` (seed da base) escolhidos por `selectCopy` (`packages/knowledge`). `affinity_source=inferred` → só `inform` tom 1; rivalidade só com `affinity_type=rival&affinity_source=explicit`. `team`/`rival` (UUID ou slug) preenchem `{team}`, `{nickname}` (apelido do mercado) e `{rival}`; `minutes` preenche `{minutes}`; com algum deles, templates com placeholder sem valor são descartados e `text` vem pronto; sem nenhum, `text` é `null` e o cliente preenche o `template`. `variant` é uma semente opaca para variar entre equivalentes — **nunca** envie dado pessoal. Sem template compatível, `selection: null` (200).
- **Cache**: 24 h (`semantic`) com `ETag`/304; tags `derby:<id>`, `team_profile:<slug>`, `derby`, `team_profile`, `copy_template`, `glossary`. O seed semântico ainda não publica no change feed: até lá, mudanças na base valem ao fim do TTL.

Convenções implementadas (`apps/api/src/routes/v1/teams.ts`):

- `GET /v1/teams`: `{ data, next_cursor }` ordenado por nome; `q` (≥ 2 caracteres) busca em nome, nome curto, código e apelidos/nomes/rótulos da base semântica, sem diferença de caixa nem de acento ("gremio" acha "Gremio" e "Grêmio"); `competition` (UUID ou slug) = times com jogos na competição. Cada item traz `nicknames` da base semântica (vazio sem perfil).
- **Logos do acervo customizado** (flag `ASSETS_CUSTOM_LOGOS` da operação, padrão desligada): ligada, todo `logo` de time e de competição (eventos, busca, navegação, classificação, elencos...) vem do acervo em alta quando há mapeamento, e as `colors` do time saem desse escudo. `Team` e `Competition` (detalhe) dizem a origem em `logo_source`: `provider`, `acervo` ou `null` sem logo. A troca não muda a URL de quem não tem logo no acervo ([runbooks/acervo-de-logos.md](runbooks/acervo-de-logos.md)).
- `GET /v1/teams/{id}`: resumo + `country_ref` localizado, `founded`, `venue` (estádio da casa, com imagem e nome curado), `colors`, `external_ids` e `former_names` (nomes anteriores do time derivados dos jogos do fornecedor, `origin: provider`, `confidence: low`; variações de grafia não contam e os nomes da base semântica vencem).
- `former_names` com `confidence: low` (origem `provider`) são **pistas** para busca e casamento de nomes, não fato confirmado editorialmente (podem ser casa provisória ou nome de torneio): nunca substituem o nome atual e não devem ser exibidos ao usuário final como fato. Para exibir, use só `confidence: high` (curadoria).
- Estádio em evento, time e `/v1/venues/{id}`: o nome curado da base semântica vence o do fornecedor (ex.: "Nubank Parque" no lugar de "Allianz Parque", que a api-sports ainda manda em `/teams`); jogos anteriores à troca também mostram o nome atual ([04 — nomes de estádios](04-modelo-de-dados.md#nomes-de-estádios-e-times-curadoria--fornecedor)).
- **`colors`** (também em `overview.team`): cores extraídas do escudo espelhado, sem chamada externa ([03 §7.2](03-ingestao-e-economia-de-chamadas.md#72-cores-dos-times-paleta-do-escudo)) — `primary` (cor predominante, `#rrggbb`), `secondary` (segunda cor com matiz distinto, ou `null`), `monochrome` (escudo preto/branco: `primary` vira o cinza neutro `#3a3a3a`) e `gradient`, o **gradiente sugerido** pronto para CSS: `linear-gradient(9deg, #000 0%, <primary> 100%)`. `null` enquanto o escudo não foi espelhado ou não é um PNG decodificável. Exemplo (Palmeiras): `{ "primary": "#006937", "secondary": null, "monochrome": false, "gradient": "linear-gradient(9deg, #000 0%, #006937 100%)" }`.
- `GET /v1/teams/{id}/overview`: em uma chamada, `team`, `standings` (por competição, a temporada atual ou a mais recente com tabela do time), `competitions` (campanha em cada competição, abaixo), `form` (últimos 5 encerrados, do mais recente ao mais antigo; placar do ponto de vista do time; empate decidido nos pênaltis usa o `winner` do fornecedor), `last_events` (5), `live_event` e `next_event` (próximo `scheduled`/`starting` a partir de 3 h atrás), todos no formato de evento de §3.2 (com stakes). Onde assistir do próximo jogo entra com a issue de onde assistir.
- **Temporada (`?season=`, overview)**: aditivo — sem o parâmetro, nada muda. Com o ano (`season.year` do banco), o overview mostra o time **naquele ano**: `standings` e `competitions` só das temporadas daquele ano (a campanha de cada competição, sem o corte de 12 meses: campeão, vice, eliminado ou posição final), `form` e `last_events` com os últimos encerrados daquele ano; `live_event` e `next_event` só vêm na temporada corrente (nas demais, `null`). Ano sem jogos do time devolve 200 com as listas vazias; ano fora de 1900–2100 ou não numérico, 400. A resposta sempre traz:
  - `season`: o ano pedido (`null` sem o parâmetro);
  - `seasons`: os anos com jogos do time, do mais recente ao mais antigo — `{ year, labels, events, has_incidents, current }`, para o seletor oferecer só anos que existem. `labels` são os rótulos do fornecedor das temporadas daquele ano (`["2020", "2020/21"]`), `has_incidents` diz se algum jogo tem lances, `current` marca a temporada corrente (a mais recente marcada como atual pelo fornecedor; sem nenhuma, a mais recente).
  - **Anos que cruzam o calendário**: o ano é sempre o `season.year` do banco, o **início** da temporada. Ligas europeias 2025/26 entram em `season=2025`; competições de ano único (Brasileirão 2025) em `season=2025`; temporadas deslocadas (Brasileirão 2020/21, jogado até fevereiro de 2021) ficam no ano de início, junto com o Paulista 2020. Os jogos seguem a temporada a que pertencem, não a data: `season=2020` inclui a final do Brasileirão 2020/21 em 2021.
- **`competitions`** (overview): a **campanha** do time na temporada atual (ou, sem ela, na mais recente) de cada competição — inclusive copas sem tabela; temporadas que não são a atual só entram se o time jogou nelas nos últimos 12 meses. Ordem: em disputa (`campaign.ongoing`) primeiro, depois a atividade mais recente. Cada item: `competition`, `season`, `group` (tabela do time, quando a fase tem tabela) e `campaign`:
  - `status`: `champion` (venceu a final, ou terminou em 1º uma liga de pontos corridos encerrada cujo regulamento define campeão), `runner_up`, `third_place` (venceu a disputa de 3º), `in_progress` (ainda na disputa), `eliminated`, `league` (liga de pontos corridos em andamento) e `finished_league` (liga encerrada, posição final). Perder a disputa de 3º = `eliminated` com `stage_kind: third_place` e `rank: 4`.
  - `stage_kind`: em `in_progress`, a fase atual — quem venceu a semifinal e ainda não tem a final marcada já aparece `final` ("Na final"); nos demais, a fase em que a campanha se decidiu.
  - `label` e `detail`: textos fixos (sem geração livre) no locale da resposta, no formato dos stakes (`{ "pt-BR": "Na final" }`); `detail` traz o confronto decisivo com adversário e placar do ponto de vista do time (`Final contra Novorizontino (3–1 no agregado)`, `Derrota para Chelsea (1–2)`, `Eliminou Fluminense nas semifinais (2–2 no agregado, 5–3 nos pênaltis)`, `Contra Estudiantes L.P. (ida: 0–0)`) ou posição e pontos nas fases de tabela (`2º lugar · 11 pts`). Nomes de clubes vão sem artigo (o gênero do nome não está na base). Textos em pt-BR, es (es-AR com "alargue"; demais es-* com "tiempo extra") e en.
  - `rank`/`points`: posição e pontos na fase de tabela (grupo, liga); `opponent`: adversário do confronto decisivo, do último vencido ou do que está em disputa; `decided_by_event_id`: último jogo do confronto que decidiu (ou classificou), `null` enquanto em disputa.
  - Regras (`apps/api/src/teams/campaign.ts`, funções puras): as fases do time são ordenadas por profundidade (`qualifying` < `regular`/`group`/`league_phase` < `playoff` < `knockout_round` < `round_of_128` … `semi_final` < `third_place` < `final`; no mesmo tipo, `core.stage.order`) e vale a mais profunda. Em mata-mata, o confronto (`groupTies`/`goalsOf` do montador de eventos) é decidido pelo **agregado por participante** (os mandos se invertem na volta), depois pelo regulamento (`tieOutcome` de `@galaxie/rules`: gol fora — na prorrogação só se `away_goals_in_extra_time` — e vantagem do empate em jogo único), depois pelos pênaltis (`score.penalty`) e, por fim, pelo `winner` do fornecedor; sem como decidir, segue `in_progress`. Em fase de tabela: com jogo pendente do time = em disputa; se a temporada já tem fase mais profunda sem o time = eliminado; liga pura (sem fases de confronto e `format: league` no regulamento, ou competição `league` sem regulamento) encerrada (nenhum jogo pendente na temporada) = `champion` (1º) ou `finished_league`.
- `GET /v1/teams/{id}/events`: mesmos filtros, ordenação e cursor da agenda (§3.2), sem janela padrão (sem `from`/`to`, todo o histórico em ordem crescente).
- `GET /v1/teams/{id}/career` (só F1, piloto ou construtor): calculado do core (F1DB + api-sports). Corrida = sessão `Race` (sprint fora); pole = 1º na classificação do GP; volta mais rápida = o piloto do `fastest_lap` da corrida; pódio só com chegada numérica. `seasons` traz a posição e os pontos do campeonato, as equipes (ou os pilotos, no construtor) e o `car` da temporada quando há foto no acervo; `highlight` é o carro de destaque do piloto (temporada mais marcante, curadoria no acervo), para o topo da página com o `portrait` na frente. Título só conta temporada encerrada (`final`): ano anterior ao atual ou já passado o último GP do calendário (`season.end_date`, que o F1DB traz mesmo com os GPs futuros fora da base). 404 fora da F1.
  - **Página de piloto** (os números da página oficial): `totals` traz `top10`, `dnfs` (abandono = DNF; desclassificação não conta), `best_finish` e `best_grid` com a contagem (`{ position: 1, count: 8 }` = "1 (x8)"; largada dos boxes não conta) e `sprint` (corridas, pontos, vitórias, pódios, poles e top 10; pole da sprint = 1º na classificação dela, de 2023 em diante; sem pontos no resultado, a tabela da época pela posição). Cada `seasons[]` tem os mesmos campos do ano e `number` (o número do carro mais usado nas sessões; sem ele, o permanente de 2014 em diante). `current_season` é a temporada corrente (a mais recente com corrida disputada) quando o piloto correu nela, e null para as lendas. `profile` (só piloto): primeiro nome e sobrenome, número permanente, data, local e país de nascimento (F1DB). `competition` dá o slug do campeonato para o link dos resultados de cada ano.
  - **Cores da equipe por época:** `seasons[].teams[].livery` (piloto) é a pintura curada em `data/knowledge/formula-1/liveries.yaml` (a McLaren de 1988 é vermelha e branca; a de 2024, papaia), com a fonte; null quando a época não está curada (use `colors`, do escudo). Respeita o piso editorial da semântica (`SEMANTIC_MIN_REVIEW_STATUS`). A equipe principal do ano vem primeiro.
- `GET /v1/sports/formula-1/legends` (o carrossel "Legendary"): o mesmo critério do escopo `lendas` do acervo da Commons (docs/runbooks/fotos-commons.md): todo campeão mundial (só temporada encerrada) e os 20 com mais vitórias e com mais GPs; `criteria` diz por quê (`titles`, `wins`, `races`). Ordem: títulos, vitórias, GPs e nome — objetiva, a mesma para todo cliente e idioma, e um campeão novo entra sozinho. GPs, vitórias e pódios contam como em `/career` (o card e a página do piloto mostram os mesmos números). `highlight` é a temporada marcante: a do carro de destaque do acervo ou, sem ele, a de título com mais vitórias (sem título, a de mais vitórias; empate, a mais recente), de preferência uma com foto do carro; traz a equipe principal do ano com a pintura da época e `constructor_name` (o nome do construtor sem o patrocinador de hoje), o número do carro e o `car` — nunca CC BY-SA, porque o card recorta a foto; null quando não há foto compatível (use a cor da equipe e o número). `active` = correu na temporada atual. `limit` corta na ordem. Cache de 1 h (tags `standing` e `asset`).
- `GET /v1/teams/{id}/career`, `profile` do piloto: além do nascimento e do número, `full_name`, `nicknames`, `death` (data, idade, local, acidente, causa e `race`, o GP que o F1DB marca como fatal), `family` (parentes pilotos, do F1DB) e `other_wins` (Indianápolis e Le Mans), com `sources` (F1DB e o item do Wikidata). Critérios no [runbook](runbooks/f1-perfil-editorial.md).
- `GET /v1/teams/{id}/traits` (só piloto de F1) e `GET /v1/teams/{id}/editorial`: critérios, níveis (lenda, regular, básico) e o fluxo de geração e revisão no [runbook do perfil editorial](runbooks/f1-perfil-editorial.md). O perfil editorial é lido de `data/knowledge/formula-1/editorial/<locale>.yaml` como o glossário (edições e decisões do painel por cima, tag de cache `f1_editorial`) e segue `es-XX → es → pt-BR`; `{id}` aceita o UUID do piloto ou o slug `f1-<id do F1DB>`.
- `GET /v1/teams/{id}/photos`: acervo de fotos de licença livre ([runbook](runbooks/fotos-commons.md)). Retrato primeiro, depois o carro de destaque (`highlight_car`), ação e carros por temporada. **Exibir a foto exige o crédito** (`credit.text` ou os campos separados, com os links): é a condição das licenças CC BY e CC BY-SA.
- `GET /v1/teams/{id}/squad?season=`: sem `season`, o elenco atual (`core.roster.season_id` nulo); com o ano, os elencos de temporadas daquele ano. `players`, `coaches`, `staff`, ordenados por posição (goleiro → atacante), número e nome; pessoa com `age` calculada.
- `GET /v1/people/{id}`: dados de `core.person`, foto, `age`, `teams` (elencos, atual primeiro) e `external_ids`.
- Cache: times e pessoas 24 h, elenco 1 h, overview/jogos até 5 min (10 s se houver jogo ao vivo ou começando); tags `participant:<id>`, `person:<id>`, `roster`, `event`.

### 3.4 Olimpíadas e Pan-Americano

| Método e rota | Descrição |
|---|---|
| `GET /v1/multisport/games?type=OG,PAN&year=&season=&status=` | Edições (Olimpíadas de Verão/Inverno, Pan-Americano) |
| `GET /v1/multisport/games/{slug}` | Edição |
| `GET /v1/multisport/games/{slug}/medals?sort=gold\|total&region=latam&noc=` | Quadro de medalhas |
| `GET /v1/multisport/games/{slug}/schedule?date=&sport=&noc=&medal_only=&tz=` | Agenda por dia/modalidade/país (paginada por cursor) |
| `GET /v1/multisport/games/{slug}/events/{id}` | Prova: fases, unidades, resultados e medalhas |
| `GET /v1/multisport/games/{slug}/nocs/{noc}/athletes` | Delegação |
| `GET /v1/multisport/games/{slug}/today/{noc}?date=&tz=` | "Brasil hoje" / "Argentina hoy" |
| `GET /v1/multisport/history/medals?noc=BRA,ARG&type=OG,PAN&season=` | Histórico de medalhas por país |

#### 3.4.1 Implementação (`apps/api/src/routes/v1/multisport.ts`)

- **Módulo `multisport`** (planos `live_intelligence` e `enterprise`). Países pelo código COI (`BRA`, `CHI`, `URU`…), case-insensitive; `noc` aceita lista separada por vírgula no histórico.
- **Regra de qualidade (docs/08 §6.4) — escolha: resposta sinalizada, não erro.** Quadro, ranking, medalhas do dia e histórico só são publicados quando `games.medal_data_quality` é `complete` ou `partial`. Fora disso a resposta é **200** com `data_quality: { level, coverage, publishable: false, notice }` e `data: []` (no histórico, a edição vai para `withheld`). Motivos: o cliente renderiza "indisponível" sem tratar erro, a resposta é cacheável e não há como exibir número errado (a lista vem vazia). `partial` sai com `notice` localizado ("Quadro parcial: cobertura de 95,7%…"). `unknown` (sem referência para medir) e edições futuras também não publicam.
- **Quadro**: view `multisport.medal_table` (derivada, sem revogadas); `rank` é a posição no critério pedido (`sort=gold` padrão COI ou `total`), empates dividem a posição; `region=latam` filtra `LATAM_NOCS` mantendo as posições globais. `sources` traz fonte e licença (Wikidata, CC0) para atribuição.
- **Agenda**: unidades (`multisport.unit`) da edição, por início; `date` é o dia **local** no `tz` pedido ou, sem `tz`, no fuso da sede; `sport` aceita código do esporte ou da disciplina (ODF); `noc` filtra unidades com resultado/participante do CON; `medal_only=true` só unidades de medalha. Vazia enquanto a agenda oficial não é carregada (hoje não há fonte de agenda).
- **Delegação** (`basis: medals_and_results`): atletas derivados das medalhas (individuais e integrantes de equipes) e dos resultados, por ouro → prata → bronze → nome. A lista oficial de inscritos é follow-up.
- **"Hoje"**: unidades do dia com o CON e medalhas com `awarded_at` no dia (só se publicável); `medal_chances` e `where_to_watch` vêm `null` (reservados). Sem `date`, "hoje" é calculado no fuso (`tz` ou da sede).
- **Cache**: edições e histórico 24 h; quadro 24 h (encerrada), 60 s (em andamento) ou 1 h (futura); agenda, provas e "hoje" 5 min; delegação 1 h. Tags `games:<id>`, `medal_table:<id>`, `medal`, `unit`.
- **#78**: os torneios coletivos (futebol, basquete, vôlei, handebol…) ficam ligados à edição por `multisport.games_competition` e seus jogos são eventos comuns do `core` (listados por `/v1/events`, #31, pela competição); quando houver agenda por unidade, a ligação unidade ↔ evento canônico sai em `core_event_id`.

### 3.5 Conteúdo relacionado

`GET /v1/events/{id}/related?type=highlights,goal&format=short&limit=20` — módulo `related_content`. Vídeos diretos sobre o evento (link e embed oficial da plataforma, nunca link de busca), classificados por tipo (`highlights`, `goal`, `penalties`, `press_conference`, `interview`, `behind_the_scenes`, `fan_reaction`, `analysis`, `full_match`, `other`) e formato (`short` | `long`), com canal e selo `source_tier` (`official`, `rights_holder`, `media`, `creator`), duração, miniatura da plataforma e visualizações; `counts` traz o total por tipo antes dos filtros. Cache de 1 h purgado por `event.related_content_changed`. Detalhes, fontes e regras de direitos em [12](12-conteudo-relacionado.md).

### 3.6 Busca global (`apps/api/src/routes/v1/search.ts`)

`GET /v1/search?q=&types=&sport=&limit=&locale=` — módulo `core_data`. Uma chamada para a caixa de busca dos clientes (a demo usa no ⌘K):

| Parâmetro | Regra |
|---|---|
| `q` | 2 a 80 caracteres, sem diferença de caixa nem de acento (`verdao` = `Verdão`). Com 2 caracteres, só casa no começo de uma palavra (`br` acha Brasil, não Gibraltar). |
| `types` | Lista separada por vírgula de `team`, `competition`, `event`, `person`, `venue`, `country` (padrão: todos). |
| `sport` | Só times, competições, jogos e pessoas desse esporte (estádios e países ficam de fora). Sem ele, valem os esportes do plano. |
| `limit` | Máximo **por tipo**, 1–20 (padrão 5). |

Onde cada tipo procura:

- `team`: nome de exibição (§3.3), nome do fornecedor, `short_name`, `code` e, da base semântica (`semantic.team_profile`), nomes oficial/curto/sigla, `labels` por locale e apelidos; também os nomes anteriores derivados dos jogos.
- `competition`: nome localizado (`labels` do catálogo e da base semântica), nome do fornecedor, slug, apelidos por locale e apelido do troféu. Traz `slug`.
- `event`: jogos ao vivo (a mesma regra de `/v1/events/live`) e agendados dos próximos 14 dias dos 8 melhores times encontrados; o jogo herda o casamento do time. `event` traz `starts_at`, `status`, `live`, competição e participantes (casa primeiro).
- `person`: nome, nome completo (`first_name` + `last_name`) e sobrenome; `detail` é o time do elenco mais recente.
- `venue`: nome curado (vence o do fornecedor), nome do fornecedor, apelidos e nomes anteriores (curadoria e fornecedor); a cidade não conta como nome.
- `country`: nome em todos os locales; código ISO e sigla do COI só por inteiro (`bra`).

Resposta: `{ "q": "verdao", "data": [SearchResult…] }`, uma lista só. Cada item tem `type`, `id` (código em `country`), `name` no locale, `match` (`exact` · `prefix` · `contains`), `matched` (o apelido, sigla ou nome anterior que casou; `null` quando foi o próprio nome), `sport`, `country`, `image` (escudo, logo, foto, imagem do estádio ou bandeira) e `detail` (país do time ou da competição, time da pessoa, cidade do estádio, competição do jogo, confederação do país).

Ordem: primeiro o nível do casamento (exato, começo do nome ou de uma palavra, trecho); no empate, a ordem de `types` e a relevância dentro do tipo — times com perfil na base semântica, depois o melhor tier e o número de jogos no último ano; competições por tier e prestígio; pessoas com elenco e foto; estádios curados e por capacidade.

Implementação: o SQL pré-seleciona até 40 candidatos por tipo com um regex `~*` em que cada letra vira uma classe com as variantes acentuadas (sem a extensão `unaccent`; dobrar cada linha com `translate` custava ~10× mais) e ordena pelo nível do casamento; o JS confirma o casamento e escolhe o apelido (`apps/api/src/search/match.ts`). Cache: 24 h (`catalog`) sem jogos; 5 min (`schedule`) quando `types` inclui `event` (o padrão). O smoke test pós-deploy (`infra/vps-telemetry/smoke.mjs`) confere que `verdao` acha o Palmeiras.

## 4. Onde assistir

```http
GET /v1/events/{id}/where-to-watch?country=BR&region=SP&locale=pt-BR
```

```json
{
  "event_id": "0192c7e2-…",
  "country": "BR",
  "status": "resolved",
  "message": null,
  "options": [
    {
      "id": "…",
      "provider": "Emissora de TV aberta X",
      "channel": "Canal X",
      "medium": "free_tv",
      "access_model": "free",
      "region": null,
      "confidence": 0.97,
      "status": "confirmed",
      "last_verified_at": "2026-10-21T12:00:00Z",
      "sources": [ { "publisher": "Organizador da competição", "url": "https://…" } ],
      "logo": "https://assets.…/broadcasters/3f2a….svg",
      "logo_dark": "https://assets.…/broadcasters/9c1e….svg"
    }
  ],
  "to_confirm": [],
  "updated_at": "2026-10-21T12:00:00Z"
}
```

Regras de contrato:

| Regra | Comportamento |
|---|---|
| Sem informação confiável | `status: "unknown"`, `options: []` e `message` localizada ("Não temos as informações de transmissão ainda.") — o evento **continua** existindo |
| Detentores conhecidos, jogo ainda não alocado | `options: []` e `to_confirm` com os detentores de direitos do país ("canal a confirmar"); some assim que alguma opção for confirmada |
| Conflito entre fontes ou confiança < limiar | Opção **omitida** (registrada internamente como `omitted`) |
| Mesma plataforma vinda de várias fontes | Deduplicada; fontes agregadas em `sources` |
| Correção aceita (inclusão/remoção) | Propagada ao cliente em **≤ 5 min** (purge de cache + SSE + webhook `where_to_watch.changed`). O trigger de `enrich.broadcast_option` publica a mudança no change feed sem depender do writer; purge das tags `where_to_watch:<evento>` e `event:<evento>` em < 1 s (§5, §7.1) |
| Ordenação | A API ordena por `medium`/confiança; a **ordenação final por direito de acesso do usuário** (incluído, ativação, upgrade, extra, externo) é responsabilidade do cliente, que conhece o assinante |
| Limite de exibição | A API retorna todas as opções válidas; recomenda-se exibir até 4 |

### 4.1 Implementação

- **Rota:** `GET /v1/events/{id}/where-to-watch?country=BR[&region=SP][&locale=][&tz=]` (`apps/api/src/routes/v1/where-to-watch.ts`). Exige o módulo `where_to_watch` e o país em `tenant.markets` (`MARKET_NOT_IN_PLAN`); evento inexistente → 404. `country` é ISO2 (case-insensitive); país fora dos 8 mercados responde `unknown`.
- **O que sai:** só a versão vigente com `status: confirmed` de cada opção (`enrich.broadcast_option` com `superseded_by` nulo). `pending` (0,5–0,7, emissora desconhecida), `omitted` (conflito) e `retracted` (removida) ficam só internamente. Campos extras em relação ao exemplo acima: `provider_id` (id do dicionário `config/broadcasters/<iso2>.yaml`) e `watch_url`.
- **Logo e "a confirmar":** cada opção traz `logo` (URL do nosso storage quando já espelhado; senão a origem; `null` sem logo com origem conhecida) e `logo_dark` (versão para fundo escuro, do acervo oficial; `null` = usar `logo`). Quando o acervo oficial tem o logo do canal da opção (ex.: ESPN 2), `logo`/`logo_dark` são os do canal. `to_confirm` lista os detentores de direitos sem o jogo garantido (status interno `probable`), só quando `options` está vazio.
- **Região:** com `region`, devolve as nacionais (`region: null`) + as daquela UF/praça; sem `region`, todas (cada uma com seu `region`).
- **Ordenação:** `free_tv`, `youtube`, `streaming_free`, `pay_tv`, `streaming_svod`, `official_app`, `radio`; depois confiança e nome.
- **Sem informação confiável:** `status: "unknown"`, `options: []`, `message` no locale (pt-BR: "Não temos as informações de transmissão ainda."; es-*: "Todavía no tenemos la información de transmisión.").
- **Cache:** TTL 60 s, tags `where_to_watch:<evento>` e `event:<evento>`. Toda mudança visível publica `where_to_watch.changed` no `ops.change_feed` (`entity_type = where_to_watch`, `entity_id = <evento>`, `payload.country`), o que purga Valkey + CDN em segundos (LISTEN/NOTIFY; ≤ 5 s pela varredura) e alimenta SSE/webhook (#34/#35). O teste de integração `apps/api/test/where-to-watch.integration.test.ts` mede a propagação de uma remoção editorial (meta ≤ 5 min; na prática < 1 s).

### 4.1.1 Biblioteca de emissoras — `/v1/broadcasters`

| Rota | O que devolve |
|---|---|
| `GET /v1/broadcasters[?country=BR]` | `{data: Broadcaster[]}` — emissoras de TV aberta, TV paga e streaming do onde assistir (filtro por país) |
| `GET /v1/broadcasters/{id}` | Uma emissora (404 se não existir) |

`Broadcaster`: `id` (o mesmo `provider_id` das opções), `name`, `aliases`, `kind` (`free_tv` · `pay_tv` = TV paga distribuída por cabo/satélite/IPTV · `streaming` · `radio`), `countries`, `channels`, `website`, `markets[]` (`country`, `name`, `medium`, `access_model`, `channels` por país), `logo` (`url`, `dark_url`, `source_url`, `source_page`, `license`) ou `null`, e `channel_logos[]` (`channel`, `url`, `dark_url`: logos dos canais da emissora). Exige o módulo `where_to_watch`; cache de catálogo (24 h). A biblioteca é sincronizada de `config/broadcasters/<iso2>.yaml` pelo job `wtw-rights`. O logo vem do **acervo oficial de logos** (`_official_logos.yaml`: versões clara e escura em SVG, e logos de canal, gravados no nosso storage pelo `assets:official-logos`; `source_url` = `acervo-oficial://<nó>`); sem logo no acervo, de `_logos.yaml` (arquivos da Wikimedia Commons ligados à emissora pelo Wikidata, espelhados pelo `assets:mirror`). Uso nominativo, só para identificar a emissora.

### 4.1.2 Grade de canais e ofertas — `availability` e `/v1/platforms`

A resposta do onde assistir traz o bloco aditivo **`availability`**: além de quem tem o direito, em que operadora ou streaming e em que plano o canal está (`apps/api/src/lineup/availability.ts`, consultas da grade em `@galaxie/db`).

- `free_tv[]` e `pay_tv_channels[]`: os canais das opções publicadas (`{id, name, logo, logo_dark}`, sem repetir praças).
- `platforms[]`: `{platform: {id, slug, name, kind, country, broadcaster_id, logo, logo_dark, logo_credit}, plans: [{id, name, access, via_channels[], included_services[]}]}` — `kind` = `pay_tv_operator` · `vmvpd` · `telco_bundle` · `streaming`; `access` do plano = `included` quando algum canal do jogo vem no plano, senão `addon`; `included_services` são os streamings inclusos (o adicional pago fica de fora). Logo da plataforma: o asset dela (`assets:platform-logos`, [07 §2.2.2](07-ia-tempo-real-e-enriquecimento.md#222-grade-de-canais-e-ofertas-das-plataformas)) — o da biblioteca com o mesmo site oficial, com a versão escura do acervo, ou o da Wikimedia Commons; senão, o da entrada dela na biblioteca (`broadcaster_id`); senão, `null` (a demo mostra as iniciais). `logo_credit` (`LogoCredit`: `source`, `title`, `page_url`, `author`, `license`, `license_url`, `attribution_required` e o `text` pronto, ex. "Logo: Wikimedia Commons · Public domain") vem quando o logo é da Commons; com `attribution_required`, o crédito vai junto do logo.
- `channel_status`: `confirmed` ou `to_confirm`. Com o canal do jogo **a confirmar** (nenhuma opção publicada, só detentores dos direitos em `to_confirm`), `free_tv`, `pay_tv_channels` e `platforms` são os dos detentores no país e as plataformas que carregam esses canais — não o canal do jogo; o cliente deve dizer isso (a demo e o widget mostram o aviso "Canal deste jogo a confirmar").
- `match_channel` (`MatchChannel`): o **canal deste jogo**, por momento do jogo — o que a página deve dizer antes, durante e depois:
  - `phase`: `pre` (antes; inclui adiado) · `live` (em andamento, intervalo, paralisado) · `post` (encerrado);
  - `state`: `confirmed` (há canal confirmado para este jogo) · `to_confirm` (antes ou ao vivo, sem canal confirmado) · `not_confirmed` (encerrado e o canal nunca foi confirmado);
  - `headline` e `hint`, já no idioma pedido: antes com canal "Passa em Globo e Premiere"; ao vivo "Ao vivo em Premiere"; encerrado "Transmitido por Premiere" ou "Não confirmamos o canal deste jogo"; sem canal, "Canal deste jogo a confirmar" — com o `hint` "O canal do jogo sai mais perto da partida." **só antes do jogo** (ao vivo e encerrado, `hint = null`);
  - `channels[]` (`ConfirmedChannel`): `{id, name, logo, logo_dark, channel, medium, confirmed_at, post_match, source}` — `confirmed_at` é a primeira confirmação, `post_match = true` quando a confirmação foi refeita depois do jogo (quem de fato transmitiu) e `source` (`ConfirmedChannelSource`: `publisher`, `url`, `excerpt`, `kind` = `official` · `press` · `editorial` · `rights`) é a melhor fonte (oficial vale mais que imprensa; `rights` = a tabela de direitos garante o jogo, ex. detentor exclusivo).
  Os canais vêm das opções publicadas e do **canal do jogo** gravado pelo job `wtw-channel` (`enrich.match_channel`, [07 §2.2.4](07-ia-tempo-real-e-enriquecimento.md#224-canal-do-jogo)): canal confirmado ali que ainda não era opção publicada entra em `options` (e em `free_tv`/`pay_tv_channels`) como `confirmed`, e o "a confirmar" sai. Reprise não é inventada: a demo, depois do jogo, só aponta os vídeos relacionados que já existem ([12](12-conteudo-relacionado.md)).
- `your_operator`: a operadora do próprio tenant (`api.tenant.operator_platform_id`), com os planos em que o jogo está (`plans: []` = não está na grade dela); `null` quando o tenant não é operadora.
- **Regra por tenant:** com operadora e `show_other_operators = false`, `platforms` traz só a própria operadora e os streamings; com `true`, ou sem operadora (outros tenants e a demo), todas, a do tenant primeiro.
- **Piso editorial:** `LINEUP_MIN_REVIEW_STATUS` (`draft` | `reviewed` | `approved`, padrão `approved`; painel Ajustes → Operação), no mesmo padrão do `SEMANTIC_MIN_REVIEW_STATUS`.
- **Cache:** a operadora do tenant (e o filtro dela) entra no `vary`; tags `platform` e `platform:<id>` somadas às do onde assistir.

| Rota | O que devolve |
|---|---|
| `GET /v1/platforms[?country=BR]` | `{data: Platform[]}` — plataformas acima do piso, com a mesma regra por tenant |
| `GET /v1/platforms/{id}/lineup` | `{platform, plans: [{id, name, channels[], services[]}]}` (canais e streamings com `access`); 404 se não existe, está abaixo do piso ou é concorrente escondida do tenant; 403 se o país não está nos mercados |

### 4.1.3 Lista de canais do cliente — `client_channels` e `/v1/channel-list`

O cliente manda **só a lista de canais** dele (um M3U ou os nomes, um por linha) e o onde assistir passa a dizer em quais desses canais o jogo passa. **Nunca pedimos o EPG**: o guia de programação é licenciado ao cliente pelo fornecedor dele. Do M3U só o nome do `#EXTINF` (e o `group-title`) é lido; URL de stream, `tvg-id`, logo e qualquer dado de EPG são descartados na leitura (o portal corta as URLs já no navegador).

O casamento é feito contra **todas as emissoras dos mercados do tenant** (cada emissora × país é um "direito"), uma vez, no envio — não a cada jogo. Código primeiro, IA só nas sobras, validador depois ([07 §2.2.3](07-ia-tempo-real-e-enriquecimento.md#223-lista-de-canais-do-cliente)). Cada emissora sai com um tipo de casamento:

| `match` | Quando |
|---|---|
| `exato` | O canal é a emissora no país. Praça e afiliada não são modeladas (a geolocalização é da operadora): "BR: \|SP\| GLOBO HD", "GLOBO RJ" e "RBS TV" casam todos como `exato` com a Globo, e **todos entram** |
| `feed_generico` | Sinal pan-regional (ou de outro país) da emissora, sem o feed do país na lista — ex.: "ESPN HD" sem prefixo para a ESPN do Chile e da Colômbia |
| `nome_divergente` | Mesma marca com sufixo diferente — ex.: "CL: CHILEVISION SPORTS" para o sinal aberto Chilevisión (marca de praça não conta como sufixo); vem com `note` para o cliente conferir |
| `sem_canal_na_lista` | Nenhum canal da lista leva a emissora (direito só de streaming nunca casa `exato` com canal linear; canal "VOD" nunca casa) |

**No onde assistir:** com a lista do tenant **confirmada**, cada item de `options[]` e de `to_confirm[]` ganha `client_channels: [{index, name, match}]` — os canais da lista (posição e nome como o cliente mandou) que levam aquela emissora no país do pedido. `[]` = a emissora tem o jogo, mas não está na lista; sem lista confirmada, o campo não vem. Quando a opção tem canal com número de feed ("ESPN 2"), os canais da lista com o mesmo feed vêm primeiro. A lista confirmada entra no `vary` do cache (por tenant e confirmação).

| Rota (chave secreta; módulo `where_to_watch`) | O que faz |
|---|---|
| `GET /v1/channel-list` | A lista (`channels[]`), o casamento proposto (`matches[]`: `{country, provider_id, provider, access, match, channels[{index, name}], origin, note}`) e o confirmado (`confirmed_matches`), com `status` (`review` · `confirmed`) e `ai_status` (`not_needed` · `pending` · `done` · `failed`); 404 sem lista |
| `PUT /v1/channel-list` | `{content, format?: m3u\|text, default_country?}` — envia ou substitui (até 2 MB e 5.000 canais; nomes repetidos são descartados). O casamento por código sai na resposta; as sobras vão para a IA (`ai_status: pending`). Correções feitas no portal seguem valendo para os canais de mesmo nome. `default_country` vale para os canais sem país no nome nem no grupo |
| `POST /v1/channel-list/reprocess` | Refaz o casamento com o dicionário de emissoras e os mercados atuais (mesma lista, mesmas correções). Sem mudança, a confirmação continua |
| `POST /v1/channel-list/confirm` | O casamento proposto passa a ser o servido em `client_channels` |

Respostas com `Cache-Control: no-store`; a chave publicável não acessa (403 `PUBLISHABLE_KEY_NOT_ALLOWED`). A versão confirmada continua servida até a próxima confirmação, mesmo com a lista em revisão. Tabela `api.tenant_channel_list` (uma linha por tenant, migration `0033_lista_canais_cliente`); funções em `@galaxie/db/channel-lists`.

### 4.2 Rotas internas (correção editorial, auditoria e métricas)

Mesmo guard de `/internal/admin`: `x-galaxie-admin-key` validada contra `ADMIN_KEY_HASHES` e allowlist `ADMIN_IP_ALLOWLIST` (sem hashes configurados, as rotas respondem 503) e `x-galaxie-actor` com o handle interno de quem age (`[a-z0-9._-]`, sem e-mail) — gravado na trilha `enrich.broadcast_correction`. Respostas com `Cache-Control: no-store`.

| Método e rota | Efeito |
|---|---|
| `GET /internal/where-to-watch/events/{id}?country=BR[&history=true]` | Versões vigentes (todos os status), últimas execuções do agente e, com `history`, todas as versões e a trilha de correções |
| `POST /internal/where-to-watch/events/{id}/options` | Inclui opção `confirmed` (confiança 1,00, `produced_by = editorial:<handle>`): `{country, region?, provider, provider_id?, channel?, medium, access_model, watch_url?, evidence?[{url, excerpt}], reason, reported_at?}` |
| `PATCH /internal/where-to-watch/options/{optionId}` | Corrige a versão vigente (nova versão editorial; versão desatualizada → 409 `CONFLICT`) |
| `DELETE /internal/where-to-watch/options/{optionId}` | Remove (`{reason, reported_at?}`): nova versão `retracted` editorial |
| `POST /internal/where-to-watch/events/{id}/rerun` | Enfileira reexecução do agente (`{country, mode?: full\|revalidate, reason}`) → 202 |
| `GET /internal/where-to-watch/audits` · `POST /internal/where-to-watch/audits/{auditId}` | Fila de auditoria amostral e veredito (`{verdict: correct\|incorrect\|unsure, note?}`) |
| `GET /internal/where-to-watch/metrics[?format=prometheus][&days=30][&countries=BR,AR]` | Métricas e metas de docs/07 §4 (JSON ou formato de texto do Prometheus) |

Versões editoriais **travam** a chave (região × emissora × meio): o agente não as sobrescreve nem as retrai. A blocklist editorial também vale para inclusões e correções (400). `reported_at` (quando o erro foi reportado) alimenta a métrica de tempo de correção.

## 5. Tempo real

| Mecanismo | Rota | Uso |
|---|---|---|
| **SSE** | `GET /v1/stream?events=<ids>&topics=score,status,incidents,where_to_watch` | Cards ao vivo na TV/web sem recarregar |
| **Webhooks** | Configurados por tenant | `event.status_changed`, `event.score_changed`, `event.incident_added`, `where_to_watch.changed`, `event.context_published`, `event.related_content_changed` — assinados com HMAC-SHA256 |
| **Polling** | `GET /v1/events/live` com `ETag` | Clientes simples |

**Tópicos** (nome curto em `?topics=` → nome completo no SSE/webhook) e o módulo do plano exigido:

| Curto | Tópico | Quando | Módulo |
|---|---|---|---|
| `status` | `event.status_changed` | Mudou `status`, `status_detail` ou o relógio (`clock`) do evento | `core_data` |
| `score` | `event.score_changed` | Mudou o placar | `core_data` |
| `incidents` | `event.incident_added` | Lance novo na timeline (gol, cartão, VAR...) | `core_data` |
| `where_to_watch` | `where_to_watch.changed` | Opção de transmissão incluída, corrigida ou removida | `where_to_watch` |
| `context` | `event.context_published` | Cenário/resumo de IA publicado ou revisado | `live_intelligence` |
| `related` | `event.related_content_changed` | Vídeo relacionado publicado, reclassificado, fora do ar ou expirado | `related_content` |

**Payload** (`data:` do SSE e corpo do webhook — schema `RealtimeChange` no OpenAPI), compacto: o evento, o tópico, os campos que mudaram e os novos valores. Para o estado completo, use a rota REST do evento.

```json
{
  "id": "1042",
  "topic": "event.score_changed",
  "event_id": "0192c7e2-6c1f-7a33-9a51-5b3e0f7c2d10",
  "sport": "football",
  "competition_id": "0192c7e1-…",
  "changed": ["score"],
  "data": { "score": { "home": 1, "away": 0 } },
  "occurred_at": "2026-10-21T22:47:12.345Z"
}
```

`data` por tópico: `status`/`status_detail`/`clock` (+ `previous.status`); `score`; `incidents: [{ id, sequence, minute, extra, type, detail, participant_id, person_id }]`; `countries: ["BR"]` (países afetados — recortados aos mercados do tenant); `contexts: [{ locale, kind, review_status }]`; `added`/`removed`/`changed` (ids dos vídeos) no conteúdo relacionado.

**Ao vivo (Live Poller, #55) — sem tópico próprio.** O poller (`services/ingestor/src/live`) aplica cada tick pela normalização, que grava `core.event` e `core.event_incident`; os triggers de captura publicam então `event.score_changed`, `event.status_changed` e `event.incident_added` — o mesmo caminho de qualquer outro writer, uma vez só por mudança. O sinal `topic = live` que o poller também publica no change feed (gol, encerramento, fonte *stale*/recuperada) é **interno**: purga as tags `live`, `competition:<id>` e `season:<id>` e serve à operação, mas não sai no SSE nem nos webhooks (não é um tópico público), o que evita entregas duplicadas. A fonte fora do ar não gera mudança pública: o último placar válido fica e `data_freshness.is_stale` aparece na REST. Medido (teste `apps/api/test/live-sse.integration.test.ts`: `fixtures?live=` falso → `LivePoller.tick` → cliente SSE): gol no stream em ~80 ms (meta ≤ 5 s).

### 5.1 SSE — `GET /v1/stream`

```http
GET /v1/stream?events=<id>,<id>&topics=score,status,incidents
x-galaxie-key: gs_live_xxx
Last-Event-ID: 1041
```

| Parâmetro | Regra |
|---|---|
| `events` | Até 200 IDs de evento (vírgula). Vazio = todos os eventos do contrato |
| `competitions`, `sports` | Filtros adicionais (até 50 competições, 20 esportes); esporte fora do contrato → 403 |
| `topics` | Nomes curtos ou completos; padrão: todos os do plano. Tópico de módulo não contratado → 403 `MODULE_NOT_IN_PLAN` |
| `Last-Event-ID` / `?last_event_id=` | Retoma: reenvia do `ops.change_feed`, em ordem, as mudanças após esse ID (até 5000; acima disso chega `event: replay_truncated` com `reason: "max_replay"` e o cliente deve recarregar o estado pela REST). O change feed guarda `CHANGE_FEED_RETENTION_DAYS` dias (padrão 7; job `change-feed-prune` do ingestor, que mantém a última mudança de cada entidade e o que os webhooks ainda não leram). ID anterior ao que a retenção já apagou (`ops.change_feed_prune`): o que restou é reenviado e chega `replay_truncated` com `reason: "retention"` |
| `?key=` | Chave para `EventSource` do navegador, que não envia headers (ver *trade-off* abaixo) |

Mensagens: `id:` (ID da mudança), `event:` (tópico), `data:` (JSON). O stream começa com `retry: 3000` e, depois da retomada, `event: ready` com `{ "last_event_id": "...", "topics": [...] }`. Heartbeat a cada 15 s (comentário `: hb <ts>`), que mantém proxies e balanceadores com a conexão aberta. A cada heartbeat a chave é revalidada (cache de 60 s do autenticador): chave revogada ou expirada, tenant suspenso ou módulo/esporte retirado do plano encerram o stream com `event: access_revoked` (`{ code, message, detail }`) — a reconexão do `EventSource` recebe então o 401/403. A resposta leva os mesmos headers de segurança e de CORS (`CORS_ORIGINS`) das demais rotas, então `EventSource` de outra origem autorizada funciona.

```js
const es = new EventSource(`${API}/v1/stream?events=${id}&topics=score,status&key=${KEY_DE_LEITURA}`);
es.addEventListener('event.score_changed', (e) => atualizarPlacar(JSON.parse(e.data)));
// reconexão automática: o navegador reenvia Last-Event-ID e a API completa o que faltou
```

**Chave na URL (`?key=`) — *trade-off*.** O `EventSource` nativo não envia headers, então a chave vai na query. Ela pode ficar em histórico do navegador, logs de proxies/CDN e no `Referer`. A API remove `key=` dos próprios logs, mas recomendamos: (1) no servidor ou em apps, usar o header `x-galaxie-key` (ex.: `fetch` com leitura do stream, ou um polyfill de EventSource com headers); (2) no navegador, usar uma **chave dedicada**, restrita por escopo (`--scopes core_data`) e rotacionável, nunca a chave principal do tenant. `?key=` só vale para `/v1/stream`.

**Limites e robustez.**

- **Conexões por tenant:** no máximo `SSE_MAX_CONNECTIONS_PER_TENANT` (padrão 100) simultâneas, somando todas as instâncias (lease por conexão no Valkey, renovado no heartbeat; expira sozinho se a instância cair). Acima → 429 `RATE_LIMITED` com `retry-after: 30`. A abertura também conta no rate limit da rota.
- **Backpressure:** se o cliente não consome (socket cheio), as mensagens ficam numa fila de até 1 MiB; estourou, a conexão é derrubada e o cliente retoma pelo `Last-Event-ID` — um cliente lento nunca segura memória da API.
- **Entrega:** pelo menos uma vez, em ordem de ID na prática; a mesma mudança não é repetida numa conexão (deduplicação por ID). Clientes devem tratar mudanças como idempotentes pelo `id`.

**Arquitetura (fan-out horizontal).**

```mermaid
flowchart LR
  W[Writers<br/>ingestor · agentes · editorial] --> T[(core.event · event_incident<br/>enrich.broadcast_option · event_context)]
  T -- triggers --> CF[(ops.change_feed)]
  CF -- NOTIFY ops_change_feed --> R[Relay<br/>1 instância líder]
  R -- PUBLISH stream:changes --> V[(Valkey)]
  V --> A1[API 1 · SSE] & A2[API 2 · SSE] & A3[API n · SSE]
  CF --> WK[Worker de webhooks] --> CL[Endpoints dos clientes]
  CF --> P[Purge de cache · CDN]
```

1. **Captura** (migration `0006_realtime`): triggers em `core.event` (status/detalhe/relógio → `event.status_changed`; placar → `event.score_changed`), `core.event_incident` (INSERT → `event.incident_added`; lances de eventos que começaram há mais de 2 dias — carga histórica — não notificam), `enrich.broadcast_option` (INSERT/UPDATE/DELETE → `where_to_watch.changed`; só reverificar `last_verified_at` não notifica) e `enrich.event_context` (publicado/revisado → `event.context_published`). Todos chamam `ops.publish_change()`, a mesma função usada por `publishChange()` no app: a mesma (tópico, entidade) publicada várias vezes **na mesma transação** vira uma linha só, com os payloads fundidos (listas acumulam). O NOTIFY sai no commit.
2. **Relay**: uma instância por vez (lease `<prefixo>stream:relay` no Valkey, 10 s) lê o change feed — acordada pelo NOTIFY e por varredura a cada 1 s — e publica cada mudança pública no canal `<prefixo>stream:changes`. O cursor tolera IDs que ficam visíveis fora de ordem (transações lentas) e pula lacunas definitivas após 10 s.
3. **Hub**: toda instância assina o canal e entrega às suas conexões, aplicando filtros e o contrato do tenant (módulos, esportes, mercados). Sem Valkey, cada instância é seu próprio relay (desenvolvimento).

**Latência medida** (testes de integração, Postgres + Valkey locais): mudança no banco → mensagem SSE em ~10–20 ms com NOTIFY; ~1 s só com a varredura (sem NOTIFY). Meta: ≤ 5 s. Troca de líder do relay (instância caiu): até 10 s.

### 5.2 Webhooks

Cadastro (por enquanto via CLI de administração; a API de autoatendimento é um follow-up):

```bash
pnpm --filter @galaxie/api webhook create --tenant demo-local --url https://cliente.example/hooks/galaxie \
  --topics score,status,where_to_watch [--events <ids>] [--competitions <ids>] [--sports football]
# exibe o segredo whsec_... uma única vez
pnpm --filter @galaxie/api webhook list [--tenant demo-local]
pnpm --filter @galaxie/api webhook disable|enable --id <endpoint>
pnpm --filter @galaxie/api webhook dlq [--id <endpoint>]
pnpm --filter @galaxie/api webhook replay --id <endpoint> | --deliveries <ids>
pnpm --filter @galaxie/api webhook seal-secrets   # cifra segredos legados / recifra após rotacionar a KEK
```

URL: `https://` (http só para `localhost`, ou com `--allow-http`), sem credenciais, sem IP privado/link-local/reservado. Na entrega, destino cujo DNS resolve para rede privada, loopback ou link-local (metadata) falha a tentativa (`BlockedTargetError`; `WEBHOOK_ALLOW_PRIVATE_TARGETS=true` só em desenvolvimento). Sem `--topics`, o endpoint recebe todos os tópicos do plano; filtros e contrato do tenant valem como no SSE. Endpoint desativado ou tenant suspenso: as entregas pendentes vão para a DLQ sem envio (`endpoint desativado` / `tenant suspenso`).

**Requisição** — `POST` com o corpo `RealtimeChange` (acima) e os headers:

| Header | Valor |
|---|---|
| `x-galaxie-signature` | `t=<unix segundos>,v1=<hex de HMAC-SHA256(segredo, "<t>.<corpo bruto>")>` |
| `x-galaxie-event` | Tópico |
| `x-galaxie-delivery` | ID da entrega |
| `x-galaxie-attempt` | Tentativa (1, 2, ...) |
| `idempotency-key` | `<endpoint>:<id da mudança>` — igual em todas as tentativas; descarte duplicatas por ela |
| `user-agent` | `galaxie-sports-webhooks/0.1` |

**Retentativas e DLQ.** Qualquer resposta fora de 2xx (inclusive redirecionamentos, que não são seguidos) ou timeout de 10 s é falha. Retentativa exponencial: 10 s, 20 s, 40 s... (±20% de jitter, teto de 1 h), até 10 tentativas (~2,5 h); depois a entrega vai para a **DLQ** (`status = dead` em `api.webhook_delivery`), listável e reenfileirável pela CLI. O corpo fica congelado no enfileiramento: retentativas reenviam exatamente o mesmo JSON (a assinatura é refeita com o `t` do envio). Configuração do worker: `WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_RETRY_BASE_MS`, `WEBHOOK_TIMEOUT_MS`.

**Worker** — processo separado da API (`pnpm --filter @galaxie/api webhooks:worker`), para que endpoints lentos nunca disputem recursos com as requisições. Pode rodar em mais de uma instância: o enfileiramento (cursor em `api.webhook_cursor`) e a reivindicação de entregas usam `FOR UPDATE SKIP LOCKED`, e cada entrega é única por (endpoint, mudança). Latência medida (local): mudança → POST no endpoint em ~20–60 ms.

**Verificação da assinatura (Node):**

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verifica `x-galaxie-signature` sobre o corpo BRUTO (antes de JSON.parse). */
export function verifyGalaxieSignature(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=', 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false; // proteção contra replay
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const received = Buffer.from(parts.v1, 'hex');
  return received.length === expected.length && timingSafeEqual(expected, received);
}

// Express: app.post('/hooks/galaxie', express.raw({ type: 'application/json' }), (req, res) => {
//   if (!verifyGalaxieSignature(req.body.toString('utf8'), req.get('x-galaxie-signature'), SECRET))
//     return res.sendStatus(401);
//   const change = JSON.parse(req.body);   // deduplique por req.get('idempotency-key')
//   res.sendStatus(204);                   // responda rápido; processe de forma assíncrona
// });
```

O segredo fica em `api.webhook_endpoint.secret` **cifrado** (AES-256-GCM) com a KEK `WEBHOOK_SIGNING_SECRET`, que fica fora do banco; só o worker o decifra, para assinar. `webhook create` exige a KEK no ambiente; endpoints antigos com o segredo em texto puro continuam sendo entregues e são cifrados por `pnpm --filter @galaxie/api webhook seal-secrets` (detalhes, comportamento sem KEK, rotação da KEK e `WEBHOOK_REJECT_PLAINTEXT_SECRETS`: SECURITY.md › Webhooks). Recomendado recriar os endpoints legados: o segredo antigo esteve em texto puro e segue nos backups até o fim da retenção. Rotação do segredo do endpoint: cadastre um novo endpoint, migre o receptor e desative o antigo.

## 6. Erros

Formato RFC 9457 (`application/problem+json`):

```json
{ "type": "https://docs.galaxie.sports/errors/quota", "title": "Plano não inclui o módulo where_to_watch", "status": 403, "code": "MODULE_NOT_IN_PLAN" }
```

| Código | Situação |
|---|---|
| 400 `INVALID_PARAMS` | Parâmetro inválido |
| 401 `INVALID_KEY` | Chave ausente/inválida |
| 403 `MODULE_NOT_IN_PLAN` / `MARKET_NOT_IN_PLAN` | Recurso fora do contrato |
| 403 `ORIGIN_NOT_ALLOWED` | Chave publicável usada de uma origem fora da lista dela (ou sem `Origin`/`Referer`), §1.3 |
| 403 `PUBLISHABLE_KEY_NOT_ALLOWED` | Chave publicável em rota que ela não alcança (escrita, `/v1/account`, SSE, espelho), §1.3 |
| 404 `NOT_FOUND` | Entidade inexistente |
| 409 `CONFLICT` | Conflito com o estado atual (ex.: slug de tenant já existente; rotas internas de correção quando a versão corrigida não é mais a vigente) |
| 413 `INVALID_PARAMS` | Corpo acima do limite (`API_BODY_LIMIT`, padrão 64 KiB) |
| 429 `RATE_LIMITED` | Limite do tenant, ou muitas tentativas de autenticação com chaves não verificadas por IP/prefixo (`AUTH_ATTEMPTS_PER_MINUTE`, padrão 60; SECURITY.md) |
| 503 `DEGRADED` | Raro: só quando nem last-known-good existe |
| 500 `INTERNAL_ERROR` | Erro inesperado (registrado em log) |

`type` segue `https://docs.galaxie.sports/errors/<código-em-kebab-case>` (ex.: `.../errors/module-not-in-plan`); `instance` é o caminho da requisição; `INVALID_PARAMS` traz `errors: [{ path, message }]`. Rotas inexistentes também respondem 404 `NOT_FOUND` em `application/problem+json`. Erros nunca são cacheados (`Cache-Control: no-store`).

## 7. TTLs de cache recomendados

| Recurso | TTL (CDN) | Invalidação ativa |
|---|---|---|
| Países, competições, times, venues, navegação (`/v1/navigation`, `/v1/countries/{code}/*`) | 24 h | Na sincronização diária |
| Resumo da home (`/v1/explore/summary`) | 60 s | Não (contadores de jogos envelhecem até 1 min) |
| Elencos, tabelas | 1 h | Ao fim de cada rodada |
| Agenda do dia | 5 min | Mudança de horário/status |
| Evento ao vivo | 5–15 s | Mudança de placar/estado (push) |
| Onde assistir | 60 s | Correção aceita (purge) |
| Cenário/resumo de IA (`/v1/events/{id}/context`) | 1 h | Nova geração ou revisão (`event.context_published`) |
| Semântica (clássicos, perfis, glossário, copy) | 24 h (retrospecto do clássico: 1 h) | Merge de PR na base / novo seed |
| Quadro de medalhas | 24 h (edição encerrada) · 60 s (em andamento) · 1 h (futura) | Nova carga/QA de medalhas |
| Assets (imagens) | 30 dias, imutável por hash | Nova versão = nova URL (`?v=` com o início do sha256 de `core.asset`) |

### 7.1 Implementação

- **Cache de respostas no Valkey** (`<prefixo>cache:<hash>`): chave = método + caminho + query ordenada + locale resolvido (+ fuso quando a resposta tem instantes). Respostas independem do tenant. Sem Valkey (ou com falha), a resposta sai direto do banco.
- **Deploy limpa o cache de respostas** (`infra/vps-telemetry/deploy.sh`: `gs:cache:*` e `gs:tag:*`, depois do seed da base semântica). Toda mudança de forma ou de regra de uma resposta (ex.: o nome de exibição dos times, §3.3) só aparece por inteiro depois dessa limpeza; sem ela, respostas antigas seguem servidas até o TTL (até 24 h).
- **Headers:** `ETag` (sha1 do corpo), `Cache-Control: public, max-age=min(TTL, 300), s-maxage=TTL, stale-while-revalidate=…` (o navegador revalida em ≤ 5 min; a CDN usa o TTL cheio e é purgada ativamente), `Vary: Accept-Language, x-galaxie-key`, `surrogate-key` com as tags da resposta e `x-galaxie-cache: HIT|MISS`. `If-None-Match` igual ao ETag → 304 sem corpo.
- **Tags de purge:** entidade `<tipo>:<id>` e coleção `<tipo>`. Ex.: detalhe da competição → `competition:<id>`; lista de competições → `competition`, `season`, `competition_profile`, `country`; tabela → `standing:<season_id>`, `competition:<id>`; venue → `venue:<id>`; espelho → `api_response:<request_hash>`.
- **Change feed:** mudanças em `core.event`, `core.event_incident`, `enrich.broadcast_option` e `enrich.event_context` chegam ao `ops.change_feed` sozinhas, por triggers (§5.1). Os demais writers que alteram dado servido pela API chamam `publishChange(db, { topic, entityType, entityId, payload? })` (`@galaxie/db`), que usa a mesma função `ops.publish_change()` (deduplicada por transação) e faz `pg_notify('ops_change_feed', id)`. Entidades dos triggers: `event:<id>` (estado, placar, lances), `where_to_watch:<event_id>` (+ `event:<event_id>`) e `event_context:<event_id>` (+ `event:<event_id>`). A API escuta o canal (LISTEN) e também varre a tabela a cada 5 s (cobre writers que não notificam); cada mudança purga as tags `<entityType>:<entityId>`, `<entityType>` e `payload.tags` no Valkey e na CDN. Propagação típica: < 1 s com NOTIFY, ≤ 5 s só com a varredura — dentro do SLA de 5 min do onde assistir.
- **CDN:** interface `CdnPurger.purgeTags(tags)`; hoje `NoopCdnPurger`. A implementação concreta (purge por `Surrogate-Key` ou `Cache-Tag`, conforme a CDN) entra quando a CDN for escolhida — a API já emite `surrogate-key`.

## 8. Versionamento

- `/v1` estável; mudanças incompatíveis vão para `/v2` com 6 meses de convivência.
- Campos novos podem ser adicionados a qualquer momento (clientes devem ignorar campos desconhecidos).
- O espelho `/mirror` segue a versão do fornecedor (`v3` futebol, `v1`/`v2` demais) — mudança de versão do fornecedor gera um novo prefixo (`/mirror/football-v4`).
