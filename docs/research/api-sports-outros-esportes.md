# API-SPORTS — APIs além do futebol (AFL, Baseball, Basketball, F1, Handball, Hockey, MMA, NBA, NFL, Rugby, Volleyball)

> Pesquisa feita em 2026-10-21 para espelhar estas APIs no nosso banco usando o **plano FREE** (100 req/dia **por API**).
> Objetivo: copiar o máximo com o mínimo de chamadas, atualizar diariamente e fazer live polling quando fizer sentido.

## Como esta pesquisa foi feita (e o grau de confiança)

- As páginas oficiais `https://api-sports.io/documentation/<sport>/v<n>` estão atrás de um desafio interativo do Cloudflare (“Verify you are human”) e **não puderam ser lidas diretamente** hoje. Elas são só um invólucro Redoc que carrega um arquivo OpenAPI (`https://api-sports.io/public/documentations/<sport>-v<n>.yaml`).
- **Spec oficial (OpenAPI) lida a partir de cópias arquivadas no Internet Archive**: Basketball (v1.5.2, dez/2025), Baseball (v1.0.9, out/2025), Hockey (v1.0.1, nov/2025), Formula‑1 (v1.3.1, nov/2025), NFL/American Football (v1.4.7, out/2025), NBA v2 (v2.2.5, fev/2024). Nível de confiança: **alto**.
- **AFL, Handball, MMA, Rugby e Volleyball**: o YAML oficial não está arquivado. Para esses, os endpoints e parâmetros vêm de **respostas reais capturadas** (com o eco de `get`/`parameters`) e das classes de query de um SDK .NET open-source (`fabricatorsltd/api-sports`, atualizado em set/2026), além do post oficial de lançamento AFL/MMA. Nível de confiança: **médio** (o nome do endpoint e dos parâmetros é confiável; a obrigatoriedade e os limites, não).
- Os IDs de ligas citados abaixo vêm da resposta completa de `/leagues` capturada nesse repositório (snapshot de 2025/2026). São confiáveis, mas **confirme sempre com 1 chamada a `/leagues`** no bootstrap (é a primeira chamada do plano de qualquer forma).
- As restrições do plano Free **não estão escritas na documentação**. Elas foram reconstruídas a partir de mensagens de erro reais da API relatadas por vários projetos independentes (fontes no fim).

---

## Tabela-resumo comparativa

| API | Host | Bulk mais valioso (1 chamada) | Live (`live=all`) | Atualização documentada | Stats por jogo | Relevância LatAm/Olímpica | Mídia (prefixo) |
|---|---|---|---|---|---|---|---|
| AFL | `v1.afl.api-sports.io` | `games?league=1&season=S` (~200–290 jogos) | Não documentado (post cita “Live Games”) | — | events, quarters, stats teams/players | Nenhuma | `afl/teams`, `afl/leagues` |
| Baseball | `v1.baseball.api-sports.io` | `games?date=D` (todas as ligas); `games?league&season` (MLB 2024 = 2.946 jogos) | Não | games 15 s; standings 1 h; odds 1×/dia | Não | **Alta** (LMB, LMP, LIDOM, LVBP, Caribe, WBC, Pan) | `baseball/teams`, `baseball/leagues` |
| Basketball | `v1.basketball.api-sports.io` | `games?date=D`; `games?league&season` (NBA 24‑25 = 1.387); `/leagues` (427 ligas c/ temporadas + coverage) | Não | games 15 s; stats 30–120 s; standings 1 h; odds 1×/dia | `games/statistics/teams` e `/players` com `ids=` (lote) | **Alta** (NBB, LBF, Liga A, BCLA, AmeriCup, Pan, Olímpicos, Copa do Mundo) | `basketball/teams`, `basketball/leagues` |
| Formula‑1 | `v1.formula-1.api-sports.io` | `races?season=S` (todas as sessões, 180 em 2024); `circuits`; `competitions`; `rankings/drivers?season` | Não (status `Live` em `races`) | — | rankings/races, startinggrid, fastestlaps, pitstops | Baixa (GP de São Paulo / Cidade do México) | `formula-1/drivers|teams|circuits` |
| Handball | `v1.handball.api-sports.io` | `games?date=D`; `games?league&season` | Não documentado | — | Não | Média (Olímpicos, Pan, Pan‑Americano, Sul‑Centro‑Americano; **sem liga nacional BR/AR**) | `handball/teams`, `handball/leagues` |
| Hockey | `v1.hockey.api-sports.io` | `games?date=D`; `games?league&season` (NHL 2024 = 1.503) | Não | games 15 s; standings 1 h; odds 1×/dia | `games/events?game=` | Baixa (Olímpicos de inverno) | `hockey/teams`, `hockey/leagues` |
| MMA | `v1.mma.api-sports.io` | `fights?season=S` (637 lutas em 2024); `fights?date=D`; `teams` (857 equipes) | Não documentado | — | `fights/results`, `fights/statistics/fighters` (aceitam `ids`/`date`) | Média (lutadores BR no UFC; sem filtro por país) | `mma/fighters` |
| NBA (v2) | `v2.nba.api-sports.io` | `games?season=S&league=standard`; `teams` (66); `players/statistics?team&season` | **Sim** `games?live=all` | — | `games/statistics?id`; `players/statistics?game=` | Baixa | **Wikimedia**, não `media.api-sports.io` |
| NFL/NCAA | `v1.american-football.api-sports.io` | `games?league&season` (NFL 2024 = 335); `games?date=D` | **Sim** `games?live=all` | games/events/stats 30 s; standings/injuries 1 h; teams/players 1×/dia; odds 4×/dia | events, stats teams/players | Nenhuma | `american-football/teams|players|leagues` |
| Rugby | `v1.rugby.api-sports.io` | `games?date=D`; `games?league&season` | Não documentado | — | Não | Média (Top 12 ARG, Olímpicos 7s, Pan 7s, Copa do Mundo) | `rugby/teams`, `rugby/leagues` |
| Volleyball | `v1.volleyball.api-sports.io` | `games?date=D`; `games?league&season` | Não documentado | — | Não (`periods` = pontos por set) | **Alta** (Superliga M/F, LVA, VNL, Pan, Copa Pan‑Americana, Mundial de Clubes) | `volley/teams`, `volley/leagues` (atenção: **`volley`**) |

**Regras do plano Free que mudam o plano inteiro (válidas para todas, ver detalhes abaixo):**

