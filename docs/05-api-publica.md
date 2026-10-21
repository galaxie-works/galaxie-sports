# 05 · API pública Galaxie Sports

A API tem **duas faces**:

1. **Espelho compatível** (`/mirror/{sport}/{endpoint}`) — mesma URL relativa, mesmos parâmetros e **o mesmo envelope** da api-sports. Quem já integrou a api-sports só troca a URL base e a chave.
2. **API canônica** (`/v1/...`) — orientada a evento, multiesporte, localizada e enriquecida (onde assistir, semântica, contexto, momentum).

Especificação formal: OpenAPI 3.1 gerada a partir dos schemas Zod de `packages/contracts` (biblioteca `zod-openapi`), servida em **`/openapi.json`**, com referência interativa (Scalar) em **`/docs`** — ambas públicas. O mesmo pacote exporta o cliente tipado `createGalaxieClient({ baseUrl, apiKey, locale })` usado pelo demo. O CI valida o documento contra o schema oficial do OpenAPI 3.1.

## 1. Autenticação, tenants e limites

| Item | Regra |
|---|---|
| Autenticação | Header `x-galaxie-key: <chave do tenant>` (chaves rotacionáveis, escopos por módulo) |
| Tenant | Cada cliente tem plano (Core Data, Fan Experience, Live Intelligence, Enterprise), mercados ativos e esportes contratados |
| Rate limit | Por tenant e por rota; headers `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` |
| Locale | `Accept-Language` ou `?locale=` (pt-BR, es-AR, es-MX, es-CO, es-CL, es-PE, es-UY, es-EC) |
| Fuso | `?tz=America/Sao_Paulo` (padrão UTC) |
| Cache | `ETag` + `Cache-Control` por tipo de recurso; `If-None-Match` retorna 304 |

### 1.1 Implementação (schema `api`)

**Chaves.** Formato `gs_<live|test>_<prefixo>_<segredo>` — prefixo de 12 caracteres hex (guardado em claro em `api.api_key.prefix` para localizar a chave) e segredo de 32 bytes em base64url, guardado **só como hash scrypt com sal** (`scrypt$N$r$p$sal$hash`, via `node:crypto`). A chave completa é exibida uma única vez, na criação. A verificação positiva fica em cache em memória por 60 s (revogação e mudança de plano valem em até 1 min). `last_used_at` é atualizado no máximo a cada 5 min.

**Tenants e planos.** `api.tenant` guarda `plan`, `modules`, `markets` (países ISO2; vazio = todos), `sports` (vazio = todos), `rate_limit_per_minute` e `status` (`active`/`suspended`). Módulos: `core_data`, `where_to_watch`, `semantic`, `live_intelligence`, `multisport`. Cada chave pode restringir os módulos do tenant (`api.api_key.scopes`; `null` = herda).

| Plano | Módulos padrão |
|---|---|
| `core_data` | `core_data` |
| `fan_experience` | `core_data`, `where_to_watch`, `semantic` |
| `live_intelligence` | + `live_intelligence`, `multisport` |
| `enterprise` | todos |

Cada rota declara o módulo exigido (`/mirror` e o catálogo `/v1` exigem `core_data`). Chave sem o módulo → 403 `MODULE_NOT_IN_PLAN`; esporte fora de `sports` no espelho → 403 `MODULE_NOT_IN_PLAN`; país fora de `markets` (rotas por país, como onde assistir) → 403 `MARKET_NOT_IN_PLAN`.

**Rate limit.** Janela fixa de 60 s por **tenant × rota** (padrão da rota, ex.: `GET /v1/competitions/:id`), com contadores no Valkey (`<prefixo>rl:<tenant>:<rota>`), compartilhados entre instâncias. Headers `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` (segundos) em toda resposta autenticada; 429 inclui `retry-after`. Se o Valkey cair, o limite é ignorado (*fail-open*) e o evento é registrado em log.

**Locale.** `?locale` (um dos 8 locales; outro valor → 400) tem precedência; senão `Accept-Language` (tag exata, ou só o idioma: `es-*` → `es-AR`, `pt-*` → `pt-BR`); padrão `pt-BR`. A resposta traz `Content-Language`. Textos i18n do banco seguem a cadeia `es-XX → es → en` (`pt-BR → pt → en`); sem correspondência, cai no nome oficial. **Fuso:** `?tz` aceita qualquer fuso IANA (inválido → 400); instantes saem em ISO 8601 com o offset do fuso (padrão UTC, sufixo `Z`).

