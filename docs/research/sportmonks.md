# Sportmonks como provedor licenciado de produção (Football API v3)

> Pesquisa feita em 2026-10-21 para a Galaxie Sports (API B2B de esportes para plataformas de TV paga e OTT na América Latina).
> Fontes: site oficial (sportmonks.com: preços, termos, FAQ, página Enterprise, página de integridade, cobertura) e documentação oficial (docs.sportmonks.com, versão Markdown via `llms.txt`, incluindo o changelog). As páginas foram lidas direto do servidor, sem login e sem nenhuma chave de API. **Nenhuma chamada à API foi feita.**
> Legenda: **[oficial]** = página ou documentação da Sportmonks · **[terceiros]** = fonte não oficial · **[inferência]** = conclusão nossa · **[não verificado]** = sem confirmação; validar no trial ou por escrito com o fornecedor.

---

## Sumário executivo

- **Produtos em 2026:** Football API **v3** (carro-chefe, mais de 2.200 ligas), Cricket API (**v2.0**, domínio próprio) e Motorsport API v3 (Fórmula 1). Não há outros esportes. Auth por token (`api_token` na query ou header `Authorization`). Base do futebol: `https://api.sportmonks.com/v3/football`. [oficial]
- **Preços do futebol (desde 2026-03-09):** Starter **€29**/mês (5 ligas à escolha), Growth **€99** (30 ligas), Pro **€249** (120 ligas) e Enterprise sob cotação (todas as ligas, histórico completo). No plano anual sai €24, €79 e €199/mês. Valores sem IVA, cobrados em euro. Limite **por entidade por hora**: 2.000 / 2.500 / 3.000 / 5.000. Free para sempre só com Dinamarca e Escócia. Trial de 14 dias nos pagos. [oficial]
- **Cobertura LatAm boa no topo:** Série A, Série B, Libertadores, Copa América, Copa do Mundo e Mundial de Clubes têm todas as 10 categorias de dados. Copa do Brasil, Sudamericana, estaduais e as ligas de AR, CL, UY, CO, PE, EC, PY e MX têm ao vivo e eventos.
- **Lacunas de cobertura:**
  - **Futebol olímpico:** só calendário e histórico, sem ao vivo.
  - **Copa do Brasil e Sudamericana:** sem classificação nem artilharia.
  - **Estaduais:** sem estatística avançada de jogador. Carioca, Baiano, Paranaense, Pernambucano e Catarinense também não têm escalações.
  - **Colômbia:** sem escalações.
  - **Liga MX:** sem artilharia.
  - **Eliminatórias:** as da CONMEBOL não têm escalações; as da CONCACAF não têm ao vivo nem classificação.
- **Ao vivo:** só polling REST, sem webhooks, WebSocket ou push. O endpoint `/livescores/latest` atualiza em ciclo de **10 s**. A latência típica do lance até a API é de **cerca de 15 s**. [oficial]
- **TV Stations (onde assistir):** existe em **todos os planos**, sem add-on. Os dados vêm por jogo e **por país** (`tvStations.tvStation;tvStations.country`), com filtro por país e endpoints de jogos por canal. **Não há documentação pública de quais países ou ligas têm canais, nem de como os dados são apurados.** A própria doc avisa que muitos jogos vêm com a lista vazia. **Tratar como sinal auxiliar, não como fonte de verdade.** [oficial + não verificado]
- **Licenciamento:** os termos permitem construir produtos comerciais e armazenar, transferir e distribuir os dados **dentro do próprio produto**. **Revender os dados ou servi-los como feed a outras empresas exige aprovação escrita.** Os termos também dizem que o acesso é **por domínio**, com preço ajustado para vários domínios, e proíbem compartilhar token entre empresas. **O modelo da Galaxie (API B2B para vários clientes) se encaixa em redistribuição e exige um acordo Enterprise com cláusula expressa.** Logos e fotos **não** são licenciados pela Sportmonks. [oficial + inferência]
- **Comparação com a api-sports:** a Sportmonks custa uma ordem de grandeza a mais nos planos de prateleira (Pro €249 contra US$19). Em troca, oferece TV Stations, cobertura e profundidade melhores em LatAm, suporte humano e **um caminho contratual explícito para redistribuição**, que a api-sports não oferece.

---

## 1. Produtos, versões, base URL e autenticação