1. Cota de **100 req/dia separada por API** (cada esporte tem seu contador); zera às 00:00 UTC; cerca de **10 req/min**.
2. **Parâmetro `season` liberado só para 2022–2024** (“Free plans do not have access to this season, try from 2022 to 2024.”). Na prática, a temporada atual (2025/2026) **não pode ser consultada por `season`** (também não dá `standings`, `teams?league&season` nem `players?team&season` da temporada corrente).
3. **Consulta só por `date` (sem `season`) devolve a temporada atual**, mas apenas na janela **ontem…amanhã** (“Free plans do not have access to this date, try from D‑1 to D+1”). Isso foi relatado para football, basketball, baseball e volleyball. **Há um relato conflitante para hockey/NFL** (`games?date=` sozinho → “The Season field is required”). Teste com 1 chamada no D0.
4. Logos/imagens **não contam na cota**, mas têm rate limit por segundo/minuto: baixe uma vez e sirva do nosso CDN.
5. Erros (cota estourada, plano, parâmetro) chegam com **HTTP 200** e `errors` preenchido. Sempre cheque `errors` antes de confiar em `response`.
6. **Nenhum endpoint destas 11 APIs pagina**: cada chamada devolve o conjunto inteiro (sem `page`).

---

## Regras transversais (todas as APIs)

### Autenticação, envelope e controle de cota
- Só GET, só o header `x-apisports-key` (headers extras dão erro, então cuidado com frameworks JS que injetam headers).
- O envelope é sempre `{get, parameters, errors, results, paging?, response}`. Em erro, `errors` vira objeto, p.ex. `{"plan": "..."}`, `{"requests": "You have reached the request limit for the day"}`, `{"season": "The Season field is required."}`.
- `GET /status` **não conta na cota** (doc oficial) e devolve `requests.current` / `limit_day`.
- Os headers de resposta trazem `x-ratelimit-requests-limit`/`-remaining` (dia) e `X-RateLimit-Limit`/`-Remaining` (minuto).
- **Cota por API**: a home oficial diz “Free plan available for ever including 100 requests per day **for each API**”. Um teste de campo confirmou contadores separados (hockey e american-football com 100/dia cada). A página de cada esporte diz que a cota “reset to zero every day at 00:00 UTC, unused requests are lost”.
- Os planos pagos (referência) são Pro 7.500/dia (300 req/min), Ultra 75.000/dia (450/min) e Mega 150.000/dia (900/min).

### Plano Free: temporadas e datas (evidência de campo, não documentado)
- `season` aceita só **2022, 2023, 2024**. No basketball, as temporadas cruzadas `2022-2023`, `2023-2024` e `2024-2025` funcionam (relato: LBL 2024‑25 OK, `2025-2026` bloqueado).
  - Confirmado em football (vários projetos), basketball, hockey (NHL `season=2026` bloqueado), NFL (`season=2026` bloqueado), MMA (2025/2026 recusados) e rugby (na época, a janela era 2021–2023).
  - Para baseball, F1, handball, volleyball, AFL e NBA **não achei teste explícito**. Assumo a mesma regra (a mensagem é da plataforma comum), mas trate como **a confirmar**.
- `date` sem `season` → traz todas as ligas daquele dia, inclusive a temporada atual, **somente D‑1, D, D+1** (basketball confirmado; football/baseball/volleyball relatados juntos).
- Parâmetros `last`/`next` são pagos no football (“Free plans do not have access to the Last parameter”). No basketball, `h2h/next` e `h2h/last` também não funcionam no Free. Para `races?next=/last=` do F1 **não há confirmação**.
- **Consequência**: no Free, a única forma de acompanhar a temporada corrente é a janela de datas. Não temos `standings` oficiais da temporada atual (podemos calcular a tabela a partir dos jogos). Os elencos atuais (`players?team&season`) também não estão disponíveis.

### Mídia em `media.api-sports.io`
- O texto oficial (presente em todas as specs) diz: “Calls to logos/images do not count towards your daily quota and are provided for free. However these calls are subject to a rate per second & minute… recommended to save this data on your side”. Também avisa que os direitos das marcas são de terceiros.
- Padrões observados nas respostas (o `{id}` é o mesmo da entidade):
  - Bandeiras: `https://media.api-sports.io/flags/{cc}.svg` (código ISO‑2 minúsculo; regiões como “World/Europe” vêm com `flag: null`)
  - `https://media.api-sports.io/{slug}/leagues/{id}.png` e `/{slug}/teams/{id}.png`, com `slug` ∈ `basketball`, `baseball`, `hockey`, `handball`, `rugby`, `afl`, `american-football`, **`volley`**
  - NFL jogadores: `https://media.api-sports.io/american-football/players/{id}.png`
  - F1: `https://media.api-sports.io/formula-1/drivers/{id}.png`, `/formula-1/teams/{id}.png`, `/formula-1/circuits/{id}.png`
  - MMA: `https://media.api-sports.io/mma/fighters/{id}.png` (campo `photo`/`logo`)
  - Também aparece o host espelho `media-1.api-sports.io` em exemplos da spec NFL.
  - **NBA v2**: logos de times apontam para `upload.wikimedia.org/...` (URLs arbitrárias, não derivadas do id). Não há foto de jogador.
  - Basketball, baseball, hockey, handball, rugby e volleyball **não têm foto de jogador** nas respostas.
- Como mídia não gasta cota, podemos construir as URLs pelo id e baixar em lote, respeitando o rate limit (p.ex. 2–5 req/s com backoff) e espelhando em storage/CDN próprio.

### Head‑to‑head
- Basketball, baseball, hockey, handball, rugby e volleyball usam `GET /games/h2h?h2h={teamA}-{teamB}` com `date`, `league`, `season`, `timezone` opcionais. Sem `league/season`, a doc indica que retorna todos os confrontos.
- NFL e NBA usam `GET /games?h2h={A}-{B}`.
- **A confirmar no Free**: se um h2h sem `season` devolve também jogos fora de 2022–2024 ou se é cortado.

---

## 1. AFL — `https://v1.afl.api-sports.io`

Fonte de endpoints: respostas capturadas e SDK (spec oficial não arquivada); post oficial de lançamento (01/03/2024) e beta (02/11/2023). Escopo: só a AFL Premiership (`/leagues` retorna 1 liga, id `1`, com uma linha por temporada 2011–2026).