**Chave local para desenvolvimento:**

```bash
pnpm --filter @galaxie/api tenant:create --slug demo-local --plan enterprise --label dev
# opções: --markets BR,AR --sports football --rate-limit 600 --scopes core_data --env live
```

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
| `GET /v1/competitions?sport=&country=&tier=` | Competições com apelidos (semântica) |
| `GET /v1/competitions/{id}` | Detalhe + temporadas |
| `GET /v1/competitions/{id}/seasons/{season}/standings` | Tabela/grupos |
| `GET /v1/competitions/{id}/context` | O que está em jogo: líder, G4/G6, Z4, mata-mata, chaveamento, próximos confrontos decisivos |
| `GET /v1/venues/{id}` | Estádio/circuito/arena |

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

### 3.2 Eventos

| Método e rota | Descrição |
|---|---|
| `GET /v1/events?date=&from=&to=&sport=&competition=&team=&country=&status=&importance_min=` | Agenda multiesporte paginada por cursor, ordenada por `starts_at` ou `importance` |
| `GET /v1/events/live?sport=&competition=` | Eventos ao vivo |
| `GET /v1/events/{id}` | Evento completo: participantes, placar, estado, momentum, clássico, contexto |
| `GET /v1/events/{id}/timeline` | Momentos-chave por minuto (gols, cartões, VAR, substituições) |
| `GET /v1/events/{id}/lineups` | Escalações e formação |
| `GET /v1/events/{id}/stats` | Estatísticas por time e jogador |
| `GET /v1/events/{id}/where-to-watch?country=BR&region=SP` | Opções de transmissão (§4) |
| `GET /v1/events/{id}/context?locale=pt-BR` | Cenário pré-jogo / resumo pós-jogo gerado por IA, com fontes |
| `GET /v1/events/{id}.ics` | Arquivo de calendário |
| `GET /v1/events/{id}/h2h` | Histórico do confronto (do espelho, sem nova chamada) |

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
    { "side": "home", "id": "…", "name": "Palmeiras", "logo": "https://assets.galaxie.sports/api-sports/football/teams/121.png?v=9879fc79" },
    { "side": "away", "id": "…", "name": "Fluminense", "logo": "https://assets.galaxie.sports/api-sports/football/teams/124.png?v=1f0c2a7e" }
  ],
  "score": { "home": null, "away": null, "aggregate": { "home": 2, "away": 1 } },
  "venue": { "name": "…", "city": "São Paulo" },
  "derby": null,
  "competition_context": ["semifinal", "knockout"],
  "stakes": [
    { "team": "home", "code": "advances_with_draw", "text": { "pt-BR": "Avança com empate" } },
    { "team": "away", "code": "needs_win_by_2", "text": { "pt-BR": "Precisa vencer por 2 gols para avançar direto" } }
  ],
  "data_freshness": { "last_valid_at": "2026-10-21T13:00:05Z", "is_stale": false }
}
```

> Os IDs de times acima são ilustrativos; os IDs reais vêm do `provider_map` após o bootstrap. Os códigos de `stakes` e seus textos nos 8 mercados estão catalogados em [docs/rules](rules/README.md#catálogo-de-códigos).

Convenções implementadas (`apps/api/src/routes/v1/events.ts`, montagem em `apps/api/src/events/builder.ts`):

- **Agenda** `GET /v1/events`: `{ data, next_cursor }`, `limit` 1–200 (padrão 50). `date` é o dia civil no fuso `tz` e tem precedência; `from`/`to` aceitam dia civil (início/fim inclusivo do dia no fuso) ou instante ISO 8601; **sem nenhum dos três, a agenda começa hoje** (no fuso). `competition` aceita UUID ou slug; `team` é o UUID do participante; `country` casa o país da competição **ou** de um participante; `status` é lista separada por vírgulas; `importance_min` 0–100. `order=starts_at` (padrão, crescente; cursor `starts_at,id`) ou `order=importance` (decrescente, depois horário; cursor `importance,starts_at,id`). Tenant com `sports` restritos só vê esses esportes; pedir outro → 403.
- **Ao vivo** `GET /v1/events/live`: `{ data }` (até 500) com `status` `live`, `break` ou `suspended`, por importância; TTL 10 s.
- **Evento**: `competition` com `nickname` (primeiro apelido de `semantic.competition_profile` no locale) e `logo`; `stage.name` localizado (`core.stage.name`) com a perna — `Semifinal · Volta` / `Semifinales · Vuelta`. A perna vem do confronto: duas partidas do mesmo par na mesma fase (a mais antiga é a ida); com regulamento de jogo único, não há perna. `score` traz `halftime`, `extratime`, `penalty` e `aggregate` (só no jogo de volta, com a ida encerrada: ida + placar atual da volta, nos lados da volta). `participants[]` com `logo`, `nickname` (primeiro apelido da base semântica) e `winner`; `clock` e `status_detail` do fornecedor; `importance` gravada pelo ingestor; `momentum` calculado no fuso pedido (docs/04 §3.2).
- **`derby`**: `{ slug, name (localizado), intensity }` de `core.event.derby_id`.
- **`competition_context`**: `regular` (pontos corridos/grupos/fase de liga), `knockout`, `semifinal`, `final`, `playoff` (pela fase), `derby`, `lead` (um dos dois é o 1º da tabela), `title`/`relegation` (quando algum stake trata disso).
- **`stakes`**: só para eventos não encerrados de competições **com regulamento próprio** em `config/rules` (sem arquivo, nada é afirmado). Mata-mata: `knockoutStakes` com as regras da fase (`knockout_round` "1st Round" → `first_round` no YAML); a volta exige a ida encerrada no `core`. Pontos corridos: `leagueMatchStakes` com a tabela de `core.standing` (o grupo que contém os dois times) e os demais jogos da mesma rodada. `text` traz só o locale da resposta. Dados incompatíveis com o regulamento (ex.: mais jogos que o previsto) → `[]`.
- **`/timeline`**: `core.event_incident` na ordem do fornecedor (`sequence`), com `team` (lado e logo), `player`/`assist` (`id` do `core.person`, ou `null` com o nome do fornecedor) e `comments`.
- **`/lineups`** e **`/stats`**: do detalhe da partida (`core.football_fixture.detail`); IDs do fornecedor resolvidos para os nossos via `provider_map` (times e pessoas, com foto). Sem detalhe sincronizado: `available: false` e listas vazias. Outros esportes: `available: false` por ora.
- **`/h2h?limit=`** (1–50, padrão 10): confrontos **encerrados** entre os dois participantes no `core` (qualquer competição, exceto o próprio evento), do mais recente ao mais antigo; `summary` (`played`, `draws`, `wins`/`goals` por time) considera todo o histórico. Nunca chama o fornecedor.
- **`/{id}.ics`**: `text/calendar` (RFC 5545) com um `VEVENT`: `UID <id>@galaxie.sports`, `DTSTART`/`DTEND` em UTC (`starts_at` e `ends_at_expected`), `SUMMARY` "Mandante × Visitante · Competição", `LOCATION`, `STATUS` (`CANCELLED` para cancelado/abandonado, `TENTATIVE` para adiado), linhas CRLF dobradas em 75 octetos. O título segue o locale; os horários não dependem de `tz`.
- **Cache**: detalhe com TTL de 10 s se ao vivo ou começando em até 2 h, 5 min se agendado e 1 h se encerrado; agenda até 5 min. Tags `event:<id>` (e `event` nas listas): `publishChange(db, { entityType: 'event', entityId })` purga. O plano do tenant (esporte) é verificado também quando a resposta vem do cache.

### 3.3 Times, atletas e semântica

| Método e rota | Descrição |
|---|---|
| `GET /v1/teams?sport=&country=&competition=&q=` | Busca de times/seleções |
| `GET /v1/teams/{id}` | Detalhe do time (estádio, país, IDs externos) |
| `GET /v1/teams/{id}/overview` | Posição no torneio, forma recente (últimos 5), últimos resultados, próximo jogo + onde assistir |
| `GET /v1/teams/{id}/events?from=&to=` | Jogos do time |
| `GET /v1/teams/{id}/squad?season=` | Elenco e comissão técnica |
| `GET /v1/teams/{id}/semantic?locale=` | Apelidos, mascote, torcida, gritos, estádio, rivais, fatos |
| `GET /v1/derbies?country=&team=` | Clássicos |
| `GET /v1/derbies/{slug}` | Clássico + histórico de confrontos (h2h do espelho) |
| `GET /v1/people/{id}` | Jogador/técnico/piloto |
| `GET /v1/copy?locale=&sport=&intent=&affinity=&momentum=&context=` | Microcopy sugerida (badges, chamadas) respeitando `copy_permission` |

Convenções implementadas (`apps/api/src/routes/v1/teams.ts`):

- `GET /v1/teams`: `{ data, next_cursor }` ordenado por nome; `q` (≥ 2 caracteres) busca em nome, nome curto, código e apelidos/nomes da base semântica; `competition` (UUID ou slug) = times com jogos na competição. Cada item traz `nicknames` da base semântica (vazio sem perfil).
- `GET /v1/teams/{id}`: resumo + `country_ref` localizado, `founded`, `venue` (estádio da casa, com imagem) e `external_ids`.
- `GET /v1/teams/{id}/overview`: em uma chamada, `team`, `standings` (por competição, a temporada atual ou a mais recente com tabela do time), `form` (últimos 5 encerrados, do mais recente ao mais antigo; placar do ponto de vista do time; empate decidido nos pênaltis usa o `winner` do fornecedor), `last_events` (5), `live_event` e `next_event` (próximo `scheduled`/`starting` a partir de 3 h atrás), todos no formato de evento de §3.2 (com stakes). Onde assistir do próximo jogo entra com a issue de onde assistir.
- `GET /v1/teams/{id}/events`: mesmos filtros, ordenação e cursor da agenda (§3.2), sem janela padrão (sem `from`/`to`, todo o histórico em ordem crescente).
- `GET /v1/teams/{id}/squad?season=`: sem `season`, o elenco atual (`core.roster.season_id` nulo); com o ano, os elencos de temporadas daquele ano. `players`, `coaches`, `staff`, ordenados por posição (goleiro → atacante), número e nome; pessoa com `age` calculada.
- `GET /v1/people/{id}`: dados de `core.person`, foto, `age`, `teams` (elencos, atual primeiro) e `external_ids`.
- Cache: times e pessoas 24 h, elenco 1 h, overview/jogos até 5 min (10 s se houver jogo ao vivo ou começando); tags `participant:<id>`, `person:<id>`, `roster`, `event`.

### 3.4 Olimpíadas e Pan-Americano

| Método e rota | Descrição |
|---|---|
| `GET /v1/multisport/games` | Edições (Olimpíadas de Verão/Inverno, Pan-Americano) |
| `GET /v1/multisport/games/{slug}/medals?country=` | Quadro de medalhas |
| `GET /v1/multisport/games/{slug}/schedule?sport=&date=&country=` | Agenda por modalidade |
| `GET /v1/multisport/games/{slug}/athletes?country=BR` | Delegação |

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
      "sources": [ { "publisher": "Organizador da competição", "url": "https://…" } ]
    }
  ],
  "updated_at": "2026-10-21T12:00:00Z"
}
```

