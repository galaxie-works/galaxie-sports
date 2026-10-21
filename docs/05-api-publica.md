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
2. **Hit** (`x-galaxie-source: raw-hit`): serve o `body` da resposta **mais recente com sucesso** (HTTP 2xx e `errors` vazio) em `raw.api_response`, com `x-galaxie-fetched-at`. Como o JSONB não preserva a ordem das chaves, o envelope volta na ordem da api-sports (`get, parameters, errors, results, paging, response`); objetos internos podem ter as chaves em outra ordem (mesmo JSON).
3. **Miss** (`x-galaxie-source: miss`): envelope vazio (`parameters: []` quando não há parâmetros, como o fornecedor) e upsert em **`api.backfill_request`** (`request_hash` único; repetições somam `hits`; `status` `pending → done/failed/skipped`, a cargo do ingestor). Respostas *miss* não entram no cache.
4. Cache: TTL igual ao frescor do endpoint no cliente da api-sports (`ttlFor`, entre 15 s e 24 h); tag de purge `api_response:<request_hash>`.
5. `x-galaxie-asset-base` traz `ASSETS_PUBLIC_BASE_URL` quando configurado. Ainda **não** implementados: `rebuilt` (remontar a partir do `core`), `stale` e a reescrita de URLs de mídia dentro do corpo — follow-ups da issue do espelho.
6. Erros de autenticação/plano do espelho também saem em `application/problem+json` (§6), e não no formato de erro da api-sports.

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
- `GET /v1/competitions/{id}/context` ainda **não** existe: depende dos eventos (#31).

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

### 3.3 Times, atletas e semântica

| Método e rota | Descrição |
|---|---|
| `GET /v1/teams?sport=&country=&competition=&q=` | Busca de times/seleções |
| `GET /v1/teams/{id}/overview` | Posição no torneio, forma recente (últimos 5), últimos resultados, próximo jogo + onde assistir |
| `GET /v1/teams/{id}/events?from=&to=` | Jogos do time |
| `GET /v1/teams/{id}/squad?season=` | Elenco e comissão técnica |
| `GET /v1/teams/{id}/semantic?locale=` | Cartão de identidade: apelidos, mascote, torcida, gritos, estádio, rivais, fatos, dicas de copy do mercado |
| `GET /v1/teams/{id}/rivals?locale=` | Rivais e clássicos do time (segmentação/CRM) |
| `GET /v1/derbies?country=&team=` | Clássicos |
| `GET /v1/derbies/upcoming?days=7&country=` | Clássicos dos próximos dias (eventos com `derby_id`) |
| `GET /v1/derbies/{slug}` | Clássico + retrospecto calculado dos eventos do `core` |
| `GET /v1/glossary?locale=&category=` | Glossário esportivo por mercado ("secar", "hinchar por", "le voy al", "hacer fuerza"…) |
| `GET /v1/people/{id}` | Jogador/técnico/piloto |
| `GET /v1/copy?locale=&sport=&intent=&tone=&affinity_type=&affinity_source=&momentum=&context=&team=&rival=&minutes=` | Microcopy sugerida (badges, chamadas) respeitando `copy_permission` |

#### 3.3.1 Implementação da semântica (`apps/api/src/routes/v1/semantic.ts` e `copy.ts`)

- **Módulo `semantic`** em todas as rotas desta tabela a partir de `/v1/teams/{id}/semantic` (planos `fan_experience`, `live_intelligence` e `enterprise`). As demais rotas de times ficam com `/v1/teams` (#32).
- **`{id}` de time** aceita o UUID do participante (`core.participant`, ligado por `semantic.team_profile.participant_id`) ou o slug do perfil (`palmeiras`). Clássico usa o slug (`choque-rei`).
- **Piso editorial (`review_status`).** Cada item da base tem `draft`, `reviewed` ou `approved`. A API serve só itens com status ≥ ao mínimo efetivo = o maior entre o piso do servidor e `?min_review_status=` — o cliente **endurece, nunca afrouxa**. Piso do servidor: variável `SEMANTIC_MIN_REVIEW_STATUS` (padrão **`approved`**, o de produção; em desenvolvimento local use `draft`, já que toda a base ainda está em revisão). Listas filtram; detalhe abaixo do piso → 404 com `detail` explicando o motivo. Um piso por tenant fica para quando houver configuração por tenant no schema `api`.
- **Locale.** Nomes de time/clássico seguem `labels` com a cadeia `es-XX → es → en`; `copy_hints` e glossário usam só o locale e o idioma (`es-AR → es`), nunca outro idioma. `/v1/copy` não tem fallback entre locales (copy é localizada pela intenção).
- **`/v1/derbies`**: lista completa (`{ data }`), por intensidade e slug; `country` casa o país de qualquer um dos dois times; `team` inexistente → 404.
- **`/v1/derbies/upcoming`**: eventos com `core.event.derby_id` entre agora e `days` dias (1–30, padrão 7), sem encerrados/cancelados/adiados; cache de agenda (5 min). Vazia enquanto não houver eventos futuros sincronizados.
- **`/v1/derbies/{slug}`**: retrospecto **calculado só de `core.event`** (status `finished`, placar presente, os dois participantes em qualquer mando) — nunca chama o provedor. Traz vitórias e gols por time, empates, até 3 maiores goleadas (saldo → gols → mais recente), últimos 5, primeiro/último confronto e `next_event`. Pênaltis aparecem em `penalties`, mas o jogo conta como empate. Sem os dois times ligados ao `core`, `retrospect.available = false`. TTL 1 h (muda a cada clássico encerrado).
- **`/v1/teams/{id}/rivals`**: rivais declarados no perfil + clássicos que incluem o time, com `derby`, `intensity` e `mutual` (os dois se declaram rivais); rival abaixo do piso é omitido e clássico abaixo dele vira `derby: null`.
- **`/v1/glossary`**: lido de `data/knowledge/glossary/<locale>.yaml` (validado por `pnpm knowledge:validate`), carregado uma vez por processo; pasta configurável por `KNOWLEDGE_DIR` (padrão: `data/knowledge` do repositório). Cada termo traz `requires` (`declared_rival`/`declared_affinity`) — a mesma regra do `copy_permission`.
- **`/v1/copy`**: templates de `semantic.copy_template` (seed da base) escolhidos por `selectCopy` (`packages/knowledge`). `affinity_source=inferred` → só `inform` tom 1; rivalidade só com `affinity_type=rival&affinity_source=explicit`. `team`/`rival` (UUID ou slug) preenchem `{team}`, `{nickname}` (apelido do mercado) e `{rival}`; `minutes` preenche `{minutes}`; com algum deles, templates com placeholder sem valor são descartados e `text` vem pronto; sem nenhum, `text` é `null` e o cliente preenche o `template`. `variant` é uma semente opaca para variar entre equivalentes — **nunca** envie dado pessoal. Sem template compatível, `selection: null` (200).
- **Cache**: 24 h (`semantic`) com `ETag`/304; tags `derby:<id>`, `team_profile:<slug>`, `derby`, `team_profile`, `copy_template`, `glossary`. O seed semântico ainda não publica no change feed: até lá, mudanças na base valem ao fim do TTL.

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
| Semântica (clássicos, perfis, glossário, copy) | 24 h (retrospecto do clássico: 1 h) | Merge de PR na base / novo seed |
| Quadro de medalhas | 24 h (edição encerrada) · 60 s (em andamento) · 1 h (futura) | Nova carga/QA de medalhas |
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