### 1.1 Endpoints
| Endpoint | Parâmetros | Rendimento de 1 chamada |
|---|---|---|
| `GET /status` | — | conta/cota (não conta) |
| `GET /timezone` | — | ~425 fusos |
| `GET /seasons` | — | 16 temporadas (2011–2026) |
| `GET /leagues` | `id`, `season`, `current` (`true/false`), `timezone`? | todas as temporadas da AFL com `start/end/current` (16 linhas) |
| `GET /teams` | `id`, `name`, `league`, `season`, `search` | 18 times da liga/temporada |
| `GET /teams/statistics` | `id` (time), `season` | estatísticas da temporada de 1 time |
| `GET /players` | `id`, `name`, `team`, `season`, `search` | elenco (ex.: 39 jogadores para `team=1&season=2024`) |
| `GET /players/statistics` | `id` (jogador), `season` | temporada de 1 jogador |
| `GET /standings` | `league`, `season` (obrig. na prática), `team` | tabela inteira (18 linhas) |
| `GET /games` | `id`, `date`, `league`, `season`, `team`, `timezone` | **temporada inteira** com `league&season` (288 jogos em 2024); ou o dia todo com `date` |
| `GET /games/events` | `id` (o SDK também expõe `ids`, `date`) | eventos de 1 jogo |
| `GET /games/quarters` | `id` (idem) | placar por quarto |
| `GET /games/statistics/teams` | `id` (idem) | stats dos 2 times |
| `GET /games/statistics/players` | `id` (idem) | stats de todos os jogadores do jogo |
| `GET /odds` | `game`, `bookmaker`, `bet` | odds de 1 jogo |
| `GET /odds/bets`, `GET /odds/bookmakers` | `id`, `search` | catálogo (53 apostas / 19 casas) |

Observação: o objeto `game` vem aninhado (`{"game":{"id":...}}`), o placar traz `goals/behinds/psgoals`, e o `timestamp` vem como string.

### 1.2 Temporadas no Free
Assumido 2022–2024 (não testado especificamente para AFL).

### 1.3 Mídia
`afl/leagues/{id}.png`, `afl/teams/{id}.png`. Não há fotos de jogadores.

### 1.4 Live
O post de lançamento cita um endpoint “Live Games” com placar em tempo real, mas **o parâmetro `live=all` não está confirmado** (o SDK não o expõe). A frequência não está documentada; use `games?date=hoje`.

### 1.5 Cobertura LatAm/Olímpica
Nenhuma.

### 1.6 Plano mínimo
- **Bootstrap**: `leagues`, `seasons`, `timezone`, `odds/bets`, `odds/bookmakers` (5). Para 2022–2024: `games` + `teams` + `standings` por temporada (9). Elencos `players?team&season` (18×3 = 54). Total ≈ **68 chamadas (1 dia)**.
- Detalhe por jogo (events/quarters/stats ×4 por jogo, ~620 jogos) ≈ 2.500 chamadas → só se `ids`/`date` funcionarem em lote; teste no D0. Senão, priorize finais e playoffs.
- **Diário**: `games?date=D-1`, `D`, `D+1` (3) + polling ao vivo de `games?date=D` nos dias de rodada (~20–40) + detalhes dos jogos encerrados ontem (~9 jogos × 4 = 36). Cabe em < 100.

---

## 2. Baseball — `https://v1.baseball.api-sports.io`

Fonte: spec oficial v1.0.9 (arquivada out/2025) + respostas capturadas. 77 ligas, 19 anos de dados, ~171 mil jogos (página oficial).

### 2.1 Endpoints
| Endpoint | Parâmetros (★ = obrigatório) | Rendimento |
|---|---|---|
| `GET /timezone` | — | lista de fusos |
| `GET /seasons` | — | 19 temporadas (chave de 4 dígitos: `2018-2019` → `2018`) |
| `GET /countries` | `id`, `name`, `code`, `search` | 31 países |
| `GET /leagues` | `id`, `name`, `country_id`, `country`, `type` (league/cup), `season`, `search` | **todas as 77 ligas com todas as temporadas** em 1 chamada |
| `GET /teams` | `id`, `name`, `country_id`, `country`, `league`, `season`, `search` (≥1 parâmetro) | times de uma liga/temporada (MLB = 32) |
| `GET /teams/statistics` | ★`league`, ★`season`, ★`team`, `date` | agregado da temporada de 1 time |
| `GET /games` | `id`, `date`, `league`, `season`, `team`, `timezone` (≥1) | **temporada inteira** (MLB 2024 = 2.946 jogos) ou **todas as ligas de um dia** |
| `GET /games/h2h` | ★`h2h` (`A-B`), `date`, `league`, `season`, `timezone` | confrontos diretos |
| `GET /standings` | ★`league`, ★`season`, `team`, `stage`, `group` | todas as tabelas/grupos da temporada (MLB = 9 grupos) |
| `GET /standings/stages`, `/standings/groups` | ★`league`, ★`season` | listas auxiliares (dispensáveis: `standings` já devolve tudo) |
| `GET /odds` | `league`, `season`, `game`, `bookmaker`, `bet` | pré‑jogo, 1–7 dias antes; histórico de 7 dias |
| `GET /odds/bets`, `/odds/bookmakers` | `id`, `search` | 83 apostas / 30 casas |

Os status de jogo são `NS`, `IN1`…`IN9`, `POST`, `CANC`, `INTR`, `ABD`, `FT`. A spec não lista endpoint de estatística por jogo ou de jogadores.

### 2.2 Temporadas no Free
Presumido 2022–2024. A consulta por `date` (janela D‑1..D+1) funciona para a temporada atual (relato de campo).

### 2.3 Mídia
`baseball/leagues/{id}.png`, `baseball/teams/{id}.png`, `flags/{cc}.svg`.

### 2.4 Live
Sem `live=all`. A doc diz “Games are updated every 15 seconds”, standings a cada hora e odds 1×/dia. Faça polling de `games?date=D` (1 chamada cobre todas as ligas).

### 2.5 Cobertura LatAm/Olímpica (IDs do `/leagues` capturado)
- México LMB **21** (2008–2026) e LMP **22**; Rep. Dominicana LIDOM **11**; Venezuela LVBP **31** e LMBP **57**; Porto Rico LBPRC **25**.
- Cuba Serie Nacional **9** e Liga Élite **63**; Colômbia LPB **49** (e LCBP **8**, até 2019); Nicarágua CNBS **52**.
- Caribbean Series **39**; Serie de las Américas **77**; Central American & Caribbean Games **40**.
- Pan American Games **41** (2011–2023); Olympic Games **47** (2020); World Baseball Classic **70** (2023, 2026); Champions League Americas **69**; World Cup U23 **46**; MLB **1**.
- Brasil: nenhuma liga no snapshot.

### 2.6 Plano mínimo
- **Bootstrap**: `timezone`, `seasons`, `countries`, `leagues`, `odds/bets`, `odds/bookmakers` = 6. Por liga‑temporada (2022–2024): `games` + `teams` + `standings` = 3. Com ~14 ligas prioritárias × ~2,5 temporadas válidas ≈ 35 × 3 ≈ **105 → 2 dias**.
- `teams/statistics` (1 por time) é opcional; dá para derivar dos jogos.
- **Diário (~100)**: 3 chamadas de janela de data. Nas ligas de inverno (out–jan), faça polling de `games?date=D` a cada ~10 min entre 18h e 02h BRT (~48). Sobram ~45 para h2h, odds e backfill.

---