Regras de contrato:

| Regra | Comportamento |
|---|---|
| Sem informação confiável | `status: "unknown"`, `options: []` e `message` localizada ("Não temos as informações de transmissão ainda.") — o evento **continua** existindo |
| Conflito entre fontes ou confiança < limiar | Opção **omitida** (registrada internamente como `omitted`) |
| Mesma plataforma vinda de várias fontes | Deduplicada; fontes agregadas em `sources` |
| Correção aceita (inclusão/remoção) | Propagada ao cliente em **≤ 5 min** (purge de cache + SSE + webhook `where_to_watch.changed`) |
| Ordenação | A API ordena por `medium`/confiança; a **ordenação final por direito de acesso do usuário** (incluído, ativação, upgrade, extra, externo) é responsabilidade do cliente, que conhece o assinante |
| Limite de exibição | A API retorna todas as opções válidas; recomenda-se exibir até 4 |

## 5. Tempo real

| Mecanismo | Rota | Uso |
|---|---|---|
| **SSE** | `GET /v1/stream?events=<ids>&topics=score,status,incidents,where_to_watch` | Cards ao vivo na TV/web sem recarregar |
| **Webhooks** | Configurados por tenant | `event.status_changed`, `event.score_changed`, `event.incident_added`, `where_to_watch.changed`, `event.context_published` — assinados com HMAC-SHA256 |
| **Polling** | `GET /v1/events/live` com `ETag` | Clientes simples |

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
| 404 `NOT_FOUND` | Entidade inexistente |
| 429 `RATE_LIMITED` | Limite do tenant |
| 503 `DEGRADED` | Raro: só quando nem last-known-good existe |
| 500 `INTERNAL_ERROR` | Erro inesperado (registrado em log) |

