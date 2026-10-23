# Fórmula 1 — enriquecimento com o jolpica-f1

> **Resumo**
> 1. **Uso comercial: não sem licença escrita.** A API e os dumps gratuitos do jolpica são CC BY-NC-SA 4.0 (não comercial e "compartilha igual"). Uma API B2B paga é uso comercial: precisamos de autorização por escrito em admin@jolpi.ca. O projeto já prevê um nível pago ("Supporter") com dados licenciados para uso comercial, mas não publicou preço nem termos.
> 2. **Ganho principal:** histórico completo de 1950 a 2026 (77 temporadas, 1.172 GPs, 26.247 resultados, 881 pilotos), a **temporada atual inteira** (o plano free da api-sports só libera 2022–2024), voltas piloto a piloto desde 1996 e pit stops desde 2011.
> 3. **O que não muda:** ao vivo, treinos livres e imagens continuam vindo da api-sports. O jolpica só publica o resultado horas depois da corrida e não tem fotos.
> 4. **Plano B sem negociação:** o F1DB (CC BY 4.0, uso comercial permitido com atribuição) cobre histórico, grid, resultados, pit stops e classificações, mas não tem volta a volta.
> 5. **Primeiro passo:** mandar hoje o e-mail de licença (rascunho na §2.4). Em paralelo, fazer uma prova interna, sem expor a clientes, que carrega resultados e campeonatos de 1950–2026 (~1.000 chamadas, cerca de 2 h). Volta a volta fica para uma fase seguinte.

Pesquisa feita em 2026-10-23. Fontes: repositório [jolpica/jolpica-f1](https://github.com/jolpica/jolpica-f1) (README, `TERMS.md`, `docs/`, discussões e issues), o OpenAPI publicado em `https://api.jolpi.ca/docs/schema/` (versão `20261021203116-1a1a058`) e 24 chamadas reais à API (§5).

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

- **F1DB** ([f1db/f1db](https://github.com/f1db/f1db)) está sob **CC BY 4.0**, que permite uso comercial com atribuição. Cobre 1950 até hoje: calendário, classificação, grid, resultados, voltas mais rápidas, **pit stops**, piloto do dia e campeonatos, com releases logo depois de cada GP (JSON, CSV, SQL e SQLite). **Não tem volta a volta.** Antes de usar, confirmar uma inconsistência: o README linka o texto CC BY-SA na versão "plaintext" e o CC BY no resto.
- **api-sports paga** (Pro): libera a temporada atual e 2012 em diante, mas não tem volta a volta nem histórico antes de 2012.
- **OpenF1 e FastF1** (timing desde 2018/2023, telemetria): são boas referências de produto, mas vêm do timing oficial, que não tem licença comercial clara. Precisariam de um estudo à parte.

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

| Fase | Escopo | Chamadas | Entrega |
|---|---|---|---|
| **0. Licença** (sem código) | E-mail da §2.4, negociação e revisão jurídica. Em paralelo, abrir o F1DB como plano B | 0 | Sinal verde ou troca de fonte |
| **1. Histórico e temporada atual** | Provider `jolpica` (cliente, raw, normalize), casamento de IDs e precedência por campo. Carrega corridas, classificações, sprints, resultados e campeonato final de 1950–2026. **Sem mudar o contrato da API.** Prova interna pode começar antes da licença, sem expor a clientes | ~1.000 (1 tarde) | De 182 para ~2.500 eventos. Temporada atual completa. Demo navega por qualquer ano |
| **2. Carreira, circuito e recordes** | Views `driver_career` e `venue_history`, campeonato por rodada, endpoints `career`/`history`/`records`, perfil do piloto e página do circuito na demo, fatos para a IA | ~2.300 (ou 0, calculando) | Perfil do piloto, histórico do circuito, gráfico do campeonato |
| **3. Volta a volta e pit stops** | Tabelas `race_lap`/`race_pit_stop`, `/laps` e `/pit-stops`, gráfico de posição por volta | ~6.900 (2 noites) ou o dump | Gráfico de posição por volta, estratégia de paradas |
| **4. Alpha e rotina** | TL e classificação da sprint pela alpha quando estabilizar; token com limite maior; webhook "resultado oficial publicado" para clientes | ~80 por GP | Paridade de sessões e aviso pós-corrida |

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