## 3. Basketball — `https://v1.basketball.api-sports.io`

Fonte: spec oficial v1.5.2 (arquivada dez/2025) + respostas capturadas. 427 ligas, 21 anos, ~492 mil jogos, ~65 mil jogadores (página oficial).

### 3.1 Endpoints
| Endpoint | Parâmetros (★ obrigatório) | Rendimento |
|---|---|---|
| `GET /timezone` | — | fusos |
| `GET /seasons` | — | 42 chaves (mistura `2024` e `2024-2025`) |
| `GET /countries` | `id`, `name`, `code`, `search` | 79 países |
| `GET /leagues` | `id`, `name`, `country_id`, `country`, `code`, `type`, `season`, `search` | **427 ligas com todas as temporadas, datas e `coverage`** (games.statistics.teams/players, standings, players, odds) |
| `GET /teams` | `id`, `name`, `country_id`, `country`, `league`, `season`, `search` (≥1) | times da liga/temporada (NBA = 34) |
| `GET /players` | `id`, `team`, `season`, `search` (≥1) | elenco (sem foto) |
| `GET /statistics` | ★`league`, ★`season`, ★`team`, `date` | agregado de 1 time na temporada (atenção: o caminho é `/statistics`, não `/teams/statistics`) |
| `GET /standings` | ★`league`, ★`season`, `team`, `stage`, `group` | todas as tabelas da temporada (“updated every hours”) |
| `GET /standings/stages`, `/standings/groups` | ★`league`, ★`season` | auxiliares |
| `GET /games` | `id`, `date`, `league`, `season`, `team`, `timezone` (≥1) | **temporada inteira** (NBA 2024‑25 = 1.387 jogos) ou **todas as ligas de um dia** |
| `GET /games/statistics/teams` | `id` ou **`ids` (`id-id-id`)** | stats de time de vários jogos em 1 chamada |
| `GET /games/statistics/players` | `id` ou **`ids`**; ou `player`+`season` | box score de vários jogos; ou todos os jogos de 1 jogador na temporada |
| `GET /games/h2h` | ★`h2h`, `date`, `league`, `season`, `timezone` | confrontos |
| `GET /odds` | `league`, `season`, `game`, `bookmaker`, `bet` | pré‑jogo 1–7 dias; histórico de 7 dias; “updated once a day” |
| `GET /bookmakers`, `GET /bets` | `id`, `search` | 34 casas / 245 apostas (caminhos sem `/odds/`) |

Os status são `NS`, `Q1`–`Q4`, `OT`, `BT`, `HT`, `FT`, `AOT`, `POST`, `CANC`, `SUSP`, `AWD`, `ABD`. O limite de quantos ids cabem em `ids` **não está documentado** (no football é 20); teste.

### 3.2 Temporadas no Free
Confirmado 2022–2024 (`2024-2025` OK, `2025-2026` bloqueado). Por data, só D‑1..D+1 (confirmado em 2026-08). `h2h/next`/`h2h/last` não funcionam no Free.

### 3.3 Mídia
`basketball/leagues/{id}.png`, `basketball/teams/{id}.png`, `flags/{cc}.svg`.

### 3.4 Live
Sem parâmetro `live`. A doc diz “Games are updated every 15 seconds” e estatísticas a cada 30–120 s. Faça polling de `games?date=D` (todas as ligas numa chamada).

### 3.5 Cobertura LatAm/Olímpica (IDs verificados no `/leagues` capturado)
- **Brasil**: NBB **26** (2008‑09 → 2025‑26), LBF feminina **27**, Super 8 **220**, CBB **425** (2025, com stats).
- **Argentina**: Liga A (Liga Nacional de Básquet) **18**, Liga Femenina **206**, Torneo Super 20 **22**, Super 4 **179**, Super Cup **180**.
- Chile LNB **114**; Uruguai Liga Uruguaya **110**; México LNBP **63** e CIBACOPA **251**; Porto Rico BSN **76**; Colômbia LBP **225**; Venezuela Superliga **275**; Paraguai LNB **258**; Rep. Dominicana LNB **380**; Bolívia Libobasquet **379**.
- Continentais: Champions League Americas (BCLA) **299**, South American League **414**, South American Championship **413** / feminino **415**, Americas League **288**.
- FIBA/seleções: AmeriCup **282** (2011…2022, 2023), AmeriCup Women **283**, World Cup **281** (… 2019, 2023, 2027), World Cup Women **284** (2022, 2024).
- Multiesportivos: Olympic Games **192** / Women **193** (2012, 2016, 2020, 2024); Pan American Games **286** (2011–2023) / Women **294**.
- Referências: NBA **12**, Euroleague **120**, ACB **117**.
- Em várias destas ligas (NBB, Liga A, BCLA, Olímpicos), a `coverage` vem com `statistics: false` em ao menos uma temporada. **Leia `coverage` por temporada** antes de gastar chamadas em box score.

### 3.6 Plano mínimo
- **Bootstrap D1 (catálogo)**: `timezone`, `seasons`, `countries`, `leagues`, `bookmakers`, `bets` = **6**.
- **Histórico 2022–2024**: ~30 ligas prioritárias (LatAm + FIBA + NBA/Euroleague) ≈ 70 liga‑temporadas × 3 (`games`, `teams`, `standings`) ≈ **210 chamadas (D1–D3)**.
- Box score: só onde `coverage` for verdadeira, com `ids` em lotes. Ex.: NBB ~260 jogos/temporada ÷ 20 ids × 2 endpoints ≈ 26 chamadas por liga‑temporada.
- Elencos (`players?team&season`) só para os times BR/AR.
- **Diário (100)**: `games?date=D-1/D/D+1` (3); stats dos jogos encerrados ontem nas ligas com cobertura, via `ids` (~4); polling `games?date=D` a cada 6–8 min na janela noturna (~70); reserva ~20 para retries e backfill.
- A tabela da temporada atual não sai de `standings` no Free: calcule localmente a partir dos jogos.

---

## 4. Formula‑1 — `https://v1.formula-1.api-sports.io`

Fonte: spec oficial v1.3.1 (arquivada nov/2025) + respostas capturadas. 14 anos (2012–2025 em `/seasons`), 36 circuitos, 117 pilotos.

