# API-FOOTBALL v3 (api-sports.io): pesquisa para o espelho interno

> Pesquisa feita em 2026-10-21. Base URL: `https://v3.football.api-sports.io`. Autenticação pelo header `x-apisports-key`.
> As páginas oficiais (api-football.com, api-sports.io) estão atrás de um desafio anti-bot da Cloudflare e não puderam ser lidas diretamente. Por isso as fontes primárias foram lidas pelas cópias do Internet Archive (ver [Fontes](#fontes)). A especificação OpenAPI oficial (`public/doc/openapi.yaml`, versão **3.9.3**, que a própria documentação carrega) foi a base do catálogo de endpoints.
> Comportamentos do plano Free que **não aparecem na documentação oficial** (janela de temporadas, janela de datas, parâmetros bloqueados, limite de páginas) foram confirmados pelas mensagens de erro literais da API, registradas por vários desenvolvedores independentes em 2025–2026. Esses pontos estão marcados com **[empírico]**.

Legenda: **[oficial]** = documentação, termos ou preços do fornecedor · **[empírico]** = resposta real da API observada por terceiros · **[inferência]** = conclusão nossa, a validar com a nossa chave.

---

## Sumário executivo

- **Free = 100 requisições/dia e 10/min**, com reset às **00:00 UTC**. Logos e imagens **não** contam na cota, mas têm limite por segundo e por minuto. `/status` também não conta.
- **Em 2026 o Free só libera as temporadas 2022, 2023 e 2024** em qualquer endpoint que receba `season`. A temporada atual (2025/26 e 2026) fica bloqueada. Para o "agora", o Free só enxerga uma **janela de datas de ontem a amanhã** (`fixtures?date=`, `injuries?date=`), além de `fixtures?live=`, `fixtures?id=` e `predictions?fixture=`. **[empírico]**
- **O Free bloqueia `ids`, `last` e `next` e limita `page` a 3.** Sem `ids`, o detalhe de cada partida custa 1 requisição (`fixtures?id=`, que já traz eventos, escalações, estatísticas e jogadores). **[empírico]**
- **Endpoints sem parâmetro `season` devolvem a história inteira numa só chamada**, e é isso que explica a "extração de todos os anos com uma requisição": `/leagues` (todas as competições, todas as temporadas e o `coverage` de cada uma), `/transfers?team=`, `/trophies?players=`, `/sidelined?players=`, `/players/teams?player=`, `/coachs?team=`, `/fixtures/headtohead?h2h=`, `/teams?country=`, `/venues?country=`.
- **Planos pagos:** Pro US$19/mês (7.500/dia, 300/min) · Ultra US$29 (75.000/dia, 450/min) · Mega US$39 (150.000/dia, 900/min) · planos sob medida até 1,5 milhão/dia. **[oficial]**
- **Não há webhooks nem push.** A API só aceita GET, então o ao vivo é por polling. Os widgets são gratuitos, mas consomem a cota da chave usada.
- **Os termos proíbem várias contas para somar cota no Free** e proíbem revender os dados "diretamente". O uso interno com cache é compatível com os termos.

---

## 1. Plano Free (2026), histórico e planos pagos

### 1.1 Plano Free hoje

| Item | Valor | Tipo |
|---|---|---|
| Cota diária | **100 requisições/dia** por API/esporte | [oficial] preços e docs |
| Limite por minuto | **10 req/min**. `/status` informa e o erro diz literalmente `Too many requests. Your rate limit is 10 requests per minute.` | [empírico] |
| Reset | **00:00:00 UTC** (assinatura pelo dashboard). Requisições não usadas se perdem | [oficial] termos e página api-sports.io |
| Endpoints | Todos os endpoints e competições estão "incluídos", mas "Free plans are limited in terms of available seasons" | [oficial] preços |
| Temporadas | **2022, 2023 e 2024** (`Free plans do not have access to this season, try from 2022 to 2024.`) | [empírico], observado de 2026-03 a 2026-10 |
| Temporada atual | **Não acessível por `season`.** 2025 e 2026 são recusadas em `/fixtures`, `/standings`, `/teams`, `/players/top*` etc. | [empírico] |
| Janela de datas | `date=` só aceita **ontem, hoje e amanhã (UTC)**. Erro: `Free plans do not have access to this date, try from AAAA-MM-DD to AAAA-MM-DD` | [empírico], 2026-08 a 2026-10 |
| Parâmetros bloqueados | `ids` (`...to the Ids parameter.`), `last` (`...to the Last parameter.`), `next` (`...to the Next parameter.`) | [empírico], 2026-09 |
| Paginação | `page` ≤ 3 (`Free plans are limited to a maximum value of 3 for the Page parameter`) | [empírico], 2026-10-19 |
| Odds | Relatos de odds só em 2022–2024 e `odds?date=` só na janela de 3 dias. Na prática, quase inútil no Free | [empírico], fraco |
| Mudanças | O fornecedor "se reserva o direito de modificar o Free Plan e os dados disponíveis a qualquer momento sem aviso" | [oficial] termos (paráfrase) |

**O que funciona para a temporada atual no Free** [empírico]:
- `fixtures?date=` (ontem, hoje e amanhã);
- `fixtures?live=all`;
- `fixtures?id=<id>`, se você já tiver o id;
- `fixtures/statistics|events|lineups|players?fixture=`;
- `predictions?fixture=`;
- `injuries?date=` e `injuries?fixture=`;
- todos os endpoints **sem** `season`: `players/squads`, `transfers`, `trophies`, `sidelined`, `coachs`, `teams?id|country`, `venues`, `leagues`, `countries`, `players/profiles`, `players/teams`, `players/seasons`.

Consequência [inferência]: partidas da temporada atual anteriores ao início do espelho **não podem ser listadas no Free**, porque não há `season`, `last`/`next` nem datas fora da janela. O espelho da temporada corrente só pode ser construído **daqui para frente**, um dia por vez.

### 1.2 Histórico da regra de temporadas

| Período | Evidência | Regra |
|---|---|---|
| até 2024-08-11 | A página de preços diz só "All our plans include all competitions and endpoints", sem ressalva | Sem limitação de temporadas anunciada. Provavelmente é a época em que "tudo com o Free" era possível [inferência] |
| entre 2024-08-11 e 2024-09-08 | A ressalva "(Free plans are limited in terms of available seasons)" aparece na página de preços | Início oficial da limitação [oficial] |
| 2025-03 a 2025-12 | Erro `try from 2021 to 2023` | Janela de 3 temporadas: 2021–2023 [empírico] |
| 2026-03 a 2026-10 | Erro `try from 2022 to 2024` | Janela deslocada em 1 ano: 2022–2024 [empírico] |
| 2026-08 a 2026-10 | Janela de datas ontem→amanhã; `last`, `next` e `ids` bloqueados; `page` ≤ 3 | Restrições adicionais observadas [empírico]. Não sabemos quando começaram |

A janela anda em blocos de 3 temporadas, deixando de fora as duas mais recentes. Ela foi deslocada entre dez/2025 e mar/2026, então é provável um novo deslocamento (para 2023–2025) no início de 2027 [inferência].

### 1.3 Planos pagos (página oficial de preços, mar/2026; página da API em mar/2026)

| Plano | Preço/mês | Requisições/dia | Limite/min | Assentos | Observações |
|---|---|---|---|---|---|
| Free | US$0 | 100 | 10 [empírico] | – | Temporadas limitadas |
| **Pro** | **US$19** | **7.500** | **300** | 1 | Todas as temporadas e endpoints |
| **Ultra** | **US$29** | **75.000** | **450** | 2 | |
| **Mega** | **US$39** | **150.000** | **900** | 3 | |
| Custom | sob consulta | até **1.500.000** | maior | – | Para quem precisa de mais cota diária e/ou limite por minuto maior |

- O pagamento é **pré-pago** (PayPal ou cartão), sem renovação automática. Há desconto de até 30% em 3, 6 ou 12 meses. Ao expirar, a conta volta ao Free. Upgrades são definitivos e não há downgrade. [oficial]
- **Não há cobrança de excedente** pelo dashboard: atingida a cota, a API devolve erro até o reset. Pela RapidAPI, a cota reseta no horário da assinatura e há overage. As chaves e URLs de RapidAPI e dashboard são separadas. [oficial]

---

## 2. Contagem de cota

| Pergunta | Resposta | Tipo |
|---|---|---|
| Escopo | Por conta/assinatura e por API (cada esporte é uma API com seu próprio plano e cota). A RapidAPI tem chave e cota separadas | [oficial] para os canais separados. Cota por esporte: fontes secundárias e o enunciado do projeto |
| Reset | 00:00 UTC (dashboard). Na RapidAPI, no horário da assinatura | [oficial] |
| Headers diários | `x-ratelimit-requests-limit` (cota do dia) e `x-ratelimit-requests-remaining` (restante no dia) | [oficial] |
| Headers por minuto | `X-RateLimit-Limit` (máximo/min) e `X-RateLimit-Remaining` (restante no minuto) | [oficial] |
| `/status` conta? | **Não** (a documentação diz explicitamente que essa chamada não conta na cota diária). Devolve plano, validade, `requests.current` e `limit_day` | [oficial] |
| Paginação | **Cada página é uma requisição** (`page=2`, `page=3`…). Os tutoriais oficiais iteram página a página | [oficial] tutorial |
| Erros contam? | **Sem declaração oficial.** Relatos indicam que requisições recusadas por plano (`errors.plan`) **consomem cota**. Trate todo GET que chega ao servidor como cobrado e pré-valide temporada, data e parâmetros antes de chamar | [empírico], fraco |
| Formato do erro | HTTP 200 com `results: 0` e `errors` como **objeto** (`{"plan": "..."}`, `{"rateLimit": "..."}`, `{"requests": "You have reached the request limit for the day..."}`, `{"token": ...}`). No sucesso, `errors` é `[]` | [oficial] e [empírico] |
| Estouro por minuto | Pode levar a bloqueio temporário ou permanente pelo firewall, sem aviso e sem reembolso | [oficial] docs e termos |
| Restrições técnicas | Só **GET**. Só são aceitos os headers `x-apisports-key`, `x-rapidapi-key` e `x-rapidapi-host`; headers extras causam erro | [oficial] |

Recomendação: usar um token bucket global de **1 requisição a cada 6 s** (10/min) por chave, ler os quatro headers em toda resposta e chamar `/status` (gratuito) no início de cada job.

---

## 3. Mídia e assets (media.api-sports.io)

| Asset | URL | Origem |
|---|---|---|
| Bandeira de país | `https://media.api-sports.io/flags/{country_code}.svg` (código em minúsculas, ex.: `fr`, `gb-eng`) | [oficial] `/countries` |
| Logo de liga/copa | `https://media.api-sports.io/football/leagues/{league_id}.png` | [oficial] `/leagues` |
| Escudo de time | `https://media.api-sports.io/football/teams/{team_id}.png` | [oficial] `/teams` |
| Imagem de estádio | `https://media.api-sports.io/football/venues/{venue_id}.png` | [oficial] `/venues` |
| Foto de jogador | `https://media.api-sports.io/football/players/{player_id}.png` | [oficial] `/players`, `/players/profiles` |
| Foto de técnico | `https://media.api-sports.io/football/coachs/{coach_id}.png` (grafia "coachs") | [oficial] `/coachs` |
| Logo de casa de apostas | **Não existe.** `/odds/bookmakers` devolve só `id` e `name` | [oficial] spec |

- **Cota:** chamadas a logos e imagens **não contam** na cota diária e são gratuitas, mas **têm limite por segundo e por minuto**. A documentação recomenda guardar as imagens do nosso lado ou usar um CDN. [oficial]
- **Cache:** o tutorial oficial monta um *pull zone* no BunnyCDN com origem `https://media.api-sports.io/` e cache de 3 dias, e sugere valores maiores, já que esse conteúdo muda pouco. [oficial]
- **Armazenamento e direitos:** os termos e a documentação dizem que logos e marcas são fornecidos **só para identificação**, que o fornecedor não detém esses direitos e que o uso pode exigir licença dos titulares (ligas, federações, clubes). Guardar em cache interno é permitido e até recomendado. A exibição pública é responsabilidade nossa. [oficial]
- Sugestão: baixar cada imagem uma vez (fila com ~2–5 imagens/s), guardar em object storage com hash (ETag/`Last-Modified`, se houver) e revalidar mensalmente.

---

## 4. Catálogo completo de endpoints (v3.9.3)

A versão 3.9.3 é a "Current" na documentação e na página de preços (mar/2026). Não achamos registro de 3.9.4 ou 3.10 até out/2026. As novidades da 3.9.3 foram `players/profiles`, `players/teams`, `extra` e `standings` em `fixtures`, `dates` em `fixtures/rounds`, `half` em `fixtures/statistics`, `ids` em `injuries` e `players`/`coachs` (múltiplos) em `trophies` e `sidelined`.
Convenção: **negrito** = obrigatório. "Atualização" e "Recomendado" vêm da documentação oficial e são indicativos.

| Endpoint | Parâmetros | Pag. | Atualização / Recomendado | Rendimento (yield) de 1 chamada | Free 2026 |
|---|---|---|---|---|---|
| `/status` | – | – | – | Conta, plano, uso do dia. **Não conta** | ok |
| `/timezone` | – | – | Estático / quando precisar | Todos os fusos aceitos | ok |
| `/countries` | `name`, `code`, `search` (combináveis) | – | Ao surgir país novo / 1×dia | Todos os países (~170) com `code` e bandeira | ok |
| `/leagues` | `id`, `name`, `country`, `code`, `season`, `team`, `type` (league\|cup), `current`, `search` (≥3), `last` (combináveis) | – | Várias vezes/dia / 1×hora | **Sem parâmetros: todas as ~1.200 competições com `seasons[]` (ano, início, fim, `current`) e `coverage` por temporada**. É o catálogo histórico inteiro | ok (o catálogo lista até 2026, mas listar não dá direito de consultar) |
| `/leagues/seasons` | – | – | Ao adicionar liga / 1×dia | Lista de todos os anos (4 dígitos; 2025/26 = `2025`) | ok |
| `/teams` | **≥1 de**: `id`, `name`, `league`, `season`, `country`, `code`, `venue`, `search` (combináveis) | – | Várias vezes/semana / 1×dia | Times **com o objeto `venue` embutido**. `league+season` = todos os times da competição. **`country=X` = todos os times do país, sem temporada** | sem `season`: ok. `league+season`: só 2022–24 |
| `/teams/statistics` | **`league`, `season`, `team`**, `date` | – | 2×dia / 1×dia se o time jogou, senão 1×semana | Agregado da temporada do time (forma, gols por minuto, cartões, formações, maiores placares, over/under) | só 2022–24 |
| `/teams/seasons` | **`team`** | – | Várias vezes/semana / 1×dia | Todos os anos em que o time tem dados | ok |
| `/teams/countries` | – | – | Várias vezes/semana / 1×dia | Países disponíveis para `/teams` | ok |
| `/venues` | **≥1 de**: `id`, `name`, `city`, `country`, `search` | – | Várias vezes/semana / 1×dia | `country=X` = todos os estádios do país (capacidade, superfície, cidade, imagem) | ok |
| `/standings` | **`season`**, `league`, `team` | – | De hora em hora / 1×hora com jogo em andamento, senão 1×dia | Todas as tabelas da liga-temporada (grupos, turnos), com casa/fora, forma e descrição | só 2022–24. Temporada atual: **calcular localmente** |
| `/fixtures/rounds` | **`league`, `season`**, `current`, `dates`, `timezone` | – | Diário / 1×dia | Lista de rodadas (com `dates=true`, as datas de cada rodada) | só 2022–24 |
| `/fixtures` | `id`, `ids` (≤20, "id-id"), `live` (`all` ou "id-id" de ligas), `date`, `league`, `season`, `team`, `last`, `next`, `from`, `to`, `round`, `status` (múltiplos "FT-AET-PEN"), `venue`, `timezone` (combináveis) | – | A cada 15 s / 1×min com jogo em andamento, senão 1×dia | `league+season`: **temporada inteira numa resposta** (ex.: 380 jogos). `date`: todos os jogos do dia no mundo. `live=all`: todos os jogos ao vivo **com eventos**. `id` ou `ids`: **jogo(s) com eventos, escalações, estatísticas e estatísticas de jogadores embutidos** (até 20 por chamada) | `season` só 2022–24. `date` só ontem→amanhã. `ids`, `last` e `next` **bloqueados**. `id` e `live` ok |
| `/fixtures/headtohead` | **`h2h`** (idA-idB), `date`, `league`, `season`, `last`, `next`, `from`, `to`, `status`, `venue`, `timezone` | – | 15 s / 1×min ao vivo, senão 1×dia | **Todos os confrontos históricos entre dois times** (todas as temporadas) | `last` bloqueado. Sem `last` funciona. Não verificamos se jogos fora de 2022–24 são filtrados |
| `/fixtures/statistics` | **`fixture`**, `team`, `type`, `half` (dados desde 2024) | – | 1 min / 1×min ao vivo, senão 1×dia | 16–18 estatísticas por time (inclui xG em várias ligas) | ok por fixture |
| `/fixtures/events` | **`fixture`**, `team`, `player`, `type` | – | 15 s / 1×min ao vivo | Gols, cartões, substituições, VAR (desde 2020/21) | ok |
| `/fixtures/lineups` | **`fixture`**, `team`, `player`, `type` | – | 15 min / a cada 15 min ao vivo | Formação, técnico, titulares, reservas, grid X:Y, cores. Sai 20–40 min antes do jogo | ok |
| `/fixtures/players` | **`fixture`**, `team` | – | 1 min / 1×min ao vivo | Estatísticas individuais e rating de todos que atuaram | ok |
| `/injuries` | **≥1 de**: `league`, `season` (obrigatório com league/team/player), `fixture`, `team`, `player`, `date`, `ids` (≤20 fixtures), `timezone` | – | 4 h / 1×dia | `league+season`: todos os desfalques da competição. `date`: todos os desfalques do dia no mundo. Dados desde abr/2021 | `season` só 2022–24. `date` na janela. `ids`: não verificado |
| `/predictions` | **`fixture`** | – | 1 h / 1×hora ao vivo, senão 1×dia | Palpite, % por resultado, comparação, últimos jogos e H2H do confronto | ok (inclusive temporada atual) |
| `/coachs` | `id`, `team`, `search` | – | Diário / 1×dia | Técnico(s) com **carreira completa** (`career[]`) | ok |
| `/players/seasons` | `player` | – | Diário / 1×dia | Sem parâmetro: todos os anos com estatísticas. Com `player`: anos daquele jogador | ok |
| `/players/profiles` | `player`, `search` (sobrenome), `page` | **250/pág.** | Várias vezes/semana / 1×semana | Perfil (nome, nascimento, nacionalidade, altura, peso, número, posição, foto). Sem parâmetros, pagina todos os jogadores da base (~640 mil, ou seja, ~2.550 páginas) | `page` ≤ 3 → use `player=` |
| `/players` | `id`, `team`, `league`, `season` (exige id, league ou team), `search` (exige league ou team), `page` | **20/pág.** | Várias vezes/semana / 1×dia | Perfil + estatísticas da temporada por time e competição. `league+season` costuma ter 25–40 páginas | só 2022–24. `page` ≤ 3 → por time (`team+league+season`, ~2–3 pág.) |
| `/players/squads` | **`team`** ou **`player`** | – | Várias vezes/semana / 1×semana | **Elenco atual** do time (id, nome, idade, número, posição, foto) em 1 chamada. Com `player`: times do jogador | ok (sem season) |
| `/players/teams` | **`player`** | – | Várias vezes/semana / 1×semana | **Todos os times e temporadas da carreira** do jogador | ok |
| `/players/topscorers` | **`league`, `season`** | – | Várias vezes/semana / 1×dia | Top 20 artilheiros com estatísticas | só 2022–24 |
| `/players/topassists` | **`league`, `season`** | – | idem | Top 20 em assistências | só 2022–24 |
| `/players/topyellowcards` | **`league`, `season`** | – | idem | Top 20 em amarelos | só 2022–24 |
| `/players/topredcards` | **`league`, `season`** | – | idem | Top 20 em vermelhos | só 2022–24 |
| `/transfers` | `player` ou `team` | – | Várias vezes/semana / 1×dia | `team`: **todo o histórico de transferências do clube** (todos os anos). `player`: histórico do jogador | ok (sem season) |
| `/trophies` | `player`, `players` (≤20), `coach`, `coachs` (≤20) | – | Várias vezes/semana / 1×dia | Títulos da carreira de até 20 pessoas por chamada | ok |
| `/sidelined` | `player`, `players` (≤20), `coach`, `coachs` (≤20) | – | Várias vezes/semana / 1×dia | Histórico de afastamentos de até 20 pessoas por chamada | ok |
| `/odds/live` | `fixture`, `league`, `bet` | – | 5–60 s | Odds ao vivo de todos os jogos em andamento. **Sem histórico** (o jogo sai 5–20 min após o fim) | não verificado |
| `/odds/live/bets` | `id`, `search` | – | 60 s | Tipos de aposta ao vivo | ok (referência) |
| `/odds` | `fixture`, `league`, `season`, `date`, `timezone`, `page`, `bookmaker`, `bet` | **10/pág.** | 3 h / 1× a cada 3 h | Odds pré-jogo de 1 a 14 dias antes. **Histórico de só 7 dias** | muito limitado |
| `/odds/mapping` | `page` | **100/pág.** | Diário / 1×dia | Fixtures que têm odds | `page` ≤ 3 |
| `/odds/bookmakers` | `id`, `search` | – | Várias vezes/semana / 1×dia | Casas de apostas (id, nome; ~30) | ok |
| `/odds/bets` | `id`, `search` | – | Várias vezes/semana / 1×dia | Tipos de aposta pré-jogo | ok |

Notas da documentação:
- `coverage` em `/leagues` mostra o que existe **no momento da chamada**. Antes de a temporada começar, tudo vem `false`. `true` não garante 100% dos dados, e amistosos são exceção.
- Em copas, os jogos de uma fase só entram quando os dois times são conhecidos.
- Ligas sem livescore ficam em `NS` e são atualizadas até 48 h depois.
- IDs de liga, time, jogador, partida e estádio são únicos e estáveis entre temporadas.
- Os status possíveis de uma partida são: TBD, NS, 1H, HT, 2H, ET, BT, P, SUSP, INT, FT, AET, PEN, PST, CANC, ABD, AWD, WO e LIVE.

### 4.1 "Todos os anos com uma requisição": o que explica a afirmação do usuário

| Chamada única | O que traz |
|---|---|
| `GET /leagues` (sem parâmetros) | Todas as competições × todas as temporadas × `coverage` de cada temporada. É o "mapa" histórico completo |
| `GET /fixtures/headtohead?h2h=33-34` | Todos os jogos entre dois clubes, em todos os anos |
| `GET /transfers?team=X` | Todas as transferências do clube na história |
| `GET /coachs?team=X` | Técnicos do clube com a carreira completa de cada um |
| `GET /players/teams?player=X` · `/players/seasons?player=X` | Carreira inteira (times e temporadas) |
| `GET /trophies?players=a-b-…(20)` · `/sidelined?players=…` | Títulos e afastamentos de 20 pessoas, toda a carreira |
| `GET /teams?country=England` · `/venues?country=England` | Todos os times ou estádios de um país, sem recorte de temporada |
| `GET /leagues?team=X` · `/teams/seasons?team=X` | Todas as competições e temporadas de que um time participou |
| `GET /fixtures?league=L&season=S` | Temporada inteira (centenas de jogos) sem paginação |
| `GET /fixtures?ids=…(20)` (pago) | 20 jogos completos: eventos, escalações, estatísticas e jogadores |

Antes de ago/set de 2024 o Free não tinha ressalva de temporadas. A experiência de "baixar todos os anos" provavelmente é dessa época ou veio dos endpoints sem `season` acima [inferência].

---

## 5. Estratégia de bootstrap com máximo rendimento

### 5.0 Princípios

1. **Comece por referência global (≈8 chamadas, uma única vez):** `/timezone`, `/countries`, `/leagues`, `/leagues/seasons`, `/teams/countries`, `/odds/bookmakers`, `/odds/bets` e `/odds/live/bets`. Depois, `/leagues` 1×/dia.
2. **Leia o `coverage`** (em `/leagues`) antes de cada chamada a eventos, escalações, estatísticas, jogadores, injuries ou odds. Não chame o que está `false`.
3. **Prefira as chamadas "largas":** `fixtures?league&season` em vez de rodada a rodada; `teams?league&season` (traz os estádios); `injuries?league&season`; `injuries?date`; `fixtures?date` (todas as ligas do dia).
4. **Detalhe da partida:** no pago, `fixtures?ids=` com 20 jogos por chamada. No Free, `fixtures?id=` (1 por jogo, mas substitui 4 chamadas: events, lineups, statistics e players).
5. **Dados por time ou pessoa sem temporada** (transfers, coachs, squads, trophies, sidelined) são **amortizados**: busque 1 vez por entidade e revalide em rodízio semanal ou mensal.
6. **Pré-valide** temporada (2022–24), data (ontem→amanhã) e parâmetros proibidos (`ids`, `last`, `next`, `page>3`) para não gastar cota com erros.
7. **Rate limit:** no máximo 1 requisição a cada 6 s. Rode o job logo após 00:00 UTC.

### 5.1 (a) Uma liga, uma temporada, completa

Premissas: liga de 20 times, 380 jogos, ~550 jogadores com minutos, temporada acessível (no Free, 2022–2024).

| Passo | Free | Pago |
|---|---|---|
| `teams?league&season` (times + estádios) | 1 | 1 |
| `fixtures?league&season` | 1 | 1 |
| `fixtures/rounds?…&dates=true` (opcional) | 1 | 1 |
| `standings?league&season` | 1 | 1 |
| `injuries?league&season` | 1 | 1 |
| Top scorers, assists, amarelos e vermelhos | 4 | 4 |
| **Detalhe dos jogos** | **380** (`id=`) | **19** (`ids=` ×20) |
| Estatísticas de jogadores | ~50 (20 times × 2–3 pág.) | ~28–40 (`players?league&season`) |
| `teams/statistics` (opcional, quase tudo derivável) | 20 | 20 |
| `coachs?team` + `transfers?team` + `players/squads?team` (por time, amortizado) | 60 | 60 |
| `trophies?players` + `sidelined?players` (550/20 = 28 cada) + técnicos | ~60 | ~60 |
| **Total** | **≈ 580 (≈ 6 dias de Free)**. Só o essencial (listas + detalhe) ≈ 390 | **≈ 200** |

### 5.2 (b) 40 competições, temporada atual

- **No Free é inviável completo** [empírico/inferência]. `season=2025/2026` é recusado, então não há como listar o calendário, as tabelas, os artilheiros nem os jogos já disputados. O possível é **construir daqui para frente**:
  - `fixtures?date=` ontem, hoje e amanhã: **3 chamadas/dia cobrem as 40 competições** (e o mundo todo), filtrando localmente;
  - detalhe: 1 chamada por jogo encerrado das 40 competições (`fixtures?id=`);
  - tabela: **calculada localmente** a partir dos resultados, com a ressalva de que fica incompleta sem o histórico anterior;
  - elencos atuais: `players/squads?team=` (sem season). 40 competições ≈ 700 times únicos ≈ **7 dias** de cota só para isso.
- **Volume de detalhe:** 40 competições geram ~20–60 jogos num dia de semana e ~150–250 num fim de semana. Com ~85 chamadas úteis por dia, a fila de detalhe **não fecha** nos fins de semana. É preciso priorizar competições ou aceitar atraso.
- **Referência no plano pago** (Pro, 7.500/dia):
  - competição × (fixtures + teams + standings + rounds + injuries + 4 tops) = 40 × 9 = **360**;
  - detalhe: ~40 × 300 jogos × ~35% já jogados (fim de outubro) ≈ 4.200 jogos ÷ 20 = **210**;
  - jogadores `players?league&season`: ~40 × 30 páginas = **1.200**;
  - squads, coachs e transfers por time: ~700 × 3 = **2.100**;
  - trophies e sidelined: ~700 times × 28 jogadores ÷ 20 × 2 ≈ **2.000**;
  - **Total ≈ 5.900, menos de 1 dia de Pro.**
- **Histórico acessível no Free (2022–2024) para as 40:** 120 ligas-temporadas × 9 = **1.080 chamadas (~11 dias)**. O detalhe, ≈ 120 × 300 = **36.000 chamadas (~1 ano de Free)**, é proibitivo. Com `ids` num plano pago: 36.000 ÷ 20 = **1.800 chamadas**, menos de 1 dia de Pro. Uma assinatura curta de Pro para o backfill é a opção limpa. Não usar contas múltiplas (ver §6).

### 5.3 (c) Atualização diária incremental (Free, 40 competições)

| Item | Chamadas/dia |
|---|---|
| `fixtures?date=` ontem (resultados finais), hoje, amanhã | 3 |
| `injuries?date=` hoje (+ amanhã) | 1–2 |
| `/leagues` (novas temporadas e `coverage`) | 1 |
| `/status` | 0 (não conta) |
| Detalhe dos jogos encerrados ontem (`fixtures?id=`), por prioridade | ~35–45 |
| Rodízio de entidades (squads, transfers, coachs, trophies/sidelined em lotes de 20) | ~5–10 |
| `predictions?fixture=` (opcional, jogos-chave) | 0–5 |
| **Subtotal sem ao vivo** | **≈ 50–65** |

No plano pago, o mesmo ciclo custa ≈ 3 + ⌈jogos/20⌉ + 40 `standings` + 40 `injuries` ≈ 90–100/dia.

### 5.4 (d) Orçamento de polling ao vivo com 100/dia

- **Uma chamada `fixtures?live=all`** (ou `live=39-61-…` com as 40 ligas) traz **todos** os jogos ao vivo com placar, status, minuto e **eventos**. Escalações e estatísticas ao vivo exigem `fixtures?id=` (1 por jogo), o que não cabe no Free.
- Intervalo = janela ao vivo (min) ÷ chamadas reservadas:
  - 40 chamadas numa janela de 10 h (600 min) → a cada **15 min**;
  - 40 chamadas num pico de 2 h → a cada **3 min**;
  - 50 chamadas, 1 jogo prioritário de 110 min → a cada **~2 min**.
- **Divisão sugerida dos 100/dia:** 6 fixas (datas, injuries, leagues) + 40 detalhe + 45 ao vivo + 9 de reserva.
- O servidor atualiza a cada 15 s, então o Free entrega, na melhor das hipóteses, um "quase ao vivo". Para polling de 15 s numa janela de 8 h são precisas ~1.920 chamadas/dia, o que exige o Pro.

---

## 6. Termos de serviço (cache, armazenamento, redistribuição, contas)

- **Contas múltiplas:** proibidas para aumentar o limite do Free. Os termos dizem: *"It is forbidden to have multiple accounts to increase the limit of the free plan."* As contas são individuais e não podem ser compartilhadas com outros desenvolvedores. No plano pago, o dashboard permite convidar membros e criar **chaves por projeto** dentro da mesma conta (Pro 1, Ultra 2, Mega 3 assentos). [oficial]
- **Cache e armazenamento interno:** não há proibição. A própria documentação recomenda guardar logos e imagens localmente ou num CDN e cachear dados de referência. O tutorial oficial sugere cache de mídia de 3 dias ou mais. [oficial]
- **Redistribuição pela nossa API:** é proibido **revender** os dados ou **vendê-los diretamente** (concorrer com o próprio fornecedor). O uso permitido é construir projetos próprios (apps, sites, jogos de fantasy). Os termos não dão "licença" de publicação: direitos de ligas e federações, e usos em apostas, TV, fantasy e mídia de massa, podem exigir licenças próprias. Uma queixa formal de um titular pode suspender o acesso sem reembolso. Em caso de dúvida, o fornecedor pede contato por e-mail. [oficial, paráfrase]
  → Expor os dados a consumidores **internos** por uma API nossa, sem vender o dado bruto, fica dentro do espírito dos termos. Expor publicamente ou a terceiros pede validação por escrito com o fornecedor [inferência].
- **Imagens:** fornecidas só para identificação. Direitos de terceiros. A responsabilidade pelo uso é do cliente. [oficial]
- **Rate limit:** desrespeitar o limite por minuto é violação grave dos termos (bloqueio por firewall, suspensão ou encerramento). [oficial]
- **Sem garantia:** dados fornecidos "como estão". As frequências de atualização são indicativas. [oficial]
- Os termos são regidos pela lei francesa (última atualização: 21 de maio de 2025).

---

## 7. Webhooks, push e widgets

- **Webhooks ou push: não existem** [oficial, por ausência]. A especificação v3 não tem nenhum mecanismo de callback, stream ou SSE, e a API só aceita GET. O ao vivo é polling de `fixtures?live=` (servidor atualiza a cada 15 s) e `odds/live` (5–60 s).
- **Widgets:** há um produto oficial de widgets v3 (set/2025), com Widget Builder lançado em out/2025.
  - Os widgets são gratuitos em todos os planos, **inclusive o Free**, e usam a sua chave (`data-key`), consumindo a mesma cota.
  - Cobrem jogos do dia, jogo ao vivo com eventos e escalações, tabela, time, jogador, H2H etc.
  - Têm temas, 4 idiomas (EN, FR, ES, IT) e `data-refresh`.
  - A chave fica exposta no cliente. O fornecedor recomenda restringir por domínio e usar cache ou CDN.
  - Não servem ao espelho; são só uma alternativa de UI.

---

## 8. Itens não verificados e próximos testes (com a nossa chave)

1. Se requisições recusadas (`errors.plan`, 429) consomem cota. Medir `requests.current` em `/status` antes e depois.
2. Se `fixtures/headtohead` sem `last` devolve jogos fora de 2022–24 no Free.
3. Se `injuries?ids=`, `odds/live` e `odds?date=` funcionam no Free.
4. Se a janela de datas é ontem→amanhã em UTC ou no `timezone` informado.
5. A data exata em que a janela de temporadas muda (provavelmente no início de 2027, para 2023–2025).
6. Se existe alguma versão posterior à 3.9.3 (a documentação ao vivo está atrás da Cloudflare; a cópia mais recente da spec é de nov/2025).

---

## Fontes

Oficiais (api-football.com / api-sports.io; lidas via Internet Archive por causa da Cloudflare):
- Documentação v3: https://www.api-football.com/documentation-v3 (cópia de 2026-10-12: https://web.archive.org/web/20261012113830/https://www.api-football.com/documentation-v3)
- Especificação OpenAPI v3.9.3 que alimenta a documentação: https://www.api-football.com/public/doc/openapi.yaml (cópia de 2025-11-02: https://web.archive.org/web/20251102131202/https://www.api-football.com/public/doc/openapi.yaml)
- Documentação espelho: https://api-sports.io/documentation/football/v3
- Preços: https://www.api-football.com/pricing (cópias de 2026-03-14 https://web.archive.org/web/20260314113151/https://www.api-football.com/pricing, 2024-09-08 https://web.archive.org/web/20240908120659/https://www.api-football.com/pricing e 2024-08-11 https://web.archive.org/web/20240811173549/https://www.api-football.com/pricing)
- Página da API, com limites por minuto e reset 00:00 UTC: https://api-sports.io/sports/football (cópia de 2026-03-11: https://web.archive.org/web/20260311005547/https://api-sports.io/sports/football)
- Termos: https://www.api-football.com/terms (cópia de 2026-02-01: https://web.archive.org/web/20260201222612/https://www.api-football.com/terms) e https://api-sports.io/terms (cópia de 2026-04-15)
- Guia oficial para iniciantes: https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide (cópia de 2026-04-10)
- Tutorial "How to get all fixtures data from one league" (`ids`, 20 por chamada): https://www.api-football.com/news/post/how-to-get-all-fixtures-data-from-one-league
- Tutorial "How to get all teams and players from a league id": https://www.api-football.com/tutorials/4/how-to-get-all-teams-and-players-from-a-league-id
- Release 3.9.2: https://www.api-football.com/news/post/api-football-new-release
- Guia BunnyCDN de mídia: https://www.api-football.com/news/post/optimizing-sports-websites-bunnycdn-api-sports-image-storage-guide
- Widgets: https://www.api-football.com/widgets · https://www.api-football.com/news/post/discover-our-new-widgets · https://www.api-football.com/news/post/introducing-the-api-sports-widget-builder

Evidência empírica (mensagens literais da API registradas por terceiros, 2025–2026):
- Temporadas 2022–2024, `ids`, `last` e janela de datas: https://github.com/mkirtay/ofsayt-yok (`src/services/apiFootball/__fixtures__/freePlanErrors.json`, `docs/API_FOOTBALL_MIGRATION.md`)
- `next`, `last`, temporada e data (2026-09-18): https://github.com/AhmetDemirci34/formax-backend (`Formax.Infrastructure/Http/ApiFootballPlanState.cs`)
- `page` ≤ 3 (2026-10-19): https://github.com/delta96040/dugout (`packages/pipeline/src/dugout_pipeline/adapters/api_football_stats.py`, `docs/sources.md`)
- 10 req/min e limite diário (2026-10-13): https://github.com/NelsonFodjo/sideline (`docs/FRICTION_LOG.md`)
- 10/min via `/status`, `predictions` na temporada atual: https://github.com/Juarpla/goatlab-scor-win (`API-RESEARCH.md`)
- Catálogo `/leagues` lista 2026 mas `standings` 2026 é recusado: https://github.com/tobibytes/pl-analytics (`docs/data-sources.md`)
- "try from 2021 to 2023" (mar/2025): https://github.com/yorobot/sport.db.more (`api-football/sandbox/quickstart.rb`)
- Janela ontem→amanhã: https://github.com/Bekkenes/omarchy-football-tracker (`bin/poll.sh`)
- Rejeição desperdiça cota (relato): https://github.com/slavik03-png/-ai-stavki (`.agents/memory/api-football-free-plan-limits.md`)
- Free sem odds (PR de 2026-10-07): https://github.com/Andrew2014812/PredictionSystem/pull/4