`type` segue `https://docs.galaxie.sports/errors/<código-em-kebab-case>` (ex.: `.../errors/module-not-in-plan`); `instance` é o caminho da requisição; `INVALID_PARAMS` traz `errors: [{ path, message }]`. Rotas inexistentes também respondem 404 `NOT_FOUND` em `application/problem+json`. Erros nunca são cacheados (`Cache-Control: no-store`).

## 7. TTLs de cache recomendados

| Recurso | TTL (CDN) | Invalidação ativa |
|---|---|---|
| Países, competições, times, venues | 24 h | Na sincronização diária |
| Elencos, tabelas | 1 h | Ao fim de cada rodada |
| Agenda do dia | 5 min | Mudança de horário/status |
| Evento ao vivo | 5–15 s | Mudança de placar/estado (push) |
| Onde assistir | 60 s | Correção aceita (purge) |
| Semântica | 24 h | Merge de PR na base |
| Assets (imagens) | 30 dias, imutável por hash | Nova versão = nova URL (`?v=` com o início do sha256 de `core.asset`) |

### 7.1 Implementação

- **Cache de respostas no Valkey** (`<prefixo>cache:<hash>`): chave = método + caminho + query ordenada + locale resolvido (+ fuso quando a resposta tem instantes). Respostas independem do tenant. Sem Valkey (ou com falha), a resposta sai direto do banco.
- **Headers:** `ETag` (sha1 do corpo), `Cache-Control: public, max-age=min(TTL, 300), s-maxage=TTL, stale-while-revalidate=…` (o navegador revalida em ≤ 5 min; a CDN usa o TTL cheio e é purgada ativamente), `Vary: Accept-Language, x-galaxie-key`, `surrogate-key` com as tags da resposta e `x-galaxie-cache: HIT|MISS`. `If-None-Match` igual ao ETag → 304 sem corpo.
- **Tags de purge:** entidade `<tipo>:<id>` e coleção `<tipo>`. Ex.: detalhe da competição → `competition:<id>`; lista de competições → `competition`, `season`, `competition_profile`, `country`; tabela → `standing:<season_id>`, `competition:<id>`; venue → `venue:<id>`; espelho → `api_response:<request_hash>`.
- **Change feed:** todo writer que altera dado servido pela API chama `publishChange(db, { topic, entityType, entityId, payload? })` (`@galaxie/db`), que insere em `ops.change_feed` e faz `pg_notify('ops_change_feed', id)` na mesma transação. A API escuta o canal (LISTEN) e também varre a tabela a cada 5 s (cobre writers que não notificam); cada mudança purga as tags `<entityType>:<entityId>`, `<entityType>` e `payload.tags` no Valkey e na CDN. Propagação típica: < 1 s com NOTIFY, ≤ 5 s só com a varredura — dentro do SLA de 5 min do onde assistir.
- **CDN:** interface `CdnPurger.purgeTags(tags)`; hoje `NoopCdnPurger`. A implementação concreta (purge por `Surrogate-Key` ou `Cache-Tag`, conforme a CDN) entra quando a CDN for escolhida — a API já emite `surrogate-key`.

## 8. Versionamento

- `/v1` estável; mudanças incompatíveis vão para `/v2` com 6 meses de convivência.
- Campos novos podem ser adicionados a qualquer momento (clientes devem ignorar campos desconhecidos).
- O espelho `/mirror` segue a versão do fornecedor (`v3` futebol, `v1`/`v2` demais) — mudança de versão do fornecedor gera um novo prefixo (`/mirror/football-v4`).