### 4.1 Endpoints
| Endpoint | Parâmetros (★ obrigatório) | Rendimento |
|---|---|---|
| `GET /timezone`, `GET /seasons` | — | fusos / temporadas |
| `GET /competitions` | `id`, `name`, `country`, `city`, `search` (todos opcionais) | **todos os GPs** sem parâmetro |
| `GET /circuits` | `id`, `competition`, `name`, `search` | **todos os circuitos** (com imagem, recorde, extensão, capacidade) |
| `GET /teams` | `id`, `name`, `search` | **todas as equipes** (nenhum parâmetro obrigatório na spec) |
| `GET /drivers` | `id`, `name`, `search` (≥1 obrigatório) | perfil de 1 piloto (não há listagem em massa; pegue os ids via rankings) |
| `GET /races` | `id`, `date`, `next`, `last`, `competition`, `circuit`, `season`, `type`, `timezone` (exige 1 de id/date/next/last/season) | **todas as sessões da temporada** (TL1–3, quali, sprint, corrida: 180 em 2024) |
| `GET /rankings/drivers` | ★`season`, `driver`, `team` | classificação de pilotos (24 em 2024, com foto) |
| `GET /rankings/teams` | ★`season`, `team` | classificação de construtores (10) |
| `GET /rankings/races` | ★`race`, `team`, `driver` | resultado de 1 sessão (20 linhas) |
| `GET /rankings/fastestlaps` | ★`race`, … | voltas mais rápidas da sessão |
| `GET /rankings/startinggrid` | ★`race`, … | grid de largada |
| `GET /pitstops` | ★`race`, `team`, `driver` | todos os pit stops da corrida (60 em um GP) |

Os tipos de sessão são `Race`, `1st/2nd/3rd Qualifying`, `Sprint`, `1st/2nd/3rd Sprint Shootout` e `1st/2nd/3rd Practice`. Os status são `Live`, `Completed`, `Cancelled`, `Postponed` e `Scheduled`.

### 4.2 Temporadas no Free
Presumido 2022–2024 (não testado). `next`/`last` provavelmente são pagos (precedente do football).

### 4.3 Mídia
`formula-1/drivers/{id}.png`, `formula-1/teams/{id}.png`, `formula-1/circuits/{id}.png`.

### 4.4 Live
Sem filtro live. `races` traz `status: Live` e `laps.current`. Não há frequência documentada.

### 4.5 LatAm
GP de São Paulo e GP da Cidade do México: resolver via `/competitions?search=` (sem ID verificado aqui).

### 4.6 Plano mínimo
- **D1**: `timezone`, `seasons`, `competitions`, `circuits`, `teams` (5). Para 2022–2024: `races?season`, `rankings/drivers`, `rankings/teams` (9). Total ≈ 14.
- **D1–D4**: ~68 GPs × 4 (`rankings/races` da corrida, `startinggrid`, `fastestlaps`, `pitstops`) ≈ 272. Mais quali/sprint ≈ 90. `drivers?id` para ~40 pilotos únicos.
- **Total** ≈ 420 chamadas (5 dias).
- **Diário**: fora de fim de semana de GP, 1–2 chamadas (`races?date=D`). No GP, poll de `races?id` a cada ~5 min durante a sessão (~30) e depois resultados/grid/voltas/pits (4–8).
- Temporada atual: só via `date` (janela D‑1..D+1) e `id`, se o Free aceitar `id` de corrida de 2026. **A confirmar.**

---

## 5. Handball — `https://v1.handball.api-sports.io`

Fonte: respostas capturadas e SDK (spec oficial não arquivada). 211 ligas, 21 anos, ~185 mil jogos.

### 5.1 Endpoints
Mesma estrutura “v1 clássica”: `timezone`, `seasons`, `countries`, `leagues` (id, name, country_id, country, type, season, search), `teams` (id, name, country_id, country, league, season, search), `teams/statistics` (league, season, team, date), `games` (id, date, league, season, team, timezone), `games/h2h` (h2h, date, league, season, timezone), `standings` (league, season, team, stage, group), `standings/stages`, `standings/groups`, `odds` (league, season, game, bookmaker, bet), `odds/bets`, `odds/bookmakers`.

**Não há** estatísticas por jogo, jogadores nem eventos. O jogo traz `scores` e `periods.first/second`. Rendimentos observados: `/leagues` = 211 ligas com temporadas; `games?league=39&season=2024` (Bundesliga) = 306 jogos; `odds/bets` = 105.

### 5.2 Temporadas no Free
Presumido 2022–2024.

### 5.3 Mídia
`handball/leagues/{id}.png`, `handball/teams/{id}.png`.

### 5.4 Live
Sem `live=all` conhecido e sem frequência documentada (a home cita “Real-time games… updated every 15 seconds” de forma genérica). Faça polling de `games?date=D`.