| Produto | Versão | Base URL | Planos e preço | Limite | Fonte |
|---|---|---|---|---|---|
| **Football API** | v3 (API 3.0) | `https://api.sportmonks.com/v3/football` (entidades de referência em `.../v3/core`, como types, countries e timezones) | Free, Starter, Growth, Pro e Enterprise (ver §2) | 2.000 a 5.000 por entidade por hora | [docs: autenticação](https://docs.sportmonks.com/v3/welcome/authentication), [preços](https://www.sportmonks.com/football-api/plans-pricing/) |
| **Cricket API** | v2.0 | `https://cricket.sportmonks.com/api/v2.0/...` | Major €29 (20+ ligas), World €75 (60+), Enterprise a partir de €129 | 2.000 por hora **por endpoint** | [preços de críquete](https://www.sportmonks.com/cricket-api/plans-pricing/), [Cricket API](https://www.sportmonks.com/cricket-api/) |
| **Motorsport API (F1)** | v3 | `https://api.sportmonks.com/v3/motorsport/...` (a F1 API v1 foi migrada) | Plano único "Full Season F1": €79/mês ou €830/ano (cerca de €69/mês) | 3.000 por hora por endpoint | [Formula One API](https://www.sportmonks.com/formula-one-api/), [docs Motorsport](https://docs.sportmonks.com/v3/motorsport-api/welcome/welcome) |
| Add-ons do futebol | — | mesma base | Odds & Predictions, xG & Pressure Index, News, Transfer Rumours, Premium Odds Feed, Expected Lineups, Match Facts | — | [preços](https://www.sportmonks.com/football-api/plans-pricing/) |
| Widgets | — | iframes e WordPress | — | — | [widgets](https://www.sportmonks.com/football-api/football-widgets/) |

**Autenticação** [oficial]:
- O token vai em `?api_token=TOKEN` **ou** no header `Authorization: TOKEN`. Os dois métodos somam no mesmo rate limit.
- Os tokens não expiram. Ficam em my.sportmonks e podem ser rotacionados pelo cliente.
- A doc recomenda **nunca** expor o token no front-end e usar um backend ou proxy. Isso combina com o nosso modelo.
- Recomendação nossa: usar o header, para o token não aparecer em logs de URL.

**Códigos HTTP** [oficial]:
- 401: sem autenticação.
- **403: feed fora do plano.**
- 429: limite estourado.
- 400: requisição malformada. Erros 5001 (include inexistente), 5004 (consulta complexa demais), 5006 (parâmetro inválido) e 5010 (filtro inaplicável). ([códigos de complexidade](https://docs.sportmonks.com/v3/api/error-codes/filtering-and-complexity-exceptions))

---

## 2. Planos, preços, limites e plano Free (futebol)

A nova estrutura foi lançada em 2026-03-09 ([changelog](https://docs.sportmonks.com/v3/changelog/changelog), [blog](https://www.sportmonks.com/blogs/introducing-our-new-pricing-setup/)). Os antigos pacotes fixos de ligas, do tipo "European/Worldwide", foram substituídos por **"escolha N ligas"**. Todos os planos têm **os mesmos recursos de dados**. Só mudam a quantidade de ligas, a capacidade de chamadas e o suporte.

| Plano | Mensal | Anual (por mês) | Ligas | Chamadas por entidade por hora | Histórico | Observações |
|---|---|---|---|---|---|---|
| **Free** | €0, sem prazo de validade | — | **Superliga dinamarquesa + Premiership escocesa** (com play-offs) | **3.000** segundo a doc de rate limit. O FAQ antigo fala em 2.000 por endpoint **[conflito]** | — | Sem cartão. Serve para testar o formato, não a cobertura LatAm. ([free plan](https://www.sportmonks.com/football-api/free-plan/), [rate limit](https://docs.sportmonks.com/v3/api/rate-limit)) |
| **Starter** | **€29** | €24 | 5 à escolha, no mundo todo | 2.000 | últimas 3 temporadas | trial de 14 dias |
| **Growth** | **€99** | €79 | 30 à escolha | 2.500 | últimas 3 temporadas | trial de 14 dias |
| **Pro** | **€249** | €199 | 120 à escolha | 3.000 | últimas 3 temporadas | trial de 14 dias. Marcado como "most popular" |
| **Enterprise** | sob cotação | sob cotação | **todas** (2.200+ ou 2.300+, conforme a página) | **5.000 como base**, mais no contrato | **completo, incluído** | Contato de CS dedicado, DPA sob pedido, **acordo customizado** (inclusive redistribuição, ver §5). ([Enterprise](https://www.sportmonks.com/football-api/enterprise-plan-v2/)) |

**Add-ons** (preços "a partir de", da [página de preços](https://www.sportmonks.com/football-api/plans-pricing/)) [oficial]:

| Add-on | Preço | Nota |
|---|---|---|
| Odds & Predictions (pré-jogo e ao vivo, 50+ casas, 150+ mercados) | a partir de **€15–24/mês** | A página mostra "€24 → €15, save 20%". Não está claro se isso é mensal contra anual **[não verificado]** |
| xG & Pressure Index | a partir de **€24–29/mês** | **[conflito]** A doc de xG cita outros preços: xG Basic €19/€69/€99 (Starter/Growth/Pro) e xG Advanced (ao vivo) €199–399 ([cobertura xG](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/expected/coverage)) |
| Chamadas extras | a partir de €29/mês | aumenta o limite por hora |
| Histórico (temporadas com mais de 3 anos) | a partir de **€29, pagamento único** | Enterprise já inclui |
| News (prévias e pós-jogo escritas por scouts) | **€99/mês** | prévias saem pelo menos 48 h antes do jogo ([doc](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/news/pre-match-news)) |
| Transfer Rumours | €99/mês | — |
| Ligas extras | a partir de **€4/mês** por liga | — |
| Premium Odds Feed (parceiro TXODDS) | a partir de €129/mês | — |

**Modelo de rate limit** [oficial] ([rate limit](https://docs.sportmonks.com/v3/api/rate-limit)):
- **O limite é por entidade, não por endpoint.** Fixture, Team, Player, League, Season, Type, Venue, Coach e Referee têm cada um seu balde. `/livescores` conta como **Fixture**.
- **Janela deslizante de 1 h** a partir da primeira requisição àquela entidade. Não há reset fixo em UTC.
- **Cada página paginada conta 1.** Resposta vazia também conta 1.
- Todo corpo de resposta bem-sucedida traz `rate_limit { resets_in_seconds, remaining, requested_entity }`.
- Ao estourar o limite, a API devolve **429** naquela entidade, e as outras continuam funcionando.
- Erros de validação (por exemplo 5001) não trazem `rate_limit`.
- Na página de preços, estourar o limite gera "notificações" e oferta de upgrade.

**Trial** [oficial, com conflito]:
- 14 dias, **um por conta**. Criar várias contas para repetir o trial é proibido.
- **[conflito]** Os termos de serviço e o FAQ de preços dizem que o trial exige cartão e cobra no 15º dia. A página Enterprise, a doc de rate limit e parte do FAQ dizem "sem cartão".
- Mudar de plano gera uma nova fatura, com crédito proporcional do período não usado.
- Pagamento só por cartão ou PayPal, em euro, **sem IVA incluído**. Não há reembolso de período já pago ([termos](https://www.sportmonks.com/terms-of-service/)).

**Quantas ligas a Galaxie precisaria** [inferência]: o núcleo listado na §3 tem cerca de 29 competições.
- Série A, Série B, Copa do Brasil e 4 estaduais.
- Libertadores e Sudamericana.
- 8 ligas nacionais de AR, CL, UY, CO, PE, EC, PY e MX.
- 5 ligas grandes da Europa e a Champions.
- Copa do Mundo, Mundial de Clubes, Copa América, 2 eliminatórias e Olimpíadas.

Com copas nacionais, mais estaduais, Liga Europa e supercopas, o total passa de 30 com folga. **Self-serve mínimo realista: Pro (€249/mês ou €2.388/ano), mais add-ons.** Não ficou claro se cada copa e cada fase conta como uma "liga" separada **[não verificado]**. Mas, pelo licenciamento (§5), o plano de produção acaba sendo **Enterprise**.

---

## 3. Cobertura das competições-alvo

Fonte: a tabela da [página de cobertura](https://www.sportmonks.com/football-api/coverage/) (atualizada em 2026-10-12). Cada liga tem 10 marcadores de categoria, e nós extraímos do HTML quais estão presentes. O nível campo a campo fica no "Coverage Finder", que exige login e **não foi consultado** **[não verificado]**.

Legenda: **Cls** = classificação · **Odds** = odds pré-jogo e ao vivo · **Cal** = calendário · **JogAv** = estatística avançada de jogador · **Esc** = escalações e estatística básica de jogador · **AoV** = placar ao vivo e eventos · **EstJ** = estatística da partida · **ClsAoV** = classificação ao vivo · **Art** = artilharia · **Hist** = histórico. A coluna xG indica se a liga está na lista do add-on de xG ([doc](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/expected/coverage)).

### 3.1 Brasil

| Competição (league_id) | Tem | Falta | xG |
|---|---|---|---|
| Série A (648) | todas as 10 | — | sim |
| Série B (651) | todas as 10 | — | não |
| Copa do Brasil (654) | Odds, Cal, JogAv, Esc, AoV, EstJ, Hist | **Cls, ClsAoV, Art** | não |
| Supercopa do Brasil (1798) | Odds, Cal, Esc, AoV, EstJ, Hist | Cls, JogAv, ClsAoV, Art | não |
| Copa do Nordeste (1294) | Odds, Cal, Esc, AoV, EstJ, Hist | Cls, JogAv, ClsAoV, Art | não |
| Paulista A1 (1313) | Cls, Odds, Cal, Esc, AoV, EstJ, ClsAoV, Art, Hist | JogAv | não |
| Mineiro 1 (1307) | igual ao Paulista | JogAv | não |
| Gaúcho 1 (1302) | igual ao Paulista | JogAv | não |
| Carioca 1 (1296) | Cls, Odds, Cal, AoV, EstJ, ClsAoV, Art, Hist | **JogAv, Esc** | não |
| Paranaense 1 (1311), Baiano 1 (1291), Pernambucano 1 (1316), Catarinense 1 (1299) | igual ao Carioca | **JogAv, Esc** | não |
| Outros: Série C/D, divisões 2 e 3 dos estaduais, sub-20, feminino, Copa do Brasil Feminino | presentes na lista | variável | não |

Detalhes da Série A no FAQ [oficial]:
- Dados profundos (escalações, eventos, estatísticas de jogador) desde cerca de **2010**. Antes disso, só resultados.
- xG existe só **a partir da temporada 2024**.
- As predições saem 21 dias antes do jogo e são atualizadas todo dia.

### 3.2 CONMEBOL e outras ligas da América Latina

| Competição (id) | Tem | Falta | xG |
|---|---|---|---|
| **Libertadores** (1122) | todas as 10 | — | sim |
| **Sudamericana** (1116) | Odds, Cal, JogAv, Esc, AoV, EstJ, Hist | **Cls, ClsAoV, Art**. A Sudamericana tem fase de grupos, então pode ser erro da página **[não verificado]** | não |
| Recopa Sudamericana (1483) | Odds, Cal, Esc, AoV, EstJ, Hist | Cls, JogAv, Art | não |
| **Copa América** (1114) | todas as 10 | — | sim |
| **Eliminatórias CONMEBOL** (726) | Cls, Odds, Cal, JogAv, AoV, EstJ, ClsAoV, Art, Hist | **Esc** | sim |
| Eliminatórias CONCACAF (717) | Odds, Cal, JogAv, Esc, EstJ, Hist | **AoV, Cls, ClsAoV, Art** | sim |
| Argentina: Liga Profesional (636) | todas as 10 | — | sim (e Copa de la Superliga, 1658) |
| Argentina: Copa Argentina (642), Primera B Nacional (645) | Copa: Odds, Cal, Esc, AoV, EstJ, Hist. B Nacional: sem JogAv | — | não |
| Chile: Primera División (663) | todas as 10 | — | não |
| Uruguai: Primera División (770) | 9 de 10 | **JogAv** | não |
| Colômbia: Liga BetPlay (672) | Cls, Odds, Cal, JogAv, AoV, EstJ, ClsAoV, Art, Hist | **Esc (escalações)** | não |
| Peru: Primera División (764) | todas as 10 | — | não |
| Equador: Liga Pro (696) | 9 de 10 | **JogAv** | não |
| Paraguai: División 1 (755) | 9 de 10 | **JogAv** | não |
| Bolívia (1098) e Venezuela (800) | 9 de 10 | JogAv | não |
| **México: Liga MX** (743) | Cls, Odds, Cal, JogAv, Esc, AoV, EstJ, ClsAoV, Hist | **Art** | sim |
| México: Copa MX (746), Liga de Expansión (749), Liga MX Femenil (1579) | sem JogAv | — | não |
| CONCACAF: Champions Cup (1111), Gold Cup (1112), Leagues Cup (3211) | Champions Cup: Odds, Cal, AoV, EstJ, Hist. Gold Cup: sem JogAv e sem Esc. Leagues Cup: Cls, Odds, Cal, AoV, Hist | — | não |

### 3.3 Europa e FIFA/COI

| Competição (id) | Tem | Falta | xG |
|---|---|---|---|
| Premier League (8), La Liga (564), Bundesliga (82), Serie A (384), Ligue 1 (301) | todas as 10 | — | sim |
| Champions League (2), Europa League (5), Conference League (2286) | todas as 10 | — | sim |
| **Copa do Mundo** (732) | todas as 10 | — | sim |
| **Mundial de Clubes** (3412) | todas as 10 | — | sim |
| Eliminatórias UEFA (720), Nations League (1538), Euro (1326) | completas. A eliminatória UEFA não tem ClsAoV | — | sim |
| **Futebol olímpico masculino** (1125) e feminino (1126) | **só Cal e Hist** | **todo o resto, inclusive ao vivo** | não |
| Pré-Olímpico CONMEBOL (1784) | Cls, Odds, Cal, EstJ, Art, Hist | AoV, Esc | não |
| Amistosos internacionais (1082) | Odds, Cal, Esc, AoV, EstJ, Hist | Cls, JogAv | não |

**Observações:**
- A Sportmonks **não detém direitos oficiais** de nenhuma competição. Coleta os dados com scouts próprios e parceiros ([integridade](https://www.sportmonks.com/integrity-support/)).
- Os termos dizem que pode haver lacunas de cobertura e que completude não é garantida ([termos](https://www.sportmonks.com/terms-of-service/)).
- Novo em 2026: eventos de **pausa de hidratação** (`DELAY_START`/`DELAY_END`), com cobertura inicial na Copa do Mundo de 2026 e no Mundial de Clubes. Também há **chaveamento de mata-mata** (`brackets`) para ligas elegíveis ([changelog](https://docs.sportmonks.com/v3/changelog/changelog)).

---

## 4. Recursos relevantes

### 4.1 Ao vivo: latência e atualização [oficial]

| Item | Valor | Fonte |
|---|---|---|
| Modelo | **Só polling REST.** Não há webhooks, WebSocket, SSE ou push. A doc diz que o inplay "is not a WebSocket" | [tutorial de livescores](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/livescores-and-fixtures/livescores), [FAQ](https://www.sportmonks.com/faq/) |
| Latência do lance até a API | **cerca de 15 s** típico (medido em agosto de 2026) | [integridade](https://www.sportmonks.com/integrity-support/), [Enterprise](https://www.sportmonks.com/football-api/enterprise-plan-v2/) |
| `GET /livescores/latest` | só os jogos alterados nos **últimos 10 s**, em ciclo de 10 s. **Não fazer polling em menos de 10 s**: gera duplicatas e gasta cota | [doc](https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/livescores/get-latest-updated-livescores) |
| Janela de livescores | de 15 min antes do início a 15 min depois do fim. Fora dela, usar `/fixtures/{id}` | tutorial |
| `GET /livescores/inplay` | só jogos em andamento | tutorial |
| Odds | pré-jogo atualizadas a cada cerca de 10 min. Odds ao vivo "a cada segundo". Os includes `odds` e `premiumOdds` **foram retirados dos livescores** em 2026-03-26 | [FAQ](https://www.sportmonks.com/faq/), changelog |
| Disponibilidade | 99,99% medida e publicada em status.sportmonks.com. **Sem SLA contratual** nos termos padrão. É possível negociar no Enterprise | Enterprise |
| Custo de polling [inferência] | `/livescores/latest` a cada 10 s = **360 chamadas por hora na entidade Fixture**. Cabe com folga em 2.000 a 5.000/h, desde que os detalhes venham via includes e não com uma requisição por jogo | — |

**[terceiros]** Um diretório de APIs (sportsapis.dev) lista um recurso de "Websocket" para a Sportmonks. **Isso contradiz a doc oficial.** Tratar como não verificado.

### 4.2 TV Stations: crítico para o "onde assistir"

O que existe [oficial] ([endpoint](https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/tv-stations), [tutorial do include](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/includes/tv-stations)):
- `include=tvStations` em qualquer fixture devolve uma lista de pares **{fixture_id, tvstation_id, country_id}**. A mesma emissora aparece uma vez por país em que transmite. A chave na resposta é `tvstations`, em minúsculas.
- Para resolver nomes no mesmo request: `include=tvStations.tvStation;tvStations.country`. O objeto da emissora traz `id`, `name`, `url`, `image_path`, `type` (por exemplo `"tv"`) e `related_id`.
- Para filtrar por país: `&filters=fixturetvstationCountries:{countryId}`.
- Endpoints dedicados:
  - `GET /tv-stations`, com filtro `IdAfter` para importação.
  - `GET /tv-stations/{id}`.
  - `GET /tv-stations/fixtures/{fixtureId}`.
  - `GET /fixtures/upcoming/tv-stations/{id}`.
  - `GET /fixtures/past/tv-stations/{id}`.
- **Incluído em todos os planos, sem add-on.**
- Aviso da doc: **"nem todos os fixtures têm TV station"**. Ligas menores e regiões com pouca cobertura de transmissão podem vir com array vazio.

O que **não** sabemos **[não verificado]**:
- **A lista de países cobertos.** Não há documentação pública por país. Não sabemos se BR, AR, MX, CO, CL, PE, UY e EC estão no cadastro, nem com que granularidade (TV aberta, TV paga, streaming, praça regional).
- **A metodologia e o prazo.** Não sabemos quem apura os dados, com quanta antecedência eles aparecem nem como correções são propagadas.
- **A distinção entre tipos de transmissão.** O campo `type` existe, mas os valores possíveis não estão documentados. Não sabemos se o dado separa TV linear de streaming, nem se marca jogos com transmissão regional.
- Um único relato de usuário, num fórum de terceiros e sem data, elogia os dados de TV da Sportmonks ([ANWP](https://support.anwp.pro/communities/1/topics/1528-api-import-add-sportmonks-football-api)). Não há auditoria independente.

**Recomendação** [inferência]:
- Usar `tvStations` como **sinal inicial** na camada "onde assistir", ao lado da tabela de direitos e do agente de verificação descritos em `onde-assistir.md`, nunca como fonte única.
- No trial:
  1. Amostrar 50 jogos por país-alvo (Série A, Libertadores, Liga Profesional, Liga MX, Liga BetPlay, Champions).
  2. Medir a cobertura, ou seja, a porcentagem de jogos com algum canal no país.
  3. Medir a precisão contra as grades oficiais das emissoras.
- **Ler o licenciamento dos logos de emissora** (`image_path`) com o mesmo cuidado dos logos de clubes (§5).

### 4.3 Outros recursos

| Recurso | Situação | Fonte |
|---|---|---|
| **Includes** (`include=participants;scores;events;lineups;statistics;state;venue;tvStations`) | Um request traz o jogo inteiro. Aceita includes aninhados com `.` e seleção de campos dentro do include com `:` (por exemplo `participants:name,short_code`). Incluir mais dados **não custa chamadas extras**, mas aumenta payload e latência e pode gerar o erro 5004 (complexidade) | [includes](https://docs.sportmonks.com/v3/api/request-options/includes), [best practices](https://docs.sportmonks.com/v3/welcome/best-practices) |
| `select=`, `filters=`, `order=`, `locale=` (tradução, beta), `timezone=` | `filters` usa a sintaxe `nome:val1,val2` (por exemplo `fixtureStates:2,22`, `fixtureLeagues:648`). `timezone` muda o resultado da busca por data, mas no livescore só afeta a exibição de `starting_at` | [timezone](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/timezone-parameters-on-different-endpoints) |
| Lote e intervalo | `/fixtures/multi/{ids}` (até **50** ids) · `/fixtures/between/{de}/{até}` (até **100 dias**) · `/fixtures/latest` (atualizados recentemente) · filtro `IdAfter` para importação incremental | [llms.txt](https://docs.sportmonks.com/llms.txt) |
| Classificação | classificação normal e ao vivo, por temporada e por rodada. Artilharia por temporada | coverage, FAQ |
| Predições | add-on. Mais de 20 mercados, disponíveis 21 dias antes do jogo, mais "value bets" | [FAQ](https://www.sportmonks.com/faq/), [termos](https://www.sportmonks.com/terms-of-service/) |
| Notícias pré-jogo e pós-jogo | add-on de €99/mês. Prévias pelo menos 48 h antes. **Idioma dos textos [não verificado]**, provavelmente só inglês | [doc](https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/news/pre-match-news) |
| Match Facts, Expected Lineups, Pressure Index, xG | add-ons | preços |
| Histórico | self-serve: 3 temporadas. Mais que isso, add-on pago uma vez. Enterprise inclui tudo. Legenda da página de cobertura: "back to 2005/2006". xG só desde 2024 | preços, FAQ |
| Imagens | `image_path` em `cdn.sportmonks.com` para times, jogadores, países, emissoras e estádios. **Sem licença de uso** (§5) | termos |
| Highlights em vídeo | URLs de plataformas de vídeo. "Uso por sua conta e risco" | termos |
| Widgets | iframes e WordPress, para livescore, classificação e artilharia | site |
| MCP e documentação para IA | MCP Server (beta), `llms.txt` e docs em Markdown | docs |

---

## 5. Licenciamento: dá para revender pela nossa API?

**Termos de serviço** [oficial, paráfrase] ([terms-of-service](https://www.sportmonks.com/terms-of-service/)):
1. **Revenda:** revender os dados **sem aprovação** é proibido. Não se pode "vender diretamente" os dados, porque isso concorreria com a Sportmonks. O uso pretendido é construir apps, sites, jogos etc. Ganhar dinheiro com o que se constrói é permitido. Em caso de dúvida, o fornecedor pede para explicar o plano e perguntar.
2. **Distribuição:** distribuir, transferir e armazenar os **dados** é permitido. Revender o **produto** exige consentimento.
3. **Domínio:** os dados ficam disponíveis **por domínio**, e o preço é ajustado quando há **vários domínios**. Esse ponto é relevante para B2B com vários clientes.
4. **Conta:** a conta é pessoal e não pode ser compartilhada com outros desenvolvedores.
5. **Logos e fotos:** pertencem aos titulares. Para exibi-los, **o cliente precisa obter a prova de propriedade intelectual por conta própria** (permissão, licença ou fair use, conforme cada caso).
6. **Garantia:** os dados vêm "como estão", sem garantia de exatidão, completude ou disponibilidade. Os termos mudam sem aviso, salvo alteração materialmente adversa. Lei e foro da Holanda.
7. **Apostas e predições:** a Sportmonks não se responsabiliza por ganhos ou perdas em sites de terceiros.

**Páginas Enterprise e de integridade** [oficial] ([integridade](https://www.sportmonks.com/integrity-support/), [Enterprise](https://www.sportmonks.com/football-api/enterprise-plan-v2/)) resumem o uso permitido:
- **Pode:**
  - construir produtos e cobrar por eles;
  - armazenar os dados no próprio banco e cacheá-los;
  - mostrar os dados aos **seus usuários**, na **sua apresentação**.
- **Precisa falar com a Sportmonks antes:**
  - revender os dados como dados. Nas palavras da página: *"Redistribution as a feed needs written approval"*;
  - compartilhar uma conta ou token entre **empresas diferentes** (estruturas de grupo vão no contrato);
  - revender o arquivo histórico como dataset.
- No Enterprise, redistribuição é "parte normal da conversa do acordo".
- **Atribuição:** pode-se dizer "powered by Sportmonks", sem sugerir que a Sportmonks é detentora de direitos oficiais. A Sportmonks revisa a redação em cerca de 1 dia.
- **Apostas:** é permitido construir produtos de apostas, mas a licença de jogo, a verificação de idade e o jogo responsável são responsabilidade do cliente.
- **Uso em transmissão** (grafismo on-air, telas de TV): **não é tratado em nenhum documento [não verificado]**. Precisa entrar no contrato.

**Aplicação à Galaxie Sports** [inferência]:
- Servir dados a **várias empresas** (plataformas de TV paga e OTT) pela nossa API configura **redistribuição como feed** ou sublicenciamento. Isso vale mesmo com transformação, normalização e cache, porque o cliente recebe dados estruturados e não só a nossa apresentação.
- **Não é permitido nos planos self-serve sem aprovação escrita.** A cláusula de domínio reforça isso: cada cliente ou domínio pode mudar o preço.
- O que pedir no contrato Enterprise:
  1. Direito de **redistribuição e sublicenciamento B2B** para N clientes, nomeados ou por categoria, nos territórios da América Latina, inclusive **white-label**.
  2. Permissão de exibição em telas de TV e OTT dos clientes, incluindo **uso em transmissão** se houver.
  3. Regras de atribuição.
  4. Exclusão explícita de logos e fotos, que ficam sob nossa conta ou do cliente.
  5. Direito de reter dados históricos após o fim do contrato. **Os termos padrão não falam em apagar os dados [não verificado]**.
  6. Limites por entidade compatíveis com o pico de jogos.
  7. SLA contratual opcional.
  8. DPA. A Sportmonks não recebe dados de usuários finais.
- **Logos de clubes e de emissoras:** não usar os `image_path` da Sportmonks em produção sem licença dos titulares. Para o "onde assistir", considerar mostrar só o nome do canal ou usar logos fornecidos pelos próprios clientes [inferência].

---

## 6. Comparação com a api-sports.io para o nosso caso

Os números da api-sports vêm de `api-sports-football.md` (mesma pasta) e do enunciado.

| Critério | Sportmonks (Football v3) | api-sports.io (API-FOOTBALL v3) |
|---|---|---|
| **Custo (ordem de grandeza)** | Self-serve de €29 a €249/mês (anual de €24 a €199). O que precisamos é Pro mais add-ons, **de €300 a €500/mês**. Com redistribuição, **Enterprise sob cotação: sem preço público** [não verificado] | Free com 100 req/dia. Pro **US$19/mês** (7.500/dia), Ultra US$29, Mega US$39 e planos sob medida. Cerca de **10× mais barata** nos planos de prateleira |
| Modelo de limite | por **entidade por hora** (2.000 a 5.000), janela deslizante | por **dia** (com reset 00:00 UTC) e por minuto |
| Plano gratuito | permanente, mas só **Dinamarca + Escócia** | 100 req/dia, todas as ligas, **só as temporadas 2022–2024** e janela de ontem a amanhã |
| Cobertura LatAm | ampla e com profundidade alta nas ligas de topo (§3). Estaduais, 2ª e 3ª divisões, sub-20 e feminino. **Lacunas:** olímpico sem ao vivo; Copa do Brasil e Sudamericana sem classificação; estaduais sem estatística avançada; Colômbia sem escalações | ampla em número de ligas (~1.175 segundo a comparação da própria Sportmonks, [fonte](https://www.sportmonks.com/football-api/alternatives/api-football/)). Profundidade varia por liga [ver doc api-sports] |
| Latência ao vivo | cerca de 15 s do lance à API. `/livescores/latest` em ciclo de 10 s. Só polling | atualização a cada 15 s em `fixtures?live`. Só polling |
| **TV Stations** | **Sim**: por jogo e por país, em todos os planos. Cobertura por país não documentada | **Não há** endpoint de canais |
| Odds e predições | add-on (com parceiro TXODDS no premium) | incluídas no plano |
| xG | add-on, em cerca de 60 ligas (inclui Série A, Libertadores, Liga MX, LPF, Copa do Mundo) | estatística "expected_goals" em algumas ligas [ver doc api-sports] |
| Histórico | 3 temporadas no self-serve, mais add-on pago uma vez. Completo no Enterprise | pago: todas as temporadas. Free: só 2022–2024 |
| SLA e suporte | 99,99% medida (sem SLA contratual padrão). Suporte humano 7 dias por semana. CS dedicado no Enterprise | sem uptime publicado. Suporte por e-mail e fórum |
| **Redistribuição** | Proibida sem aprovação, mas com **caminho explícito**: acordo Enterprise com aprovação escrita | **Proibida** ("não vender os dados diretamente"). Sem caminho de licença publicado |
| Logos e imagens | sem licença. O cliente prova a propriedade intelectual | sem licença. Uso só para identificação |

**Conclusão** [inferência]: para produção B2B com redistribuição, a Sportmonks é a única das duas com um caminho contratual claro. A api-sports segue útil como fonte de desenvolvimento ou de fallback interno, sem expor dado bruto a terceiros. A escolha final depende da cotação Enterprise e da validação de TV Stations em LatAm no trial.

---

## 7. Notas de migração: do espelho no formato api-sports para a Sportmonks

### 7.1 Mapeamento de entidades

| Espelho (formato api-sports) | Sportmonks v3 | Observações |
|---|---|---|
| `fixture.id` | `fixture.id` | **Espaços de ID diferentes.** Criar a tabela `provider_ids(entity, galaxie_id, provider, provider_id)`. Não reaproveitar IDs entre provedores |
| `fixture.date` / `timestamp` | `starting_at` (UTC, `YYYY-MM-DD HH:MM:SS`) / `starting_at_timestamp` | o parâmetro `timezone` altera a busca por data, então padronizar em UTC |
| `fixture.status.short` / `elapsed` | `state_id` (include `state`) / minuto via include `periods` [não verificado] | tabela 7.2 |
| `fixture.venue` | `venue_id` mais include `venue` | — |
| `league.id`, `league.season` (ano inteiro) | `league_id` mais **`season_id`** (entidade própria, nome "2026" ou "2025/2026") | **Diferença estrutural:** o espelho precisa mapear o par (liga, ano) para um `season_id` |
| `league.round` (texto) | `stage_id` (fase), `round_id`, `group_id`, `aggregate_id`, `leg` | a Sportmonks modela fase, rodada e grupo como entidades. Gerar o texto de rodada no espelho |
| `teams.home` / `teams.away` / `winner` | `participants[]` com `meta.location` (home ou away) e `meta.winner` | o `localTeam`/`visitorTeam` da v2 deixou de existir |
| `goals` / `score.halftime/fulltime/extratime/penalty` | include `scores[]` com `description`: `CURRENT`, `1ST_HALF`, `2ND_HALF`, `2ND_HALF_ONLY`, prorrogação e pênaltis, mais `participant` | montar o objeto `score` a partir das linhas |
| `events[]` (type e detail) | include `events`/`timeline` com `type_id` (resolver em `/core/types`), `minute`, `extra_minute`, `player_id`, `related_player_id`, `participant_id` | cachear `types`. Novos tipos: `DELAY_START` (132791) e `DELAY_END` (132792) |
| `lineups[]` (formation, startXI, substitutes) | includes `lineups` (titular ou reserva por `type_id`), `formations`, `coaches` | IDs de tipo de titular e reserva [não verificado], ler em `/core/types` |
| `statistics[]` (por time) | include `statistics` (por `participant_id`, `type_id`) | traduzir `type_id` para o nome da api-sports com uma tabela fixa |
| `players` (perfil e estatísticas) | `/players/{id}`. Estatísticas via `statistics.details` filtradas por `season_id` | posição em `position_id`/`detailed_position_id` (types) |
| `teams` / `venues` | `/teams/{id}` (`name`, `short_code`, `image_path`, `founded`, `venue_id`, `country_id`) / `/venues/{id}` | `country_id` aponta para o core (`/v3/core/countries`) |
| `standings` | `/standings/seasons/{id}` com `participant` e `details` (type_ids) e classificação ao vivo | a forma muda bastante. Normalizar no espelho |
| `odds` / `predictions` | endpoints de odds pré-jogo e ao vivo, e `predictions/probabilities` (add-ons) | — |
| (não existe) `tv` | include `tvStations.tvStation;tvStations.country` | **campo novo no espelho:** `broadcasts[{country, station, source:"sportmonks"}]` |

### 7.2 Mapeamento de status

Sportmonks `state_id` para o `status.short` da api-sports. Lista oficial de 25 estados, checada pela Sportmonks em 2026-10-15 ([states](https://docs.sportmonks.com/v3/definitions/states)).

| state_id | Sportmonks | api-sports | Nota |
|---|---|---|---|
| 1 | NS | NS | — |
| 2 | INPLAY_1ST_HALF | 1H | — |
| 3 | HT | HT | — |
| 22 | INPLAY_2ND_HALF | 2H | — |
| 4 | BREAK | BT | intervalo antes da prorrogação [inferência] |
| 6 / 23 | INPLAY_ET / INPLAY_ET_2ND_HALF | ET | — |
| 21 | EXTRA_TIME_BREAK | BT | — |
| 25 | PEN_BREAK | BT | — |
| 9 | INPLAY_PENALTIES | P | `short_name` "PEN" se repete no estado 26: **nunca usar short_name como chave** |
| 5 / 7 / 8 | FT / AET / FT_PEN | FT / AET / PEN | — |
| 10 | POSTPONED | PST | — |
| 11 | SUSPENDED | SUSP | — |
| 18 | INTERRUPTED | INT | — |
| 12 | CANCELLED | CANC | — |
| 13 | TBA | TBD | — |
| 14 | WO | WO | — |
| 15 | ABANDONED | ABD | — |
| 17 | AWARDED | AWD | — |
| 16 | DELAYED | NS (com flag `delayed`) | não existe na api-sports. Decisão de produto |
| 19 | AWAITING_UPDATES | FT provisório (com flag) | decisão de produto |
| 26 | PENDING | TBD | decisão de produto |
| 20 | DELETED | remover ou ocultar | — |

Os estados de jogo em andamento são 2, 22, 6, 23 e 9 (filtro `fixtureStates`). A doc avisa que um estado final **ainda pode receber correções**, então manter o reprocessamento.

### 7.3 O que a interface de provedor precisa tratar

- **Construtor de requisição:**
  - `include` com `;` entre itens, `.` para aninhar e `:` para selecionar campos;
  - `select`, `filters` (com `;` entre filtros e `,` entre valores), `order`, `locale` e `timezone`;
  - validação local, para evitar os erros 5001 e 5004;
  - um "perfil de include" por caso de uso (lista ao vivo, detalhe do jogo, onde assistir).
- **Paginação:**
  - a Sportmonks usa **cursor** (`cursor`/`next_cursor`/`has_more`, desde 2026-06-05). `per_page` vai de 1 a 50 e **não pode ser combinado com `cursor`**;
  - a paginação por offset é rejeitada acima de 20.000 linhas (2026-06-23);
  - a api-sports usa `page`/`paging.total`. A interface deve expor um **iterador assíncrono** e esconder o mecanismo.
- **Rate limit:**
  - **um token bucket por entidade** (Fixture, Team, Player, League, Season, Type, Venue, Coach, Referee, Resource...), com janela de 1 h a partir da primeira chamada;
  - ler `rate_limit.remaining`/`resets_in_seconds` do **corpo** da resposta;
  - tratar 429 por entidade com backoff;
  - a api-sports tem limite **diário e por minuto** e lê os headers `x-ratelimit-*`. A abstração precisa de uma estratégia de quota plugável por provedor.
- **Escopo do plano:**
  - 403 e resultado vazio podem significar "fora da assinatura", e não "sem dados";
  - manter um registro das ligas assinadas (`/my/leagues`, que **consome cota** da entidade League).
- **Sincronização ao vivo:**
  - `/livescores/latest` a cada 10 s para detectar mudanças;
  - depois, `/fixtures/multi/{ids}` (até 50) com includes completos, só para os jogos que mudaram;
  - reconciliação periódica com `/fixtures/between` (até 100 dias) e `/fixtures/latest`;
  - importação incremental com o filtro `IdAfter`.
- **Cache de referência:**
  - cachear `/core/types`, `/states`, países, ligas, temporadas e estádios por horas ou um dia;
  - usar o cache em vez de pedir `include=type`. É a recomendação oficial, que corta de 50 a 80% das chamadas;
  - buscar sob demanda apenas os IDs desconhecidos.
- **Identidade e temporada:**
  - tabela de IDs entre provedores;
  - conversão de `season` (ano) para `season_id`;
  - montagem do texto de rodada a partir de fase, rodada e grupo.
- **Normalização de placar e eventos:**
  - montar `goals`/`score` a partir de `scores[]`;
  - traduzir `type_id` com uma tabela versionada.
- **Fuso horário:** sempre UTC na ingestão. O `timezone` só entra na apresentação.
- **Mídia:** não repassar `image_path` de terceiros aos clientes sem licença (flag por provedor).
- **Observabilidade:**
  - registrar o consumo por entidade;
  - medir a latência de mudança (`/latest` contra o relógio);
  - medir a cobertura de `tvstations` por país.

---

## 8. Itens não verificados e conflitos (checklist para o trial e a negociação)

1. **Lista de países e ligas com TV Stations**, além do prazo e da precisão em BR, AR, MX, CO, CL, PE, UY e EC. Também o significado de `type` e `related_id`.
2. **Preço Enterprise** com redistribuição B2B e white-label para N clientes, mais a regra de preço "por domínio" aplicada a uma API B2B.
3. Se o contrato padrão exige **apagar os dados após o cancelamento**. Os termos não dizem.
4. Se o Pro aceita um caso de uso "em análise" durante o trial sem violar os termos. Pedir confirmação escrita antes de expor dados a clientes.
5. **Trial com ou sem cartão.** As páginas oficiais se contradizem.
6. **Limite do Free:** 3.000 por entidade por hora (doc de rate limit) ou 2.000 por endpoint (FAQ antigo).
7. **Preço do xG:** bundle de €24–29 na página de preços, contra xG Basic de €19 a €99 e Advanced de €199 a €399 na doc. Também o preço do bundle Odds & Predictions (€15 ou €24).
8. Se copas, supercopas e fases contam como "liga" no limite de 5, 30 ou 120 ligas. E qual é o limite mensal de trocas de liga.
9. **Sudamericana sem classificação** na página de cobertura (provável erro). **Eliminatórias CONCACAF sem ao vivo.** **Liga BetPlay sem escalações.**
10. **Futebol olímpico:** só calendário. Confirmar se haverá ao vivo nos próximos Jogos.
11. Idioma das notícias e se há localização em pt-BR ou es (o parâmetro `locale` está em beta).
12. Minuto de jogo (`periods`) e IDs de tipo de escalação e eventos: validar com respostas reais.
13. Um diretório de terceiros lista "Websocket", mas a doc oficial diz que só há polling.
14. Direito de uso **em transmissão** (grafismo on-air): não tratado nos documentos.

---

## Fontes

Oficiais (Sportmonks):
- Planos e preços do futebol: https://www.sportmonks.com/football-api/plans-pricing/
- Plano Free: https://www.sportmonks.com/football-api/free-plan/
- Plano Enterprise (v2): https://www.sportmonks.com/football-api/enterprise-plan-v2/
- Termos de serviço: https://www.sportmonks.com/terms-of-service/
- Integridade, segurança e uso permitido: https://www.sportmonks.com/integrity-support/
- FAQ: https://www.sportmonks.com/faq/
- Cobertura de ligas (atualizada em 2026-10-12): https://www.sportmonks.com/football-api/coverage/
- Blog da nova precificação (2026-03-06 a 09): https://www.sportmonks.com/blogs/introducing-our-new-pricing-setup/
- Preços de críquete: https://www.sportmonks.com/cricket-api/plans-pricing/ · Cricket API: https://www.sportmonks.com/cricket-api/
- Formula One API: https://www.sportmonks.com/formula-one-api/
- Comparação com a API-Football (feita pela Sportmonks, viés comercial): https://www.sportmonks.com/football-api/alternatives/api-football/
- Docs, índice: https://docs.sportmonks.com/llms.txt
- Docs, autenticação: https://docs.sportmonks.com/v3/welcome/authentication
- Docs, rate limit: https://docs.sportmonks.com/v3/api/rate-limit
- Docs, paginação: https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/introduction/pagination
- Docs, changelog: https://docs.sportmonks.com/v3/changelog/changelog
- Docs, states: https://docs.sportmonks.com/v3/definitions/states
- Docs, TV Stations: https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/tv-stations · include: https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/includes/tv-stations · todas as emissoras: https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/tv-stations/get-all-tv-stations
- Docs, livescores: https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/livescores-and-fixtures/livescores · latest: https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/livescores/get-latest-updated-livescores
- Docs, best practices: https://docs.sportmonks.com/v3/welcome/best-practices
- Docs, includes: https://docs.sportmonks.com/v3/api/request-options/includes · participants: https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/includes/participants · scores: https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/includes/scores
- Docs, erros de complexidade: https://docs.sportmonks.com/v3/api/error-codes/filtering-and-complexity-exceptions
- Docs, timezone: https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/timezone-parameters-on-different-endpoints
- Docs, cobertura de xG: https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/expected/coverage
- Docs, notícias pré-jogo: https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/news/pre-match-news
- Docs, Motorsport: https://docs.sportmonks.com/v3/motorsport-api/welcome/welcome
- Docs, fixtures por vários IDs e por intervalo de datas: https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/fixtures/get-fixtures-by-multiple-ids · https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/fixtures/get-fixtures-by-date-range

Terceiros:
- Fórum ANWP (relato de usuário, sem data): https://support.anwp.pro/communities/1/topics/1528-api-import-add-sportmonks-football-api
- sportsapis.dev (listagem que menciona "Websocket", não confirmado): https://sportsapis.dev/apis/sportmonks

Internas: `docs/research/api-sports-football.md` e `docs/research/onde-assistir.md`.
