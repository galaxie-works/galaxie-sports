# Fórmula 1 — enriquecimento com o jolpica-f1 e outras fontes abertas

> **Resumo**
> 1. **Licença:** o **F1DB é seguro** (CC BY 4.0: uso comercial com atribuição). O **jolpica** e o **OpenF1** são CC BY-NC-SA 4.0: só com licença escrita. **Timing oficial** (FastF1, live timing, raspagem do formula1.com, API do Fantasy) é **proibido** sem acordo com a Formula One. Os termos do formula1.com restringem o conteúdo a uso pessoal e não comercial, e o grupo detém o direito exclusivo de comercializar o campeonato.
> 2. **Ganho principal:** histórico completo de 1950 até hoje (77 temporadas, ~1.170 GPs, incluindo treinos, grid, pit stops e campeonatos) e a **temporada atual inteira**, que o plano free da api-sports não libera. Volta a volta só existe no jolpica (1996+, depois da licença) ou na Sportradar (paga, ao vivo).
> 3. **Combinação sem duplicar (§6.4):** o F1DB cuida do histórico e do resultado oficial pós-corrida. A api-sports continua com o ao vivo e as imagens. O jolpica entra com volta a volta depois da licença. O `f1-circuits` (MIT) traz o traçado dos circuitos.
> 4. **Primeiro passo:** provider `f1db`, que carrega o release (zip de ~6 MB, sem rate limit) e leva a base de 182 para ~2.500 eventos sem mudar o contrato da API. No mesmo dia, mandar o e-mail de licença ao jolpica (rascunho na §2.4).
> 5. **Fora de cogitação:** FastF1/OpenF1/live timing, os datasets derivados do formula1.com ou do Ergast (Kaggle, HuggingFace, formula1-datasets), o f1api.dev e o scraper da Apify (§6.2).