### 5.5 Cobertura LatAm/Olímpica (IDs verificados)
- **Não há liga nacional do Brasil, da Argentina nem de outro país latino** (os países do catálogo são Europa, Ásia, África e “World”).
- Olympic Games **155** (2012–2024) / Women **156** (temporadas 2012, 2016, 2020, **2023**: rótulo suspeito para Paris 2024, confira).
- Pan American Games **170** / Women **169** (2015, 2019, 2023).
- Pan American Championship **172** (2016, 2018) / Women **174**; Pan American Club Championship **171** / Women **173**.
- South and Central American Championship **165** (2020–2026) / Women **166**.
- World Championship **153** (2023, 2025) / Women **154**; Super Globe **163**; Friendly International **196**/**197**.

### 5.6 Plano mínimo
- **D1**: catálogo (6: `timezone`, `seasons`, `countries`, `leagues`, `odds/bets`, `odds/bookmakers`). Internacionais 2022–2024 (~15 liga‑temporadas × `games`+`teams`+`standings` = 45). Ligas europeias de referência opcionais (Bundesliga, ASOBAL, Champions: ~9 × 3 × 3 = 81 → D2).
- **Diário**: 3 chamadas de data + polling moderado em dias de torneio (~30–60).

---

## 6. Hockey — `https://v1.hockey.api-sports.io`

Fonte: spec oficial v1.0.1 (arquivada nov/2025) + respostas capturadas. 262 ligas, 19 anos, ~406 mil jogos.

### 6.1 Endpoints
| Endpoint | Parâmetros (★) | Rendimento |
|---|---|---|
| `timezone`, `seasons` | — | listas |
| `countries` | `id`, `name`, `code`, `search` | 36 países |
| `leagues` | `id`, `name`, `country_id`, `country`, `type`, `season`, `search` | **262 ligas com temporadas** |
| `teams` | idem basketball (≥1) | NHL 2024 = 32 |
| `teams/statistics` | ★`league`, ★`season`, ★`team`, `date` | agregado |
| `standings` (+`/stages`, `/groups`) | ★`league`, ★`season`, `team`, `stage`, `group` | tabelas (“updated every hours”) |
| `games` | `id`, `date`, `league`, `season`, `team`, `timezone` | NHL 2024 = 1.503 jogos; o campo `events` (bool) indica se há eventos |
| `games/h2h` | ★`h2h`, `date`, `league`, `season`, `timezone` | confrontos |
| `games/events` | ★`game` | gols e penalidades do jogo (período, minuto, jogadores, assistências) |
| `odds` (+`/bets`, `/bookmakers`) | `league`, `season`, `game`, `bookmaker`, `bet` | 221 apostas / 29 casas |

### 6.2 Temporadas no Free
Confirmado 2022–2024 (NHL `season=2026` bloqueado). **Relato de que `games?date=` sozinho falha** (“The Season field is required”), em conflito com o comportamento do basketball. Teste no D0.

### 6.3 Mídia
`hockey/leagues/{id}.png`, `hockey/teams/{id}.png`.

### 6.4 Live
Sem parâmetro live. “Games are updated every 15 seconds”.

### 6.5 LatAm/Olímpico
Olympic Games **131** (2018–2026) / Women **151**; NHL **57**. Sem ligas latino-americanas.

### 6.6 Plano mínimo
- **D1**: catálogo (6) + NHL e Olímpicos 2022–2024 (~5 liga‑temporadas × 3 = 15). Eventos por jogo (1 por jogo) só para playoffs e Olímpicos (~120).
- **Diário**: se `date` funcionar, 3 chamadas + polling. Se não funcionar, **a temporada corrente fica inacessível no Free** e o hockey vira só histórico.

---

## 7. MMA — `https://v1.mma.api-sports.io`

Fonte: respostas capturadas e SDK (spec oficial não arquivada); posts oficiais. ~2.500 lutas, 845 equipes, ~2.860 lutadores. Temporadas 2022–2026.

### 7.1 Endpoints
| Endpoint | Parâmetros | Rendimento |
|---|---|---|
| `GET /timezone`, `GET /seasons` | — | 5 temporadas |
| `GET /categories` | `search` | 18 categorias de peso |
| `GET /teams` | `id`, `search` | **todas as 857 equipes/academias** em 1 chamada |
| `GET /fighters` | `id`, `team`, `name`, `category`, `search` | perfil (apelido, altura, peso, envergadura, base, categoria, equipe, `photo`); `category=`/`team=` podem servir de lote (**a confirmar**) |
| `GET /fighters/records` | `id` | cartel de 1 lutador |
| `GET /fights` | `id`, `date`, `season`, `fighter`, `category`, `timezone` | **temporada inteira** (`season=2024` → 637 lutas) ou todas as lutas de um dia |
| `GET /fights/results` | `id`, **`ids`**, `date` | resultado (vencedor, método, round) em lote |
| `GET /fights/statistics/fighters` | `id`, **`ids`**, `date` | estatísticas dos lutadores na luta |
| `GET /odds` | `fight`, `date`, `bookmaker`, `bet` | odds |
| `GET /odds/bets`, `/odds/bookmakers` | `id`, `search` | 29 / 20 |

Não existe filtro por organização. O evento é identificado pelo `slug` (ex.: “UFC Fight Night: …”) e pelo campo `is_main`. Não há país/nacionalidade no lutador.

### 7.2 Temporadas no Free
Confirmado 2022–2024 (2025/2026 recusados).

### 7.3 Mídia
`mma/fighters/{id}.png`.

### 7.4 Live
Nada documentado. Use `fights?date=D` + `fights/results?date=D`.

### 7.5 LatAm
Lutadores brasileiros e latinos aparecem nas lutas, mas não há filtro por país (seria preciso enriquecer a partir de outra fonte). Eventos no Brasil/México só identificáveis pelo slug.

### 7.6 Plano mínimo
- **D1**: `seasons`, `categories`, `teams`, `odds/bets`, `odds/bookmakers`, `timezone` (6) + `fights?season=2022/2023/2024` (3) = **9 chamadas para ~1.900 lutas**.
- Resultados e estatísticas via `ids` em lote (se aceitar ~20 ids: ~190 chamadas para 2022–2024 → 2 dias), ou via `date` (~50 datas de evento/ano × 2 × 3 anos ≈ 300).
- Perfis: `fighters?category=` (18) se retornar lista; senão, perfil e cartel só para os lutadores de eventos recentes.
- **Diário**: `fights?date=D-1/D/D+1` (3) + `fights/results?date=D-1` e `statistics?date=D-1` (2). Em noite de evento, polling de `fights/results?date=D` a cada 10–15 min (~20).

---

## 8. NBA (v2) — `https://v2.nba.api-sports.io`

Fonte: spec oficial v2.2.5 (arquivada fev/2024) + respostas capturadas em 2026 (mesmo formato). 11 temporadas (2015–2025), ~16 mil jogos.

### 8.1 Endpoints
| Endpoint | Parâmetros (★) | Rendimento |
|---|---|---|
| `GET /seasons` | — | `[2015…2025]` |
| `GET /leagues` | — | `africa`, `orlando`, `sacramento`, `standard`, `utah`, `vegas` |
| `GET /games` | `id`, `date`, **`live` (`all`)**, `league`, `season`, `team`, **`h2h`** (≥1) | temporada inteira com `season`(+`league=standard`); dia; ao vivo; confrontos |
| `GET /games/statistics` | ★`id` | stats dos 2 times no jogo |
| `GET /teams` | `id`, `name`, `code`, `league`, `conference`, `division`, `search` | **66 times** sem parâmetro |
| `GET /teams/statistics` | ★`id`, ★`season`, `stage` | agregado do time |
| `GET /players` | `id`, `name`, `team`, `season`, `country`, `search` (≥1) | elenco (`team&season`) |
| `GET /players/statistics` | `id`, `game`, `team`, `season` (≥1) | **box score**: `game=` → todos do jogo; `team&season` → todas as linhas da temporada do time; `id&season` → 78 jogos de 1 jogador |
| `GET /standings` | ★`league`, ★`season`, `team`, `conference`, `division` | 30 times |

Estrutura: `teams.visitors/home`, `scores.*.linescore`, `periods`, `arena`, `officials`. Não há odds.

### 8.2 Temporadas no Free
Presumido 2022–2024.

### 8.3 Mídia
Logos de times vêm de **Wikimedia** (URL livre, não derivável do id); sem fotos de jogador. Baixe e espelhe.

### 8.4 Live
**`games?live=all`** existe. A frequência não está documentada na spec.

### 8.5 LatAm
Nenhuma liga; jogadores latinos aparecem via `players?country=` (ex.: Brazil).

### 8.6 Plano mínimo
- **D1**: `seasons`, `leagues`, `teams` (3). Para 2022–2024: `games?league=standard&season` + `standings` (6). `players?team&season` (30×3 = 90) → D1–D2.
- **D2–D4**: `players/statistics?team&season` (30×3 = 90): toda a estatística individual de 3 temporadas. O total por time sai da soma (evita ~3.900 chamadas de `games/statistics`).
- **Diário**: `games?date=D` (+D‑1) (2). `games?live=all` a cada ~5 min nas noites de jogo (~70). `players/statistics?game=` para os jogos de ontem (~8–12).

---

## 9. NFL / American Football — `https://v1.american-football.api-sports.io`

Fonte: spec oficial v1.4.7 (arquivada out/2025) + respostas capturadas. Ligas: NFL **1** e NCAA **2**; 16 temporadas (2010–2025).

### 9.1 Endpoints
| Endpoint | Parâmetros (★) | Atualização | Rendimento |
|---|---|---|---|
| `timezone`, `seasons` | — | — | listas |
| `leagues` | `id`, `season`, `current` | — | 2 ligas com `coverage` por temporada |
| `teams` | `id`, `league`, `season`, `name`, `code`, `search` (≥1) | diária | 34 (NFL) |
| `players` | `id`, `name`, `team`, `season`, `search` (≥1) | diária | elenco com foto |
| `players/statistics` | `id` ou `team` + ★`season` | diária | temporada por grupos (Passing, Rushing…); dados desde 2022 |
| `injuries` | `player` ou `team` | horária | só lesionados atuais (sem histórico) |
| `games` | `id`, `date`, `league`, `season`, `team`, **`h2h`**, **`live=all`**, `timezone` | **30 s** | NFL 2024 = 335 jogos |
| `games/events` | ★`id` | 30 s | drives/pontuações |
| `games/statistics/teams` | ★`id`, `team` | 30 s | 2 times |
| `games/statistics/players` | ★`id`, `group`, `team`, `player` | 30 s | todos os jogadores |
| `standings` | ★`league`, ★`season`, `team`, `conference`, `division` | horária | 32 |
| `standings/conferences`, `/divisions` | ★`league`, ★`season` | — | 2 / 8 |
| `odds` | ★`game`, `bookmaker`, `bet` | 4×/dia | 1 jogo |
| `odds/bets`, `/odds/bookmakers` | `id`, `search` | — | 361 / 24 |

### 9.2 Temporadas no Free
Confirmado 2022–2024 (`season=2026` bloqueado). **Relato de que `games?date=` sem `season` é recusado**: a temporada atual pode ser totalmente inacessível no Free. Teste.

### 9.3 Mídia
`american-football/teams/{id}.png`, `american-football/players/{id}.png`, `american-football/leagues/{id}.png`.

### 9.4 Live
**`games?live=all`**, atualização de 30 s.

### 9.5 LatAm
Nenhuma (só o jogo da NFL no Brasil/México pelo calendário).

### 9.6 Plano mínimo
- **D1**: catálogo (5) + `games`/`teams`/`standings` × 2 ligas × 3 temporadas (18) + `players/statistics?team&season` NFL (32×3 = 96) → D1–D2.
- Elencos `players?team&season` (96) → D2–D3.
- Detalhe por jogo (3 × ~855 jogos) ≈ 2.565 → só playoffs (~39 jogos × 3 ≈ 120).
- **Diário**: se `date` funcionar, 3 + `live=all` a cada 2–3 min nos domingos (~60–80). Caso contrário, só histórico.

---

## 10. Rugby — `https://v1.rugby.api-sports.io`

Fonte: respostas capturadas e SDK. 142 ligas, 20 anos, ~50 mil jogos.

### 10.1 Endpoints
A mesma família v1 clássica do handball: `timezone`, `seasons`, `countries`, `leagues`, `teams`, `teams/statistics`, `games`, `games/h2h`, `standings` (+stages/groups), `odds`, `odds/bets`, `odds/bookmakers`. Não há estatísticas por jogo nem jogadores. Rendimentos: `/leagues` = 142; `games?league=16&season=2024` (Top 14) = 188 jogos.

### 10.2 Temporadas no Free
Presumido 2022–2024. Um relato antigo mostra a janela 2021–2023 (ela anda com o tempo).

### 10.3 Mídia
`rugby/leagues/{id}.png`, `rugby/teams/{id}.png`.

### 10.4 Live
Não documentado. Polling de `games?date=D`.

### 10.5 LatAm/Olímpico (IDs verificados)
- Argentina Top 12 **1** (2021–2026).
- Americas Championship **100** (2017–2019); Americas Pacific Challenge **92**.
- Olympic Games 7's **74** / Women **75** (2016–2024); Pan American Games 7's **107** / Women **108** (2019, 2023).
- World Cup **69** / Women **70**; Sevens World Cup **86**/**87**; Super Rugby **71**; Major League Rugby **44**.
- **Super Rugby Americas, Uruguai, Chile e Brasil: não encontrados no snapshot** → resolver via `/leagues?search=`.

