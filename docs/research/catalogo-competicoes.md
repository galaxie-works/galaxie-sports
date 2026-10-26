> **Validado com a API real em 21/10/2026:** os 76 IDs existem no `/leagues`; nome, país e tipo conferem após dois ajustes (id 268 do Uruguai agora se chama "Primera División"; id 15, Mundial de Clubes, é tipado como `Cup`). As 69 competições do tier 2 acrescentadas em 22/10/2026 (#166) foram conferidas no `/leagues` do raw local. A conferência roda a cada execução de `bootstrap:catalog`.

# Catálogo de competições de futebol (API-FOOTBALL v3)

Arquivo de configuração: [`config/competitions/football.yaml`](../../config/competitions/football.yaml)
Data da pesquisa: 2026-10-21

## O que é

É a lista das competições de futebol que o mirror do api-sports.io precisa espelhar. Cada uma traz o `league id` da API-FOOTBALL v3, o nome/país/tipo como a API devolve, a prioridade (tier), a região, como a API rotula as temporadas, a prioridade de ao vivo e os rótulos em pt-BR/es/en.

- **145 competições** no total: 46 no tier 1 e 99 no tier 2 (as 30 da pesquisa original e as 69 acrescentadas em 22/10/2026).
- **Tier 1**: cobertura ao vivo com IA e histórico completo.
- **Tier 2**: espelhadas com tratamento ao vivo mais leve. O histórico pode ser limitado às últimas N temporadas.
- **Todos os 145 ids foram verificados** (`verify: false`): os 76 da pesquisa original pelo método abaixo e os 69 de 22/10 pelo `GET /leagues` do raw local. Nenhum ficou com `api_sports_id: null`.

## Como a lista foi montada

1. **Escopo.** O ponto de partida foi a lista de tiers definida pelo produto: Brasil, CONMEBOL, as principais ligas sul-americanas e o México, as cinco grandes ligas europeias, as copas da UEFA e os torneios de seleções.
2. **Fontes de id.** As páginas de documentação e o dashboard da api-football.com bloqueiam acesso automatizado (HTTP 403). Por isso os ids vieram de dumps públicos das respostas da própria API (`GET /leagues` e `GET /fixtures`) versionados no GitHub:
   - `ductd26100/avatar-remake`: `League.java`, com cerca de 1.200 ligas. Repositório atualizado em 2026.
   - `zkoprek/diplomski-server`: `Leagues_data`, o JSON de `/leagues` com nome, país e tipo.
   - `davidhuertabeltran/football-scores`: `league-list-clean.js`.
   - `jonas556440/scout-dados-cartola`: fixtures de fevereiro de 2026. Confirmam os ids atuais dos estaduais e do Brasileirão.
3. **Validação cruzada.** Um id só foi aceito quando pelo menos duas fontes independentes concordavam no id, no nome e no país. Os campos `name`, `country` e `type` do YAML foram comparados automaticamente com o dump de `/leagues` e não há divergências.
4. **Checagem visual.** Os 76 logos da pesquisa original `https://media.api-sports.io/football/leagues/<id>.png` foram baixados e conferidos. Só o **475 (Paulista - A1)** diverge: o logo é o escudo do Paulista FC de Jundiaí, não a marca do campeonato. O id está confirmado pelas fontes em texto e pelos jogos de 2026, mas não use esse logo no produto.

## Como verificar os ids no bootstrap

1. **Ids conhecidos** (`verify: false`): chame `GET /leagues?id=<id>` e confira `league.name`, `country.name` e `league.type`. Se o nome for diferente do catálogo (por rebranding ou patrocínio), **registre um aviso e siga em frente**. O id é a chave estável.
2. **Ids pendentes** (`verify: true`, `api_sports_id: null`; nenhum hoje): chame `GET /leagues?country=<country>` e procure a liga com o mesmo `name`, `country` e `type`. Se houver exatamente um resultado, grave o id no YAML. Se houver zero ou mais de um, falhe e peça revisão manual.
3. **Cobertura por temporada:** antes de ligar recursos ao vivo com IA, leia `seasons[].coverage` em `GET /leagues?id=<id>&season=<ano>` (fixtures.events, lineups, statistics, players, odds). Isso pesa sobretudo nos estaduais.
4. **Formato de temporada:** use `seasons_strategy`.
   - `calendar-year`: a temporada 2026 é o ano de 2026.
   - `split-year`: a temporada 2026 corresponde a 2026/27, como nas ligas europeias, na Liga MX e na Saudi Pro League.
   - Nos torneios de seleções, o rótulo é o ano da edição. Por exemplo, as Eliminatórias CONMEBOL da temporada 2026 têm jogos de 2023 a 2025.
5. **Fases (Apertura/Clausura):** valide os nomes de rodada com `GET /fixtures/rounds?league=<id>&season=<ano>`. Veja a seção de ressalvas.

## Ressalvas principais

O texto completo está na seção `notes:` do YAML.

- **Argentina:** de 2020 a 2024 havia a Liga Profesional (128) e a Copa de la Liga (1032). A partir de 2025 o torneio passou a ser Apertura + Clausura, e os dois devem estar no id 128. O 1032 fica só como histórico. Confirme no bootstrap.
- **Apertura/Clausura:** Uruguai (268/270) e Paraguai (250/252) têm um id para cada torneio. Liga MX, Colômbia, Peru, Equador e Chile usam um único id por temporada, e a fase aparece no nome da rodada ou do grupo da tabela.
- **Nomes que podem ter mudado na API:** 848 (Conference League), 16 (CONCACAF Champions Cup) e 281 (Peru, "Liga 1").
- **Liga das Nações da CONCACAF (536)** foi incluída porque o escopo dizia só "Nations League". Remova se a intenção era apenas a da UEFA.
- **Amistosos (10 e 667)** têm volume muito alto. Espelhe com filtro de times de interesse, sem backfill completo.

## Competições do tier 1

| Competição | id | Nome na API | País (API) | Tipo | Temporada | Ao vivo |
|---|---|---|---|---|---|---|
| Brasileirão Série A | 71 | Serie A | Brazil | league | calendar-year | high |
| Copa do Brasil | 73 | Copa Do Brasil | Brazil | cup | calendar-year | high |
| Copa Libertadores | 13 | CONMEBOL Libertadores | World | cup | calendar-year | high |
| Copa Sul-Americana | 11 | CONMEBOL Sudamericana | World | cup | calendar-year | high |
| Recopa Sul-Americana | 541 | CONMEBOL Recopa | World | cup | calendar-year | high |
| Paulistão A1 | 475 | Paulista - A1 | Brazil | league | calendar-year | high |
| Campeonato Carioca | 624 | Carioca - 1 | Brazil | league | calendar-year | high |
| Campeonato Mineiro | 629 | Mineiro - 1 | Brazil | league | calendar-year | high |
| Campeonato Gaúcho | 477 | Gaúcho - 1 | Brazil | league | calendar-year | high |
| Campeonato Paranaense | 606 | Paranaense - 1 | Brazil | league | calendar-year | medium |
| Campeonato Baiano | 602 | Baiano - 1 | Brazil | league | calendar-year | medium |
| Campeonato Pernambucano | 622 | Pernambucano - 1 | Brazil | league | calendar-year | medium |
| Campeonato Cearense | 609 | Cearense - 1 | Brazil | league | calendar-year | medium |
| Campeonato Goiano | 628 | Goiano - 1 | Brazil | league | calendar-year | medium |
| Campeonato Catarinense | 604 | Catarinense - 1 | Brazil | league | calendar-year | medium |
| Liga Profesional (Argentina) | 128 | Liga Profesional Argentina | Argentina | league | calendar-year | high |
| Copa de la Liga (Argentina, histórico) | 1032 | Copa de la Liga Profesional | Argentina | league | calendar-year | low |
| Copa Argentina | 130 | Copa Argentina | Argentina | cup | calendar-year | high |
| Campeonato Chileno | 265 | Primera División | Chile | league | calendar-year | high |
| Campeonato Uruguaio - Apertura | 268 | Primera División - Apertura | Uruguay | league | calendar-year | high |
| Campeonato Uruguaio - Clausura | 270 | Primera División - Clausura | Uruguay | league | calendar-year | high |
| Campeonato Colombiano | 239 | Primera A | Colombia | league | calendar-year | high |
| Campeonato Peruano (Liga 1) | 281 | Primera División | Peru | league | calendar-year | high |
| LigaPro Série A (Equador) | 242 | Liga Pro | Ecuador | league | calendar-year | high |
| Campeonato Paraguaio - Apertura | 250 | Division Profesional - Apertura | Paraguay | league | calendar-year | high |
| Campeonato Paraguaio - Clausura | 252 | Division Profesional - Clausura | Paraguay | league | calendar-year | high |
| Liga MX | 262 | Liga MX | Mexico | league | split-year | high |
| Premier League | 39 | Premier League | England | league | split-year | high |
| LaLiga | 140 | La Liga | Spain | league | split-year | high |
| Serie A (Itália) | 135 | Serie A | Italy | league | split-year | high |
| Bundesliga | 78 | Bundesliga | Germany | league | split-year | high |
| Ligue 1 | 61 | Ligue 1 | France | league | split-year | high |
| Liga dos Campeões da UEFA | 2 | UEFA Champions League | World | cup | split-year | high |
| Liga Europa da UEFA | 3 | UEFA Europa League | World | cup | split-year | high |
| Liga Conferência da UEFA | 848 | UEFA Europa Conference League | World | cup | split-year | high |
| Copa do Mundo FIFA | 1 | World Cup | World | cup | calendar-year | high |
| Mundial de Clubes da FIFA | 15 | FIFA Club World Cup | World | league | calendar-year | high |
| Eliminatórias CONMEBOL | 34 | World Cup - Qualification South America | World | cup | calendar-year | high |
| Eliminatórias CONCACAF | 31 | World Cup - Qualification CONCACAF | World | cup | calendar-year | high |
| Eliminatórias UEFA | 32 | World Cup - Qualification Europe | World | cup | calendar-year | high |
| Copa América | 9 | Copa America | World | cup | calendar-year | high |
| Eurocopa | 4 | Euro Championship | World | cup | calendar-year | high |
| Liga das Nações da UEFA | 5 | UEFA Nations League | World | cup | split-year | high |
| Liga das Nações da CONCACAF | 536 | CONCACAF Nations League | World | cup | split-year | medium |
| Futebol Olímpico Masculino | 480 | Olympics Men | World | cup | calendar-year | high |
| Futebol Olímpico Feminino | 524 | Olympics Women | World | cup | calendar-year | high |

As 30 competições do tier 2 (Séries B/C/D, Copa do Nordeste, Supercopa, Brasileirão Feminino, Bolívia, Venezuela, Liga MX Femenil, Primera Nacional, Portugal, Eredivisie, Championship, copas nacionais europeias, MLS, Saudi Pro League, CONCACAF Champions Cup, Leagues Cup, Copa do Mundo Feminina, Copa América Feminina, Pan-Americano, amistosos, Mundiais Sub-20/Sub-17 e Sul-Americano Sub-20) e as 69 acrescentadas em 22/10/2026 (segundas divisões, copas nacionais e da liga, supercopas e femininos principais da CONMEBOL, do México, de Inglaterra, Espanha, Itália, Alemanha, França e Portugal, os 16 estaduais que faltavam, o Paulista A2 e as copas Verde, Norte, Sul-Sudeste e Centro-Oeste) estão no YAML. As 69 ficam com `live_priority: low`: entram pelo sync diário, não pelo ao vivo.