Pesquisa feita em 2026-10-23. Fontes: repositório [jolpica/jolpica-f1](https://github.com/jolpica/jolpica-f1) (README, `TERMS.md`, `docs/`, discussões e issues), o OpenAPI publicado em `https://api.jolpi.ca/docs/schema/` (versão `20261021203116-1a1a058`), 24 chamadas reais à API (§5) e a lista [subinium/awesome-f1](https://github.com/subinium/awesome-f1) (§6).

---

## 1. O que o jolpica oferece

O jolpica-f1 é o sucessor aberto do Ergast: o código é Python/Django, mantido por voluntários, e a hospedagem custa cerca de US$ 45 por mês, paga com doações no Ko-fi. Há duas superfícies de acesso.

### 1.1 API compatível com Ergast (`https://api.jolpi.ca/ergast/f1/`)

É estável e só devolve JSON (não há XML). O envelope é sempre `MRData` com `limit`/`offset`/`total`. O `limit` padrão é 30 e o máximo é 100.

| Endpoint | Rota | Cobertura |
|---|---|---|
| Temporadas | `/seasons/` | 1950–2026 (77) |
| Corridas / calendário | `/{ano}/races/` ou `/{ano}.json` | 1.172 GPs (inclui o calendário futuro de 2026). Horário de TL1–3, classificação, sprint e classificação da sprint nas temporadas recentes; faltam horários em temporadas antigas ([#217](https://github.com/jolpica/jolpica-f1/issues/217)) |
| Resultados | `/{ano}/{rodada}/results/` | 26.247 linhas, 1950–2026: posição, `positionText`, pontos, grid, voltas, status, tempo (`millis`) e volta mais rápida |
| Classificação (treino) | `/{ano}/{rodada}/qualifying/` | Q1/Q2/Q3 por piloto; cobertura parcial nas temporadas antigas (doc do Ergast) |
| Sprint | `/{ano}/{rodada}/sprint/` | 2021 em diante |
| Voltas | `/{ano}/{rodada}/laps/` | **1996 em diante**: tempo e posição de cada piloto em cada volta. Só a corrida (sprint ainda não, [#354](https://github.com/jolpica/jolpica-f1/discussions/354)) |
| Pit stops | `/{ano}/{rodada}/pitstops/` | **2011 em diante**: volta, número da parada, hora local e duração |
| Campeonato de pilotos | `/{ano}/driverstandings/` e `/{ano}/{rodada}/driverstandings/` | Todas as temporadas, **rodada a rodada**, com os descartes da época (ex.: 1988) |
| Campeonato de construtores | `/{ano}/constructorstandings/` | 1958 em diante (o título começou em 1958) |
| Pilotos | `/drivers/` | 881, com `driverId` (slug), número fixo, código de 3 letras (só nos recentes), nascimento, nacionalidade e Wikipedia |
| Construtores | `/constructors/` | 214 |
| Circuitos | `/circuits/` | 78, com latitude/longitude, cidade, país e Wikipedia |
| Status de chegada | `/status/` | 136 valores (Finished, +1 Lap, Engine, Gearbox, Accident…). **De 2025 em diante** só um conjunto reduzido: todo abandono vira `Retired` ([diferenças](https://github.com/jolpica/jolpica-f1/blob/main/docs/ergast_differences.md)) |

Os filtros se combinam na rota (`/drivers/senna/results/`, `/circuits/interlagos/results/1/`), e isso facilita as consultas de carreira e de histórico de circuito.

### 1.2 API nova (`/f1/alpha/…`) e dumps

- **Alpha:** `schedules/{ano}`, `core/{seasons,rounds,sessions,session-entries,drivers,teams,circuits,laps,pit-stops}`, `results/{round_id}/{sessão}` e `laps/{round_id}/{sessão}`. Traz o que o Ergast não tem: **resultados de TL1–3 e da classificação da sprint**, fuso e horário local de cada sessão, código de país ISO-3, voltas previstas e IDs opacos estáveis (`driver_cAPSXDn9`). Como é alpha, **pode mudar sem aviso**. Usuários reclamam que é preciso descobrir o `round_id` antes de consultar ([#319](https://github.com/jolpica/jolpica-f1/discussions/319)).
- **Dumps do banco inteiro** em CSV e SQL (Postgres), com cerca de 14,6 MB cada, em `https://api.jolpi.ca/data/dumps/download/`. O dump gratuito sai com **14 dias de atraso** e é não comercial. O dump "Supporter" é atual, tem chave de API e é **licenciado para uso comercial**, mas o acesso ainda não foi detalhado ([database_dumps.md](https://github.com/jolpica/jolpica-f1/blob/main/docs/database_dumps.md)).

### 1.3 Atualização durante a temporada

- **Não há ao vivo.** O dado entra depois da sessão.
- **Latência do resultado:** algumas horas depois da bandeirada, no mesmo dia. Exemplo da [#228](https://github.com/jolpica/jolpica-f1/issues/228): em Ímola 2025, uns 2 h depois da corrida o resultado ainda não estava lá, e no fim do dia estava. A borda (Cloudflare) devolve `Cache-Control: max-age=600`, então conte também até 10 min de cache.
- **Voltas podem atrasar semanas** quando a ingestão falha. Em Austrália 2026, as posições por volta só chegaram em 02/04 ([#331](https://github.com/jolpica/jolpica-f1/issues/331), [#345](https://github.com/jolpica/jolpica-f1/issues/345)).
- Já aconteceu de o campeonato ser publicado antes do resultado, com `round` adiantado ([#228](https://github.com/jolpica/jolpica-f1/issues/228), corrigido). Por isso a ingestão deve reconferir o dado algumas vezes depois da corrida.

### 1.4 Limites de uso

| Item | Valor |
|---|---|
| Rajada | **4 req/s** por IP |
| Sustentado | **500 req/h** por IP ("will decrease in the future", [rate_limits.md](https://github.com/jolpica/jolpica-f1/blob/main/docs/rate_limits.md)) |
| Acima do limite | `HTTP 429` |
| Token com limite maior | "em implementação" |
| Página | máximo de 100 linhas |
| User-Agent | **Obrigatório e próprio** (ex.: `GalaxieSports-Ingestor/1.0`). Desde 21/08/2026, user agents padrão (`node`, `python-requests`, vazio) podem ser bloqueados ([#386](https://github.com/jolpica/jolpica-f1/discussions/386)) |

### 1.5 Disponibilidade / SLA

**Não há SLA.** Os termos dizem "we do not guarantee uptime, availability, or correctness", e o bloqueio pode vir sem aviso em caso de abuso. Houve quedas registradas (porta 443 recusando conexão em 29/03/2026, [#352](https://github.com/jolpica/jolpica-f1/discussions/352)). A carga também aumenta nos fins de semana de GP. Conclusão: o jolpica **nunca pode estar no caminho síncrono** da nossa API. Só o ingestor fala com ele, e servimos tudo do nosso banco.

---

## 2. Licença e termos (decide tudo)

### 2.1 O que está escrito

| Objeto | Licença | Fonte |
|---|---|---|
| Código | Apache-2.0 (podemos usar e até hospedar o software) | `LICENSE` |
| **Dados (API e dump gratuito)** | **CC BY-NC-SA 4.0**: atribuição, **não comercial**, **compartilha igual** | [`TERMS.md`](https://github.com/jolpica/jolpica-f1/blob/main/TERMS.md), §1 |
| Uso comercial | "For commercial usage, please contact us via admin@jolpi.ca" | `TERMS.md`, §1 |
| Dump "Supporter" | "Data licensed for commercial use" (preço e acesso a definir) | [discussão #261](https://github.com/jolpica/jolpica-f1/discussions/261) |
| Mudança de termos | "We reserve the right to change these terms" | `TERMS.md`, §1 |

### 2.2 O que isso significa para a Galaxie

- A Galaxie é uma **API B2B paga** para operadoras de TV e streaming, o que é uso comercial sem margem de dúvida. **Sem uma licença escrita, não podemos usar dado do jolpica em produção** (nem na demo mostrada a clientes).
- O "compartilha igual" (SA) também atrapalha: mesmo num uso tolerado, a base derivada teria que sair sob CC BY-NC-SA, e isso não combina com contrato B2B. **A licença comercial precisa dispensar o SA.**
- Sinal positivo: numa consulta pública, o mantenedor disse que tenta ser razoável e que aceita anúncio para cobrir hospedagem como não comercial. Disse também que **nunca libera uso ligado a apostas** ([#383](https://github.com/jolpica/jolpica-f1/discussions/383)). Se algum cliente nosso for de apostas, isso precisa ficar explícito na negociação.
- Risco de proveniência: parte da base vem do Ergast, e as voltas recentes vêm do timing da categoria (o mantenedor do FastF1 participa do projeto). Os direitos sobre o dado de timing e as marcas "F1"/"Formula 1" são da Formula One Group. **O risco de marca já existe hoje com a api-sports**, mas vale pedir ao jolpica uma declaração do que eles podem sublicenciar.

### 2.3 O que confirmar e com quem

**Com quem:** os mantenedores do jolpica-f1, por **admin@jolpi.ca** (o canal indicado nos termos). Depois, o jurídico da Galaxie revisa o texto antes de assinar.

**O que pedir por escrito:**
1. Licença para **redistribuir dado derivado, mediante pagamento, por API B2B** a operadoras de TV e streaming da América Latina (inclui exibição na tela dos clientes e enriquecimento por IA).
2. **Dispensa do ShareAlike** para a nossa base derivada.
3. A forma de atribuição exigida (texto e onde ela aparece: na API, na documentação, na tela do cliente?).
4. Preço e modelo: o nível Supporter, uma doação fixa ou um contrato.
5. Acesso ao **dump atual** (sem os 14 dias) e a um **token com limite maior**.
6. Restrições, sobretudo apostas, e como tratar um cliente que tenha produto de apostas.
7. Aviso prévio e prazo de saída se os termos mudarem, e o direito de manter o dado já carregado.
8. Declaração de proveniência: de quais partes da base eles têm direito de conceder licença (resultados históricos, voltas, pit stops).

### 2.4 Rascunho do e-mail (em inglês, sem dados de clientes)

> Subject: Commercial licence request — Jolpica F1 data in a B2B sports data API
>
> Hi Jolpica team,
> We run Galaxie Sports, a paid B2B sports data API for broadcasters and streaming platforms in Latin America. We'd like to use Jolpica F1 data (historical results, standings, laps, pit stops) as a secondary source behind our own database, with clear attribution and a local cache (no live traffic forwarded to your API).
> Could you tell us: (1) whether a commercial licence is available for this use and its cost; (2) whether it can waive the ShareAlike clause for our derived database; (3) the attribution you require; (4) access to the latest dumps and a higher-rate token; (5) any restrictions (e.g. betting); (6) which parts of the dataset you're able to license.
> Happy to support the project financially. Thanks for keeping the Ergast lineage alive.

### 2.5 Se a resposta for não (ou não vier)

Perdemos só o volta a volta. O histórico, a temporada atual e os pit stops vêm do **F1DB** (CC BY 4.0, §6.1), que passa a ser a fonte principal da fase 1 de qualquer forma. Para o volta a volta, a alternativa comercial é a Sportradar (§6.1).

---

## 3. Comparação com o que já temos

Hoje a F1 vem da api-formula-1 (api-sports, plano free) e entrou no PR [galaxie-works/galaxie-sports#180](https://github.com/galaxie-works/galaxie-sports/pull/180):

- `normalizeF1Races`: cada sessão de `races?season` vira um evento e o GP vira `core.stage` (`race_weekend`) da competição sintética `world-championship`.
- `rankings/races` e `rankings/startinggrid` viram participantes do lado `grid`, com `position` e `result` (`time`, `gap`, `laps`, `grid`, `pits`, `team`).
- `rankings/drivers` e `rankings/teams` viram `core.standing`.
- Construtores são `participant(kind=constructor)`, pilotos são `participant(kind=driver, id driver-<id>)` e circuitos são `venue`.
- Na API, `apps/api/src/events/race.ts` monta `Event.session` (tipo, número, voltas, distância, volta mais rápida).
- A base tem **182 eventos**, todos sessões de 2024.

| Dado | api-sports (free, hoje) | jolpica | Resultado |
|---|---|---|---|
| Temporadas | 2022–2024 (só 2024 carregada) | **1950–2026** | **Ganho enorme** |
| Temporada atual | Só a janela D−1..D+1 por data | **Calendário e resultados completos** | **Ganho** |
| Ao vivo | `status: Live` e `laps.current` | Não tem | **api-sports continua** |
| Treinos livres | Resultado de TL1–3 | Só na alpha (instável) | api-sports melhor |
| Classificação | Q1/Q2/Q3 como sessões separadas | Q1/Q2/Q3 numa linha por piloto | Equivalente |
| Sprint e classificação da sprint | Sim | Sprint sim (2021+); classificação da sprint só na alpha | Equivalente/pior |
| Grid de largada | `startinggrid` | `grid` no resultado | Igual |
| Volta mais rápida | `fastestlaps` | `FastestLap` no resultado (rank, volta, tempo) | Igual |
| **Volta a volta** (tempo e posição) | Não tem | **1996+** | **Ganho** (gráfico de posição) |
| Pit stops | `/pitstops` (não ingerimos) | **2011+** com duração | Ganho (sem gastar cota) |
| Campeonato rodada a rodada | Só o atual da temporada | **Todas as rodadas, 1950+** | **Ganho** |
| Status de chegada | Pouco detalhado | 136 motivos até 2024; de 2025 em diante só `Retired` | Ganho no histórico |
| Perfil do piloto | `/drivers?id` (1 chamada por piloto, com foto) | Nascimento, nacionalidade, número e código de todos os 881, sem foto | Complementar |
| Circuito | Imagem, extensão, capacidade e recorde | Lat/long, cidade, Wikipedia | Complementar |
| Imagens | Pilotos, equipes e circuitos | Nenhuma | **api-sports continua** |
| Cota | 100 req/dia | 500 req/h | Muito mais folga |
| Licença | Assinatura comercial da api-sports | **NC até negociar** | **Bloqueio** |

---

## 4. Proposta de integração

### 4.1 Segunda fonte sem conflito

- **Novo provider `jolpica`** em `packages/providers/src/jolpica/`, no mesmo formato da api-sports: cliente HTTP, `raw` e `normalize` gerando `NormalizedBatch`. Grava em `core.provider_map` com `provider='jolpica'` e `sport='formula-1'`.
- O cliente usa um User-Agent próprio (sem e-mail nem dado de usuário), um token bucket de 3 req/s e 450 req/h (folga abaixo do limite), backoff em `429`, e reaproveita o raw das temporadas encerradas para sempre, como já fazemos na F1.

**Casamento de IDs** (feito uma vez por entidade e gravado no `provider_map`; tudo o que não casar vai para revisão no painel):

| Entidade | Chave jolpica | Como casar com a api-sports |
|---|---|---|
| Corrida (evento `race`) | `(season, round)` | Mesma temporada, **mesma data da corrida** e mesmo circuito. Sprint e classificação casam pelo GP (`stage`) e pelo tipo de sessão |
| Piloto | `driverId` (slug, ex. `max_verstappen`) | 1) **Determinístico**: nas corridas de 2022–2024 que as duas fontes têm, o piloto na mesma posição final é o mesmo. 2) Plano B: código de 3 letras + nome normalizado + nascimento. Os ~800 pilotos anteriores a 2022 só existem no jolpica e viram participantes novos |
| Construtor | `constructorId` (ex. `red_bull`, `rb`, `sauber`) | Pelo par corrida+piloto já casado (a equipe do piloto naquela corrida). Mudança de nome entra em `name-history` |
| Circuito | `circuitId` (ex. `interlagos`) | Tabela de-para manual de ~36 linhas (os circuitos de 2012 em diante), em `config/`. Os outros 42 viram `venue` novos |
| Temporada e competição | ano | Mesma competição sintética `world-championship` |

**Precedência por campo.** Hoje a precedência é por estado do evento: `DEFAULT_PRECEDENCE.order = ['api-sports']` em `packages/providers/src/precedence.ts`. A proposta acrescenta `jolpica` atrás da api-sports e define o dono de cada campo:

| Campo | Dono | Por quê |
|---|---|---|
| Status, relógio e ao vivo | api-sports | O jolpica não tem ao vivo |
| Calendário e horário das sessões | api-sports quando houver; jolpica preenche o resto (temporada atual fora da janela, histórico) | Cobertura |
| Resultado final (posição, tempo, grid, status) | api-sports em 2022–2024; **jolpica no resto** | Não reescrever o que já está em produção. Um job de conferência registra as divergências |
| Pontos e campeonato | jolpica (inclui rodada a rodada e descartes históricos) | É a única fonte completa |
| Voltas e pit stops | jolpica | Só ele tem (pit stops da api-sports custariam cota) |
| Fotos, logos e imagem do circuito | api-sports (Asset Mirror) | O jolpica não tem |
| Nascimento e nacionalidade do piloto, lat/long do circuito | jolpica | Tem para todos, sem custo de cota |

Na prática, o `upsert-core` ganha um mapa `campo → ordem de provedores` só para a F1. O resto do motor continua igual.

### 4.2 Dado novo no core e na API

| Core (Drizzle) | Linhas estimadas | API |
|---|---|---|
| Eventos `race`/`qualifying`/`sprint` de 1950–2026 nos modelos que já existem (`event`, `event_participant.result`, `stage`, `standing`) | ~2.500 eventos (1.172 corridas + classificações + sprints), ~45 mil participações | Endpoints atuais (`/v1/events`, competições e temporadas) sem mudar o contrato |
| `core.standing` **por rodada** (coluna `stage_id` ou tabela `standing_round`) | ~1.150 rodadas × ~25 ≈ 30 mil | `GET /v1/competitions/{id}/seasons/{ano}/standings?round=` |
| `core.race_lap (event_id, participant_id, lap, position, time_ms)` | ~650 mil (1996–2026) | `GET /v1/events/{id}/laps` (`?participant=`, série por piloto pronta para gráfico) |
| `core.race_pit_stop (event_id, participant_id, stop, lap, local_time, duration_ms)` | ~15 mil (2011–2026) | `GET /v1/events/{id}/pit-stops` |
| View materializada `driver_career`: GPs, vitórias, poles, pódios, voltas mais rápidas, pontos, títulos, estreia, última corrida e equipes por ano | 881 | `GET /v1/participants/{id}/career` |
| View `venue_history`: vencedores por ano, maior vencedor, % pole→vitória, abandonos, recorde de volta em corrida (1996+) | 78 | `GET /v1/venues/{id}/history` |
| Recordes (mais vitórias, mais jovem vencedor, maior escalada do grid à vitória…) | consultas | `GET /v1/competitions/{id}/records` e contexto para a IA |

Também alimenta o **enriquecimento de IA**: o resumo de uma corrida pode citar "venceu largando de 17º, maior escalada em Interlagos desde…", com o fato calculado pela nossa base e não inventado pelo modelo.

### 4.3 Volume para carregar o histórico (API Ergast)

> Com a combinação da §6.4, a fase 1 sai de **um download do release do F1DB** (~6 MB zipado), sem chamadas. As contas abaixo valem para o jolpica e, na prática, só para o volta a volta (fase 3).

Considerando 450 req/h efetivas (abaixo dos 500/h):

| Bloco | Chamadas | Observação |
|---|---|---|
| Catálogo (temporadas, pilotos 881/100, construtores, circuitos, status) | ~16 | |
| Calendário (1 por temporada) | 77 | |
| Resultados (26.247 linhas, por temporada com `offset`) | ~300 | |
| Classificação (treino) | ~160 | |
| Sprint | ~10 | |
| Campeonato final (pilotos e construtores × 77) | ~150 | |
| **Subtotal fase 1** | **~710–1.000** | **≈ 2–3 h** |
| Campeonato por rodada (×2) | ~2.300 | ≈ 5 h; ou calcular a partir dos resultados |
| Pit stops (~330 corridas, 1 chamada cada) | ~350 | < 1 h |
| Voltas (~590 corridas × ~1.100 linhas ÷ 100) | **~6.500** | ≈ 15 h; 2 noites |
| **Total completo** | **~10.000** | ≈ 22 h de ingestão, em 2–3 noites |

- **Tamanho:** cerca de 70 MB de JSON bruto (a maior parte é volta a volta; cerca de 10 MB com gzip). No Postgres, menos de 150 MB com índices.
- **Atalho com licença comercial:** o dump SQL Supporter (~15 MB) carrega tudo de uma vez e reduz a API ao incremental.
- **Rotina por GP:** resultado, classificação, sprint, 13 páginas de voltas, pit stops e 2 campeonatos dão cerca de 20 chamadas. Repetimos em T+3 h, T+12 h e T+48 h para pegar correções e punições, o que dá cerca de 80 chamadas por fim de semana.

### 4.4 O que a demo ganharia

- **Perfil do piloto com carreira:** números da carreira, linha do tempo das equipes, pontos por temporada e melhores resultados. Ex.: Senna, campeão de 1988 com 90 pontos válidos e 8 vitórias.
- **Gráfico de posição por volta** na página da corrida, com as paradas marcadas. Ex.: Singapura 2026, 62 voltas e 25 pit stops.
- **Histórico do circuito:** vencedores ano a ano (Interlagos tem 42 corridas, de Fittipaldi em 1973 a Norris em 2025), maior vencedor, de onde larga quem vence e taxa de abandono.
- **Campeonato rodada a rodada:** gráfico da disputa (1988 Senna × Prost, com descartes).
- **Temporada atual completa,** que hoje a demo não tem.

O [f1archive.pro](https://www.f1archive.pro/dashboard), que o Wagner indicou, é uma boa referência do que dá para mostrar:

- painel da temporada (campeonatos, próxima sessão, pit stop mais rápido);
- análises de ritmo, consistência (ganho de posições) e pit stops;
- comparação entre pilotos;
- "Track DNA", uma tabela por circuito com corridas, taxa de abandono, índice de ultrapassagem e grid médio do vencedor (Monza aparece com 76 corridas, ou seja, histórico desde 1950);
- race replay e "race engineer" com IA.

O rodapé diz que o site usa OpenF1 e FastF1. Não cita licença nem termos e não vende API (vive de doação). Quase tudo o que ele mostra fora o replay e a telemetria sai do jolpica ou do F1DB: o "Track DNA" e a consistência são agregações de resultados e voltas. Isso confirma o valor das fases 2 e 3.

### 4.5 Fases (do menor passo que já entrega valor)

As fases combinam as fontes da §6, cada uma dona de um tipo de dado (tabela da §6.4). O casamento de IDs e a precedência por campo da §4.1 valem igual para o F1DB: ele também usa slugs (`max-verstappen`, `interlagos`). O trabalho de casamento é feito uma vez e reaproveitado pelo jolpica, que usa slugs parecidos (`max_verstappen`).

| Fase | Fonte | Escopo | Custo de coleta | Entrega |
|---|---|---|---|---|
| **0. Licenças** (sem código) | — | E-mail ao jolpica (§2.4). Revisão jurídica da atribuição do F1DB e do `f1-circuits`. Cotação da Sportradar, só para saber o preço do volta a volta ao vivo | 0 | Saber o que dá para usar |
| **1. Histórico e temporada atual** | **F1DB** (CC BY 4.0) | Provider `f1db`: baixa o release (zip PostgreSQL ou JSON, ~6 MB), normaliza para os modelos atuais e faz o casamento de IDs. Corridas, TL, classificação, sprint, grid, resultados, voltas mais rápidas, pit stops, piloto do dia e campeonatos de 1950 até hoje. Atribuição "Data: F1DB (CC BY 4.0)" na doc e nas respostas da API. **Sem mudar o contrato** | 1 download por release (~3–4 h depois da corrida) | De 182 para ~2.500 eventos. Temporada atual completa. Demo navega por qualquer ano |
| **2. Carreira, circuito e recordes** | F1DB + **f1-circuits** (MIT) | Views `driver_career` e `venue_history`, campeonato por rodada, endpoints `career`/`history`/`records`, traçado do circuito (GeoJSON) na página do circuito, fatos para a IA | 0 (agregações) | Perfil do piloto, histórico e mapa do circuito, gráfico do campeonato |
| **3. Volta a volta** | **jolpica** (só com licença) ou Sportradar | Tabela `race_lap`, endpoint `/laps` e gráfico de posição por volta. Os pit stops já vêm do F1DB | ~6.500 chamadas (2 noites) ou o dump Supporter | Gráfico de posição por volta, ritmo e consistência (como o f1archive.pro) |
| **4. Ao vivo e sessões** | api-sports (plano pago) ou Sportradar | Temporada atual ao vivo fora da janela D−1..D+1 e voltas ao vivo. **Nunca pelo live timing oficial** | Contrato | Paridade com o ao vivo dos outros esportes |
| **5. Extras (opcionais)** | Pneus (fia-doc), clima | Só depois de o jurídico liberar os documentos da FIA e de contratar uma API de clima comercial (§6.3) | — | Estratégia de pneus, clima por sessão |

---

## 5. Teste prático (23/10/2026)

Foram 24 chamadas a `https://api.jolpi.ca`, espaçadas em ~1,2 s, com `User-Agent: GalaxieSportsResearch/0.1` e nenhum outro cabeçalho ou parâmetro pessoal. Todas voltaram `200` em 0,6–0,9 s, servidas pela borda da Cloudflare em São Paulo (`cf-ray …-GRU`, `Cache-Control: max-age=600`).

| Chamada | O que voltou |
|---|---|
| `/ergast/f1/current/last/results.json` | **GP de Singapura 2026** (rodada 17, 11/10/2026, `marina_bay`): 22 resultados. Verstappen (Red Bull) venceu largando em 1º, em `1:42:00.785` (`millis` 6120785); Leclerc ficou a +7,335 s e Antonelli a +24,573 s. Cada linha traz `number`, `position`, `positionText`, `points`, `Driver{driverId, permanentNumber, code, dateOfBirth, nationality}`, `Constructor`, `grid`, `laps`, `status`, `Time` e `FastestLap{rank, lap, Time}` |
| `/ergast/f1/current/last/laps.json?limit=100` | `total: 1236` linhas piloto×volta. Uma página de 100 linhas cobre ~5 voltas (cerca de 13 chamadas por corrida). Formato: `Laps[].Timings[] = {driverId, position, time}` |
| `/ergast/f1/current/last/pitstops.json` | `total: 25`, formato `{driverId, lap, stop, time: "20:33:35" (hora local), duration: "24.048"}` |
| `/ergast/f1/1988/driverstandings.json` | Rodada 16, 30 pilotos: **Senna 90 pts e 8 vitórias**, Prost 87 e 7, Berger 41 e 1. Os pontos já vêm com os descartes da época. Os pilotos de 1988 não têm `code` |
| `/ergast/f1/1988/constructorstandings.json` | McLaren 199 pts e 15 vitórias, Ferrari 65 e 1, Benetton 39 e 0 |
| Totais (`limit=1`) | 77 temporadas (1950–2026), 1.172 corridas, 26.247 resultados, 881 pilotos, 214 construtores, 78 circuitos, 136 status |
| `/ergast/f1/2024/21/results.json` | GP de São Paulo 2024: Verstappen venceu largando em 17º. Ocon e Gasly completaram o pódio. Bate com o que a api-sports já nos deu, e serve de corrida de teste para o casamento de IDs |
| `/ergast/f1/circuits/interlagos/results/1.json` | 42 vencedores em Interlagos, de Fittipaldi (1973, 1974) a Norris (2025) |
| `/ergast/f1/1988/1/laps.json` | `total: 0`, o que confirma que volta a volta só existe a partir de 1996 |
| `/ergast/f1/2026.json` | 23 GPs, 6 com sprint. A rodada 18 (EUA, 25/10) ainda não tem resultado, como esperado |
| `/f1/alpha/schedules/2026/` | Calendário com fuso e horário local por sessão, além de `results_url` e `laps_url` por sessão (inclui TL e classificação da sprint) |
| `/data/dumps/download/` | Dumps CSV e SQL de ~14,6 MB. O mais recente (Supporter) é de 13/10/2026 e o gratuito de 09/10/2026 (`delay_days: 14`) |

Os arquivos brutos ficaram fora do repositório (scratchpad da sessão). Nada foi gravado no banco.

Conferência cruzada: no F1DB, a 1ª parada de Singapura 2026 (`pit-stops.yml`) é de Hamilton, na volta 18, com 24,048 s. É o mesmo valor que o jolpica devolveu.

---

## 6. Outras fontes (lista awesome-f1)

Revisei a lista [subinium/awesome-f1](https://github.com/subinium/awesome-f1) (atualizada em 27/09/2026) e deixei de fora livros, cursos, mídia, simuladores e apps sem dado próprio. Cada fonte recebe um rótulo:

- ✅ **seguro**: a licença permite uso comercial, com atribuição;
- ⚠️ **incerto**: depende de contrato ou de parecer jurídico;
- ⛔ **proibido**: a licença ou os termos vetam o uso comercial, ou o dado vem de raspagem ou de timing oficial sem licença.

**Princípio:** o timing, a telemetria e o conteúdo do formula1.com são da Formula One. Os termos do formula1.com dizem que o conteúdo é "for your personal, non-commercial use only", vetam "distribute, copy, extract or commercially exploit" sem consentimento escrito e afirmam que o grupo tem "the exclusive right to commercialise the FIA Formula One World Championship in all media". Quando um projeto aberto redistribui esse dado sob MIT, Apache ou CC, isso **não** nos dá direito, porque o projeto não é dono do dado. Resultado e classificação são fatos, e é nesse terreno que as bases abertas (F1DB, jolpica) atuam.

### 6.1 Fontes que valem a pena

| Fonte | O que oferece | API ou dump | Atualização | Licença e uso comercial | Rate limit | Esforço |
|---|---|---|---|---|---|---|
| **[F1DB](https://github.com/f1db/f1db)** | Base histórica completa de 1950 até hoje. Pilotos, construtores com chassi, motores, pneus e 78 circuitos com layouts e **640 SVGs de traçado**. Por corrida: TL1–3 e warm-up, Q1/Q2/Q3, sprint, grid, resultado, voltas mais rápidas, **pit stops (desde 2003)**, piloto do dia (recente) e campeonatos rodada a rodada | **Dump** a cada release no GitHub: CSV, JSON, SQL (PostgreSQL, MySQL, SQLite) e SQLite; zip de ~6 MB. O release v2026.17.0 saiu em 11/10/2026 às 17:18 UTC | Pós-corrida: o release de Singapura saiu ~3–4 h depois da bandeirada | ✅ **CC BY 4.0** (`LICENSE`): uso comercial com atribuição e sem ShareAlike. Pontos a confirmar: o README linka o texto CC BY-SA na versão "plaintext" (provável erro) e falta saber se os SVGs seguem a mesma licença | Nenhum (download de release) | **Baixo/médio**: um loader do dump SQL e um normalize; IDs em slug (`max-verstappen`) |
| **[jolpica-f1](https://github.com/jolpica/jolpica-f1)** | Tudo da §1, com destaque para o **volta a volta desde 1996** | API (Ergast e alpha) + dump | Pós-corrida, algumas horas depois | ⚠️ CC BY-NC-SA 4.0; uso comercial só com licença escrita (§2) | 4 req/s, 500 req/h | Médio |
| **api-sports F1** (atual) | Sessões, resultado por sessão, grid, voltas mais rápidas, pit stops, ao vivo (`status`, volta atual) e imagens | API | Ao vivo e pós-corrida | ✅ Contrato comercial da api-sports (free hoje: 2022–2024 + janela D−1..D+1) | 100 req/dia (free) | Já integrado |
| **[Sportradar Racing (F1)](https://developer.sportradar.com/racing/docs/f1-ig-overview)** | Calendário, **volta a volta ao vivo** com ordem por volta em corrida e sprint (TL e classificação ao vivo desde 2025), campeonatos, perfis, circuitos e probabilidades de vitória | API REST por polling (JSON/XML) | Ao vivo | ✅ Comercial por contrato (trial dá histórico e replay). Preço sob consulta | Por contrato | Médio a alto, e caro |
| **[f1-circuits](https://github.com/bacinger/f1-circuits)** | Traçado de 35+ circuitos em **GeoJSON**, com coordenadas, extensão e altitude | Dump (GitHub) | Manual | ✅ MIT (código e dados). O repositório se declara não oficial. Parte da altitude veio de um artigo do formula1.com (só um número por circuito; risco baixo, mas citar) | — | **Baixo**: um mapa na página do circuito |
| **[fia-doc](https://github.com/harningle/fia-doc)** | Parser dos PDFs oficiais da FIA: lista de inscritos, **compostos de pneu**, classificações, tempos de volta e pit stops | Biblioteca (o código é Apache-2.0); o dado vem dos PDFs da FIA | Pós-sessão | ⚠️ O código é livre, mas os documentos são da FIA. É preciso parecer jurídico ou acordo com a FIA para revender o dado extraído | Respeitar o site da FIA | Médio a alto (PDFs mudam) |
| **[Motorsport Stats](https://motorsportstats.com/)** | Repositório de resultados desde 1911; alimenta o portal de resultados da FIA | API sob assinatura ("common data delivery platform") | In-session e pós-sessão | ⚠️ Comercial por contrato; cobertura de F1 e preço precisam de contato | Contrato | Médio |
| **[SportsDataIO Motorsport](https://sportsdata.io/motorsports-api)** | API multissérie | API | — | ⚠️ Comercial; **não confirmei** se cobre F1 nem com que profundidade | Contrato | Médio |
| **[TheSportsDB](https://www.thesportsdb.com/)** | Metadados e **imagens** (artes, emblemas) | API (free + Patreon) | Comunidade | ⚠️ Os dados exigem citar a fonte e **"cannot resell our API in any way without specific permission"**. Imagens só com a flag Creative Commons conhecida; logos de terceiros exigem permissão do dono | Plano | Baixo, mas com risco de licença |

### 6.2 Fontes descartadas (proibidas ou sem valor comercial)

| Fonte | Motivo |
|---|---|
| **[OpenF1](https://openf1.org/)** (telemetria, posições, rádio, stints, clima, race control; 2023+; ao vivo por €9,90/mês) | ⛔ CC BY-NC-SA 4.0 ("other use cases… contact the team for licensing") **e** o dado vem do live timing oficial. Mesmo com licença do OpenF1, faltaria o direito da Formula One. Limites: 3 req/s e 30 req/min no free, o dobro no plano pago |
| **[FastF1](https://github.com/theOehrly/Fast-F1)**, **LiveF1**, **undercut-f1**, **f1-dash**, **MultiViewer**, **f1_sensor** | ⛔ O código é MIT, mas todos leem o live timing oficial da Formula One. Uso pessoal sim; revenda não |
| **TracingInsights** (archive e HuggingFace) | ⛔ O repositório diz Apache-2.0, mas a telemetria vem do FastF1 (Formula One) e o "RaceData" é espelho do Ergast/jolpica (não comercial). A licença declarada não cobre o dado |
| **Kaggle** (Rohan Rao, jtrotman), **RelBench rel-f1** | ⛔/⚠️ Derivados do Ergast/jolpica: herdam a restrição não comercial. O F1DB cobre o mesmo dado com licença limpa |
| **[formula1-datasets](https://github.com/toUpperCase78/formula1-datasets)** | ⛔ GPL-3.0 no repositório, mas o dado vem do formula1.com e dos jogos da EA ("obtained from Formula 1 Official Web Site") |
| **[f1api.dev](https://f1api.dev/)** | ⛔ Termos: "you must not charge for any application or service that uses this API". Não cita a fonte |
| **Apify F1 Data Extractor** | ⛔ Raspagem do formula1.com, vetada pelos termos do site |
| **API do F1 Fantasy** (Postman, cheat sheet) | ⛔ API não documentada da Formula One; uso não autorizado |
| **F1 Live Timing, Results, Drivers e Teams** (formula1.com), sites de equipes | ⛔ Conteúdo oficial; só como referência humana, nunca ingestão |
| **TUMFTM racetrack-database** | ✅ LGPL-3.0, mas tem só 20+ pistas com linha central e de corrida. Pouco valor para o produto; o f1-circuits resolve melhor |
| **FIA F1 Archives e documentos**, **Pirelli Press Area** | ⚠️ Fontes oficiais em PDF (classificações, pneus, clima). Servem para conferência humana; ingestão só com o parecer citado no fia-doc |
| Dashboards e sites (F1 Cosmos, Pitwall, BigData F1, 4mula1stats, f1archive.pro…) | Referência de produto, não fonte. Nenhum oferece API licenciável |

### 6.3 Clima, imagens e logos

- **Clima:** na lista, só o OpenF1 e o FastF1 têm clima por sessão, e os dois são ⛔. A saída limpa é uma API de clima comercial, contratada fora da lista, com consulta pela lat/long do circuito (o F1DB e o jolpica têm as coordenadas). Ela dá o clima da cidade, não o da pista; isso é um ganho para a IA e para a página do evento.
- **Imagens e logos:** nenhuma fonte da lista resolve com licença limpa. Continuamos com a api-sports (Asset Mirror) e o acervo de logos já estudado em `docs/research/licenciamento-imagens.md` e `docs/research/logos-acervo-oficial.md`. O traçado vem do f1-circuits (GeoJSON, MIT) ou dos SVGs do F1DB, que precisam de confirmação de licença.

### 6.4 Quem vence em cada tipo de dado

| Tipo de dado | Dono | Reserva | Nunca |
|---|---|---|---|
| Calendário e horário das sessões | api-sports (temporada na janela) | **F1DB** (temporada inteira e histórico) | formula1.com |
| Ao vivo (status, volta atual) | **api-sports** | Sportradar (se contratada) | live timing, OpenF1, FastF1 |
| Resultado oficial (corrida, sprint, classificação, TL) | **F1DB** | api-sports em 2022–2024 (conferência de divergências); jolpica após licença | formula1.com, f1api.dev |
| Grid de largada e voltas mais rápidas | **F1DB** | api-sports | — |
| Pit stops | **F1DB** (2003+) | jolpica (2011+, após licença) | OpenF1 |
| Campeonatos (rodada a rodada, histórico) | **F1DB** | jolpica | — |
| Volta a volta (tempo e posição) | **jolpica** (1996+, só com licença) | Sportradar (ao vivo, pago) | FastF1, OpenF1, TracingInsights |
| Pneus e stints | — (nada seguro hoje) | fia-doc após parecer; Sportradar | OpenF1, FastF1 |
| Piloto (bio, número, nacionalidade) | **F1DB** | jolpica | — |
| Circuito (local, coordenadas, traçado) | **F1DB** (dados e SVG) + **f1-circuits** (GeoJSON) | jolpica | — |
| Fotos e logos | **api-sports** + acervo próprio | TheSportsDB por imagem, com licença conhecida | formula1.com, sites de equipes |
| Clima | API de clima comercial (fora da lista) | — | OpenF1, FastF1 |

### 6.5 Tabela comparativa resumida

| | api-sports (free) | jolpica-f1 | F1DB | OpenF1 | Sportradar |
|---|---|---|---|---|---|
| Histórico | 2022–2024 (free) / 2012+ (pago) | 1950+ | 1950+ | 2023+ | Por contrato |
| Temporada atual | Janela D−1..D+1 | Sim | Sim (release pós-GP) | Sim | Sim |
| Ao vivo | Sim | Não | Não | Pago (€9,90/mês) | Sim |
| Treinos livres | Sim | Só alpha | Sim | Sim | Sim (2025+) |
| Volta a volta | Não | 1996+ | Não | 2023+ (com telemetria) | Sim (ao vivo) |
| Pit stops | Sim | 2011+ | 2003+ | Sim | Não confirmado |
| Imagens | Sim | Não | SVG de circuito | Foto via formula1.com | Perfis |
| Acesso | API, 100 req/dia | API 500 req/h + dump | Dump (~6 MB) | API 30 req/min | API |
| **Uso comercial** | ✅ contrato | ⚠️ só com licença | ✅ CC BY 4.0 | ⛔ | ✅ contrato |