### 10.6 Plano mínimo
- **D1**: catálogo (6) + ~12 liga‑temporadas × 3 ≈ 36.
- **Diário**: 3 + polling leve nos fins de semana.

---

## 11. Volleyball — `https://v1.volleyball.api-sports.io`

Fonte: respostas capturadas e SDK. 261–262 ligas, 19 anos, ~202 mil jogos.

### 11.1 Endpoints
Família v1 clássica: `timezone`, `seasons` (19), `countries` (56), `leagues` (262 com temporadas), `teams`, `teams/statistics` (league, season, team, date), `games` (id, date, league, season, team, timezone), `games/h2h`, `standings` (+stages/groups), `odds`, `odds/bets` (94), `odds/bookmakers` (24).

Não há stats por jogo nem jogadores. **Atenção:** `scores` = **sets vencidos**; os pontos de cada set ficam em `periods`. Os status são `NS`, `S1`–`S5`, `FT`, `AW`, `POST`, `CANC`, `INTR`, `ABD`.

### 11.2 Temporadas no Free
Presumido 2022–2024. Por data, D‑1..D+1 (relato de campo com volleyball).

### 11.3 Mídia
**`volley/leagues/{id}.png`** e **`volley/teams/{id}.png`** (o slug é `volley`, não `volleyball`).

### 11.4 Live
Não documentado. Polling de `games?date=D`.

### 11.5 Cobertura LatAm/Olímpica (IDs verificados)
- **Brasil**: Superliga masculina **25** (2008–2025) e Superliga feminina **24** (2009–2025).
- **Argentina**: LVA **4**, Liga Women **3**, Copa ACLAV **2**, Copa Master **1**.
- Peru LNSV **111** / Women **110**; Porto Rico LVSM **127** (2015–2016).
- Nations League (VNL) **183** / Women **184** (2018–2026).
- Pan American Games **195** / Women **213** (até 2023); Pan‑American Cup **206** / Women **201** (2010–2025), U21 **212**, U23 **215**/**216**.
- Club World Championship **223** / Women **224**; World Championship **185** / Women **186**; World Cup **188**/**187**.
- Olympic Games **189** / Women **190**: temporadas 2012, 2016, 2020/2019, **2023**. O rótulo provavelmente corresponde a Tóquio/Paris; **valide antes de mapear**.
- Sul‑Americano de Clubes: **não encontrado** → resolver via `/leagues?search=`.

### 11.6 Plano mínimo
- **D1**: catálogo (6) + Superliga M/F, LVA, Liga Women AR, Peru M/F (6 ligas × 3 temporadas × 3 = 54).
- **D2**: VNL M/F, Pan‑Am Cup M/F, Mundial de Clubes M/F, Mundial 2022 M/F, Pan 2023 M/F, Olímpicos M/F (~22 liga‑temporadas × 3 = 66).
- **Diário**: 3 + polling `games?date=D` a cada ~10 min nas noites de Superliga (~40).

---

## Orçamento consolidado (por chave/esporte, 100/dia cada)

| API | Bootstrap estimado (histórico 2022–2024, prioridade LatAm) | Dias | Diário típico |
|---|---|---|---|
| AFL | ~70 (+ detalhes de jogo opcionais) | 1 | 10–80 |
| Baseball | ~110 | 2 | 3 + ~50 polling |
| Basketball | ~6 + ~210 + box score ~150 | 4 | 3 + ~70 polling + ~5 stats |
| Formula‑1 | ~420 | 5 | 2 (semana) / ~40 (GP) |
| Handball | ~50–130 | 1–2 | 3 + ~30 |
| Hockey | ~20 + ~120 eventos | 2 | 3 + polling (se `date` funcionar) |
| MMA | ~9 + ~200–300 resultados/stats | 3–4 | 5 (+20 em noite de evento) |
| NBA | ~190 | 2–3 | 2 + ~70 live + ~10 box |
| NFL | ~220 (+120 playoffs) | 3–4 | 3 + ~70 (se `date` funcionar) |
| Rugby | ~45 | 1 | 3 + ~20 |
| Volleyball | ~126 | 2 | 3 + ~40 |

Padrão recomendado para todas:
1. Chamar `/status` primeiro (grátis) e abortar se `requests.current` estiver perto do limite.
2. Gravar o JSON bruto de cada resposta (auditoria/reprocessamento).
3. Checar `errors` em toda resposta 200.
4. Usar sempre `timezone` explícito (ex.: `America/Sao_Paulo`) ou UTC nas chamadas por data.
5. Respeitar ~10 req/min (fila com 6–7 s entre chamadas).
6. Baixar a mídia fora da cota, com rate limit próprio.

---

## Itens não verificáveis / a testar no D0 (custo: ~10 chamadas no total)

1. **Hockey e NFL**: `games?date=D` sem `season` funciona no Free? (Há relato de “The Season field is required”.)
2. Janela Free de temporadas em **baseball, F1, handball, volleyball, AFL, NBA e rugby** (assumida 2022–2024).
3. Quantos ids cabem em `ids=` (basketball `games/statistics/*`, MMA `fights/results` e `statistics`, AFL lookups).
4. AFL e NBA: existência e frequência de `live=all` (NBA tem o parâmetro na spec; AFL só é citado no post).
5. `h2h` sem `season` no Free: devolve tudo ou corta fora de 2022–2024?
6. F1 `races?next=/last=` e `id` de corrida de 2026 no Free.
7. Rótulos de temporada olímpica no volleyball (2019/2023) e no handball feminino (2023).
8. Ligas não encontradas no snapshot: Super Rugby Americas, Sul‑Americano de Clubes de vôlei, ligas nacionais de handball na América Latina.

---

## Fontes

Oficiais (api-sports.io / api-football.com):
- Documentação oficial (bloqueada por Cloudflare no momento da pesquisa): https://api-sports.io/documentation/basketball/v1 · https://api-sports.io/documentation/baseball/v1 · https://api-sports.io/documentation/hockey/v1 · https://api-sports.io/documentation/formula-1/v1 · https://api-sports.io/documentation/handball/v1 · https://api-sports.io/documentation/volleyball/v1 · https://api-sports.io/documentation/rugby/v1 · https://api-sports.io/documentation/mma/v1 · https://api-sports.io/documentation/afl/v1 · https://api-sports.io/documentation/nba/v2 · https://api-sports.io/documentation/nfl/v1
- Specs OpenAPI oficiais (cópias arquivadas):
  - https://web.archive.org/web/20251202061810/https://api-sports.io/public/documentations/basketball-v1.yaml
  - https://web.archive.org/web/20251012162254/https://api-sports.io/public/documentations/baseball-v1.yaml
  - https://web.archive.org/web/20251117003644/https://api-sports.io/public/documentations/hockey-v1.yaml
  - https://web.archive.org/web/20251116101419/https://api-sports.io/public/documentations/formula1-v1.yaml
  - https://web.archive.org/web/20251012182508/https://api-sports.io/public/documentations/nfl-v1.yaml
  - https://web.archive.org/web/20240209233655/https://api-sports.io/documentation/nba/nba-v2.yaml
- Home e páginas por esporte (planos, cota por API, reset 00:00 UTC, contagens): https://api-sports.io/ (arquivo 2026-08-30) · https://api-sports.io/sports/basketball (e demais `/sports/<sport>`, arquivos 2026)
- Posts oficiais: https://www.api-football.com/news/post/two-new-apis-available-mma-and-afl (01/03/2024) · https://www.api-football.com/news/post/beta-access-to-api-afl-api-mma-now-open (02/11/2023)

Terceiros (respostas reais capturadas / testes de campo do plano Free):
- Respostas capturadas e SDK: https://github.com/fabricatorsltd/api-sports (pastas `api-specs/` e `src/ApiSports.Sdk.*/QueryParams`)
- Free = só `date` D‑1..D+1, `season` 2022–2024, 100/dia por esporte, 10/min (football/baseball/basketball/volleyball): https://github.com/moneyally/sodam_bot/blob/main/sodam/sports/providers.py
- Free sem temporada atual em NHL/NFL; `date` sozinho recusado; contadores separados por esporte: https://github.com/NoXqc/VesperTV/blob/main/dev-notes/sports-tab.md
- Basketball Free: 2024‑25 ok, 2025‑26 bloqueado, `h2h/next|last` indisponíveis: https://github.com/ElieMirza/dawri/blob/main/docs/DATA.md
- Basketball Free: janela de datas D‑1..D+1: https://github.com/Ozaveshe/oddspadi/blob/main/docs/fixture-reconciliation.md
- MMA Free: 2022–2024; sem filtro por organização: https://github.com/garyreyes/ufc-scouting-app/blob/main/src/lib/ufc-data-sync/fetchFightHistory.ts
- Rugby Free (janela antiga 2021–2023): https://github.com/BTLOPER/RugbyApiApp
- Diferenças de schema entre hosts (volleyball `scores` = sets): https://github.com/DanielTomaro13/sportsdata-mcp/blob/main/documentation/APISports.md
