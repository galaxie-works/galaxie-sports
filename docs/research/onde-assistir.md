# Pesquisa: "Onde assistir" / "Dónde ver" por país

> Data da pesquisa: 2026-10-21. Mercados: BR (pt-BR), AR, MX, CO, CL, PE, UY, EC.
> Legenda: **[verificado]** = fonte citada confirma; **[incerto]** = fontes divergentes ou de baixa qualidade; **[não verificado]** = sem fonte.
> Política editorial deste documento: algumas operadoras de TV paga foram omitidas por decisão do produto e aparecem como **"operadora de TV paga (omitido)"**.

---

## 1. Fontes existentes de grade de transmissão

| Fonte | Cobertura por país | Formato | Termos / risco | Confiabilidade | Uso recomendado |
|---|---|---|---|---|---|
| **LiveSoccerTV** | Global, com páginas por país e competição ([exemplo canal ESPN BR](https://www.livesoccertv.com/channels/espn-br/)) | HTML. Não achei API ou feed licenciável | Os termos responderam 403 e não consegui ler. **Assuma que scraping é proibido** até ler os termos. Há páginas desatualizadas (citava LaLiga na ESPN Brasil "até 2026") | Média: bom para futebol europeu, mais fraco em ligas locais LatAm | Só verificação humana ou contato comercial |
| **ge.globo (agenda)** | Brasil: Globo, SporTV, Premiere, GE TV + terceiros | HTML (não consegui buscar a página) | Conteúdo editorial da Globo. **Scraping arriscado.** Lembre que a Globo é parte interessada (detentora) | Alta para jogos da Globo. A transmissão em TV aberta **varia por praça/região** ([Olhar Digital](https://olhardigital.com.br/2026/04/26/internet-e-redes-sociais/jogos-de-hoje-26-04-26-onde-assistir-futebol-ao-vivo-e-horarios-das-partidas/)) | Evidência para o agente (com link), não ingestão em massa |
| **Agendas jornalísticas diárias** (Olhar Digital, 90min, Goal, Infobae, Publimetro, La República etc.) | Por país | HTML | Conteúdo protegido por direito autoral. Citar e linkar, não copiar | Média. Erros de última hora são comuns | Evidência secundária para o agente |
| **ESPN, Disney+, TNT/HBO Max, Paramount+, Prime Video, ViX, CazéTV (grades oficiais)** | Cada um no seu território | HTML/app. Algumas ajudas oficiais listam competições ([HBO Max MX – Champions](https://help.hbomax.com/mx-es/answer/detail/000002560)) | Fonte primária e mais confiável para "o canal X passa o jogo Y". Scraping sujeito aos termos de cada site | **Alta** | Evidência primária preferida |
| **FlashScore (aba TV)** | Global | HTML/JSON interno | Os termos (versão .ae) proíbem copiar ou distribuir conteúdo sem autorização escrita ([Livesport terms](https://livesport.eu/terms/flashscore_ae)). **Alto risco** | Média | Não usar em produção |
| **Sofascore (TV Channels)** | Global. Canais **sugeridos e votados por usuários** ([exemplo](https://www.sofascore.com/football/match/levski-sofia-aek-athens/apbsypb)) | JSON interno não oficial | Sem API pública. Scrapers de terceiros existem, mas **é ToS-risk** | Média-baixa (crowdsourced) | Só sinal fraco, nunca fonte única |
| **FotMob TV Guide** | Por país ([AR](https://www.fotmob.com/pt-PT/tv-guide/ar), [MX](https://www.fotmob.com/es-419/tv-guide/mx), [BR](https://www.fotmob.com/hi/tv-guide/br)) | HTML | Sem licença de reuso | Média. Páginas com meses de atraso | Sinal fraco |
| **Futbol en la TV** (futbolenlatv.com / .es, WOSTI 2020 SL) | Forte na Espanha, com algumas páginas LatAm ([Genbeta](https://www.genbeta.com/web/futbolenlatv-cuando-y-en-que-cadena-emiten-los-partidos-de-futbol/amp)) | HTML/app | Sem API pública. **ToS-risk** | Boa para Espanha. Cobertura AR/MX **[incerto]** | Sinal secundário. Contatar para licença se for relevante |
| **JustWatch Sports** ([sports.justwatch.com](https://sports.justwatch.com)) | 26 países, **inclui BR, AR e MX. Não inclui CO, CL, PE, UY, EC.** Ligas europeias e F1 desde 2022 ([TodoTV](https://todotvnews.com/en/justwatch-launches-sports-guide-in-spain-and-select-european-markets/)) | Web/app. API só por parceria (JustWatch PRO), sem doc pública de esportes | Uso comercial exige contrato | Boa para streaming, fraca em TV aberta e ligas locais | Candidato a parceria comercial (BR/AR/MX) |
| **Gracenote (Nielsen) – On API / Sports + TV Listings** | Grade de TV em 85+ países. "Gracenote On Sports" une dados esportivos, calendários e **links de onde assistir** (75+ esportes, 340 ligas, 50+ países), segundo material de 2026 ([Gracenote](https://gracenote.com/?p=1554285), [doc XML TV Listings](https://xmldocs.sports.gracenote.com/XML-TV-Listings-Feed_1048764.html), [On API](https://documentation.gracenote.com/on-api/html/Content/dev-guide/About%20the%20On%20API.htm)) | API/XML licenciados | Contrato comercial: é o caminho **legalmente limpo** | Alta (é o padrão de EPG em smart TVs e operadoras) | **Melhor opção comercial** se o orçamento permitir. Confirmar cobertura LatAm, que não está documentada publicamente |
| **Abelson Info** | Feed comercial de listagens esportivas em TV, OTT e streaming (clientes como LiveScore e Betway) ([SBC News](https://www.sbcnews.co.uk/europe/2021/06/08/abelson-info-strikes-tv-listings-partnership-with-livescore-and-virgin-bet/)) | API | Contratual | Foco Reino Unido e Europa. LatAm **[não verificado]** | Alternativa a cotar |
| **EPG XMLTV** (iptv-org/epg, XMLTV grabbers) | Milhares de canais, LatAm parcial ([ArchWiki](https://wiki.archlinux.org/title/Iptv.org_EPG_Grabber), [tv_grab_ar](https://manpages.org/tv_grab_ar)) | XMLTV | Os grabbers **raspam sites de operadoras**, então herdam o risco de ToS de cada origem. São frágeis | Baixa a média. Títulos de programa genéricos ("Fútbol en vivo") | Só para casar canal e horário como evidência auxiliar |
| **Organizadores** | UEFA publica "Where to watch" por país ([UEFA 2026/27](https://www.uefa.com/uefachampionsleague/news/0253-0d82037aaedd-f371c464f919-1000--where-to-watch-the-champions-league/)). CONMEBOL e FIFA divulgam licenciados em releases ([FIFA](https://inside.fifa.com/media-releases/fifa-world-cup-2026-media-rights-awarded-in-the-nordic-territories)). LaLiga e Premier divulgam acordos | HTML/press releases | Informação pública e factual (quem detém direitos). Baixo risco para citar | **Alta para "quem detém o direito"**, baixa para "qual canal passa o jogo X" | Base da tabela de direitos por competição e país |

**Conclusão honesta sobre ToS:** quase todos os agregadores gratuitos (LiveSoccerTV, FlashScore, Sofascore, FotMob, Futbol en la TV) **não oferecem licença de reuso**, e raspá-los para um produto comercial é risco jurídico e técnico. O caminho sustentável tem três camadas:
1. **Tabela de direitos** (competição × país × temporada), mantida a partir de releases oficiais.
2. **Agente com busca na web** que confirma o jogo específico em fontes primárias (grade do broadcaster) e **guarda apenas fatos + URL**, sem copiar conteúdo.
3. Opcionalmente, um **feed licenciado** (Gracenote, JustWatch ou Abelson) para escala.

---

## 2. Panorama de direitos 2026 (nível "quem detém")

> Fatos de mercado mudam rodada a rodada. Valide sempre no jogo específico.

### 2.1 Brasil

| Competição | Detentores 2026 | Notas / fontes |
|---|---|---|
| **Brasileirão Série A** | **Globo** (TV aberta, 1 jogo por rodada), **SporTV** (fechada), **Premiere** (PPV), **GE TV** (YouTube, alguns jogos da Libra), **Record + CazéTV** (1 jogo por rodada em cotransmissão, escolhido entre clubes da LFU/FFU), **Prime Video** (1 jogo exclusivo por rodada) | Pela Lei do Mandante, quem define a plataforma é o clube mandante. A Libra está com a Globo ([Lance!](https://www.lance.com.br/lance-negocios/onde-assistir-ao-brasileirao-2026-entenda-divisao-dos-direitos-de-transmissao.html), [Meio & Mensagem](https://www.meioemensagem.com.br/midia/brasileirao-2026-onde-assistir-e-patrocinadores)). **[incerto]** se o Premiere tem os 380 jogos ou só os da Globo |
| **Copa do Brasil** | **Globo** (aberta), **SporTV**, **Premiere**, **Prime Video** (alguns jogos exclusivos), **GE TV** | 2027–30: Globo (aberta + multiplataforma) e Amazon + ESPN (pacote multiplataforma). A participação da ESPN é **[incerto]** ([Bem Paraná](https://www.bemparana.com.br/esportes/copa-do-brasil-chega-a-r-4-bilhoes-em-direitos-com-espn-globo-e-amazon/), [ABCdoABC](https://abcdoabc.com.br/copa-do-brasil-confira-toda-as-transmisso)) |
| **Libertadores** | **Globo** (aberta, quartas e quintas, + GE TV), **ESPN / Disney+** (pago e streaming), **Paramount+** (jogos exclusivos na fase de grupos) | Ciclo 2023–26 ([Máquina do Esporte](https://maquinadoesporte.com.br/futebol/globo-espn-e-paramount-garantem-direitos-de-transmissao-da-libertadores), [Jornal Opção](https://www.jornalopcao.com.br/ultimas-noticias/libertadores-2026-comeca-com-seis-brasileiros-em-campo-confira-jogos-e-transmissoes-812500/)). 2027–30: Globo (aberta) + ESPN (pago) ([Sportcal](https://www.sportcal.com/media/globo-and-espn-keep-copa-libertadores-and-sudamericana-rights-until-2030/)). Final em 28/11/2026 |
| **Sul-Americana** | **ESPN / Disney+**, **Paramount+**. SBT em TV aberta é **[incerto]** | Fontes fracas ([FotMob BR](https://www.fotmob.com/hi/tv-guide/br)). 2027–30: Warner Bros. Discovery (aberta) + Disney (pago) ([Sportcal](https://www.sportcal.com/media/globo-and-espn-keep-copa-libertadores-and-sudamericana-rights-until-2030/)) |
| **Premier League** | **ESPN / Disney+** (380 jogos). CazéTV aparece em uma tabela **[incerto]** | ESPN até 2027/28, estendido até 2030/31 segundo listagem secundária ([LiveSoccerTV](https://www.livesoccertv.com/channels/espn-br/), [Digital Trends](https://es.digitaltrends.com/deportes/derechos-transmision-ligas-europeas-2026-27-america-latina/)) |
| **LaLiga** | **CazéTV**, por 6 temporadas a partir de 2026/27 | Anúncio de maio de 2026 ([Digital Trends](https://es.digitaltrends.com/deportes/derechos-transmision-ligas-europeas-2026-27-america-latina/)) |
| **Champions League** | **TNT Sports + HBO Max** (Warner Bros. Discovery). **SBT** com 1 jogo por rodada na TV aberta em 2025/26. Em 2026/27 é **[incerto]** | WBD também em 2027–31 ([TAVI](https://tavilatam.com/en/latin-america-champions-league-broadcast-rights-awarded-to-disney-and-paramount-in-spanish-speaking-latin-america-and-to-warner-bros-discovery-in-brazil/), [Trivela](https://trivela.com.br/europa/champions-league/onde-assistir-a-champions-league-2025-26-confira-a-transmissao-dos-jogos/)) |
| **Copa do Mundo 2026** (11/06–19/07, encerrada) | **CazéTV** (YouTube, **104 jogos**, também via Prime Video **[incerto]**), **Globo/SporTV/Globoplay** (~54–55 jogos), **SBT + N Sports** (32), **GE TV** (32) | [Poder360](https://www.poder360.com.br/copa-2026/saiba-onde-assistir-a-todos-os-jogos-da-copa-do-mundo/), [O Povo](https://www.opovo.com.br/esportes/futebol/copa-do-mundo/2026/06/04/onde-assistir-ao-vivo-a-copa-do-mundo-de-2026-saiba-quem-vai-transmitir.html), [DPL News](https://dplnews.com/guia-donde-puedo-ver-mundial-futbol-2026-america-latina/) |

### 2.2 Países hispânicos

| Competição | AR | MX | CO / CL / PE / UY / EC |
|---|---|---|---|
| **Libertadores 2026** | **Fox Sports + Disney+ Premium** ([Unanimo](https://unanimodeportes.com/deportes/futbol/copa-libertadores/donde-ver-jornada-6/), [Líbero](https://libero.pe/futbol-internacional/copa-libertadores/2026/02/22/canal-confirmado-ver-sporting-cristal-vs-2-de-mayo-copa-libertadores-2026-donde-ver-transmision-820534)) **[incerto]** | **[não verificado]**. A Fox Sports MX publica guias ([Fox Sports MX](https://www.foxsports.com.mx/2026/05/26/partidos-hoy-martes-26-de-mayo-2026-en-vivo-donde-ver-copa-libertadores-y-sudamericana-en-mexico/)) | **ESPN + Disney+** como pago principal. No ciclo 2023–26 a Paramount ficou com a TV aberta regional e a OneFootball com os highlights ([Sportcal](https://www.sportcal.com/media/paramount-espn-onefootball-take-over-regional-rights-to-libertadores-for-2023-26/)). Canais abertos por país **[incerto]** |
| **Sul-Americana 2026** | ESPN / Disney+ ([Gestión](https://gestion.pe/mix/sports/espn-en-vivo-gratis-donde-ver-partido-boca-juniors-vs-0higgins-online-por-disney-plus-premium-por-vuelta-de-playoffs-de-copa-sudamericana-2026-nnda-nnrt-noticia/)) + operadora de TV paga (omitido) | [não verificado] | ESPN / Disney+ + operadora de TV paga (omitido). Paramount+ e DAZN em alguns jogos **[incerto]** ([Expreso](https://www.expreso.com.pe/deportes/partidos-de-hoy-martes-28-de-julio-de-2026-horarios-canales-de-tv-y-plataformas-para-ver-en-vivo-futbol-copa-sudamericana-programacion-pronostico-champions-league-noticia/1304488/)) |
| **Premier League 2026/27** | **ESPN / Disney+** (380 jogos) | **TNT Sports + FOX** | **ESPN / Disney+** ([Digital Trends](https://es.digitaltrends.com/deportes/derechos-transmision-ligas-europeas-2026-27-america-latina/)) |
| **LaLiga 2026/27** | **ESPN / Disney+ Premium** (190 jogos por temporada, até 2031/32) + operadora de TV paga (omitido) | Operadora de TV paga (omitido) + **Canal 5** (Televisa) | Igual à AR ([Digital Trends](https://es.digitaltrends.com/deportes/derechos-transmision-ligas-europeas-2026-27-america-latina/)) |
| **Champions League 2026/27** (último ano do ciclo 2024–27) | **ESPN / Disney+** | **TNT Sports + HBO Max** (terças), **FOX + Fox One** (quartas) | **ESPN / Disney+**. **2027–31:** Disney (ESPN/Disney+) e **Paramount+** dividem 50/50 na América hispânica e no México ([TAVI](https://tavilatam.com/en/latin-america-champions-league-broadcast-rights-awarded-to-disney-and-paramount-in-spanish-speaking-latin-america-and-to-warner-bros-discovery-in-brazil/), [Eje Central](https://www.ejecentral.com.mx/nuestro-eje/transmision-champions-league-en-mexico-paramount-y-espn-disney-adquieren-los-derechos-a-partir-de-cuando-pasaran-los-partidos)) |
| **Liga Profesional Argentina** | **ESPN Premium + TNT Sports Premium** (metade dos jogos de cada rodada em cada um, vendidos no "Pack Fútbol"). TNT até 2031, ESPN até 2030 (fonte única) ([TAVI](https://tavilatam.com/en/argentina-tnt-sports-renews-deal-with-afa-to-extend-broadcasting-rights-for-local-soccer-league-until-2031/), [442](https://442.perfil.com/noticias/futbol/futbol-libre-en-2026-las-3-alternativas-para-ver-los-partidos-sin-cortes.phtml)) | — | Fora da AR: Fanatiz é citado como opção autorizada **[incerto]** |
| **Liga MX Apertura 2026** | — | **Direitos por clube (mandante):** TUDN/Televisa/ViX (América, Atlas, Cruz Azul, Monterrey…), **TV Azteca** (Atlante e outros), **FOX** (~9 clubes, ex.: León, Pachuca, e compartilhado com Juárez, Necaxa, Puebla), **Prime Video** (Chivas, exclusivo), **ESPN / Disney+ / ViX** (Atlético San Luis). Fontes divergem em Tigres, Toluca e Puebla ([Excélsior](https://www.excelsior.com.mx/deportes/liga-mx-donde-ver-partidos-apertura-2026), [Publimetro](https://www.publimetro.com.mx/deportes/2026/07/16/donde-ver-todos-los-partidos-del-apertura-2026-en-la-liga-mx/), [Infobae](https://www.infobae.com/mexico/deportes/2026/07/10/estos-son-los-canales-que-transmitirian-a-los-equipos-de-la-liga-mx-durante-el-apertura-2026/)) | — |

### 2.3 Copa do Mundo 2026 (encerrada em 19/07/2026): quem transmitiu

| País | TV aberta | Pago / streaming | Fontes |
|---|---|---|---|
| **AR** | **TV Pública** (jogos da Argentina) e **Telefe** (~32 jogos) | **TyC Sports** (~52 jogos), operadora de TV paga (omitido) com os 104, **Disney+ Premium**, **Paramount+** | [El Economista](https://eleconomista.com.ar/deportes/donde-ver-mundial-2026-vivo-tv-streaming-todos-partidos-n95666), [Cultura Geek](https://culturageek.com.ar/donde-ver-final-mundial-2026/) |
| **MX** | **Televisa** (Canal 5, Las Estrellas) e **TV Azteca** (Azteca 7, Azteca Uno), ~32 jogos em aberto cada, mesmos jogos | **ViX Premium** (104 jogos). Televisa(Univision) detinha os direitos completos | [Por Esto](https://www.poresto.com/deportes/2025/12/7/donde-ver-el-mundial-2026-en-mexico-canales-plataformas-y-precios-confirmados.html), [Expansión](https://expansion.mx/tendencias/2026/06/09/donde-se-transmite-mundial-2026-mexico). **[incerto]**: a S&P diz que Televisa e Azteca exibiriam "todos" os jogos em aberto ([S&P Global](https://www.spglobal.com/market-intelligence/en/news-insights/research/2026/06/fifa-world-cup-2026-set-for-record-commercial-impact)) |
| **CO** | **Caracol** e **RCN** (incluindo os 3 jogos da Colômbia na fase de grupos). Win Sports **[incerto]** | **ESPN / Disney+** (40 jogos), operadora de TV paga (omitido) com os 104, **Paramount+** | [Publimetro CO](https://www.publimetro.co/deportes/2026/05/06/mas-competencia-para-rcn-y-caracol-ademas-de-espn-otro-canal-transmitiria-los-104-partidos-del-mundial/), [Canal Trece](https://canaltrece.com.co/noticias/donde-ver-los-partidos-de-colombia-en-el-mundial-2026/) |
| **CL** | **Chilevisión** (quantidade não informada) | Operadora de TV paga (omitido), **Disney+**, **Paramount+** | [DPL News](https://dplnews.com/guia-donde-puedo-ver-mundial-futbol-2026-america-latina/) |
| **PE** | **América TV** (40 jogos, canal 4 + América tvGO) | Operadora de TV paga (omitido) com os 104, **Disney+ Premium**, **Paramount+** | [La República](https://larepublica.pe/deportes/2026/06/15/que-partidos-del-mundial-2026-se-veran-en-senal-abierta-en-vivo-por-america-tv-en-peru-1252710), [América TV](https://www.americatv.com.pe/deportes/futbol-mundial/partidos-que-pasa-america-tv-octavos-final-mundial-2026-vivo-y-gratis-n455040) |
| **UY** | **Canal 5** (público, 32 jogos, incluindo todos os do Uruguai, abertura e final), também na **Antel TV** | Operadora de TV paga (omitido) e **Paramount+** (104), **Disney+** (30) | [El Observador](https://www.elobservador.com.uy/cultura-y-espectaculos/el-mundial-2026-segun-la-television-uruguaya-asi-sera-la-cobertura-los-canales-abiertos-el-torneo-n6046066), [Montevideo Portal](https://www.montevideo.com.uy/Pantallazo/Canal-5-transmitira-el-Mundial-2026-con-equipo-propio-y-senal-abierta-uc957075) |
| **EC** | **Teleamazonas** (alguns jogos) | Operadora de TV paga (omitido), **Disney+**, **Paramount+** | [DPL News](https://dplnews.com/guia-donde-puedo-ver-mundial-futbol-2026-america-latina/) |

**Não levantado nesta pesquisa:** direitos internacionais do Brasileirão e da Copa do Brasil nos países hispânicos; Libertadores e Sul-Americana no México; TV aberta da Liga Profesional Argentina.

---

## 3. Desenho do serviço "Onde assistir" assistido por IA

### 3.1 Visão geral

```
[rights_table] (competição × país × temporada, curada a partir de releases oficiais)
        │  prior: quem PODE transmitir
        ▼
[scheduler] → gera jobs (event_id, country) em T-7d, T-24h, T-3h, T-30min (+ T+0 para "ao vivo")
        ▼
[resolver agent]  LLM + web search/fetch com allowlist de domínios por país
   1. monta consultas pt/es ("onde assistir {mandante} x {visitante} {data}", "dónde ver ... {país}")
   2. prioriza fontes primárias (site/app do broadcaster, organizador) > imprensa > agregadores
   3. extrai opções estruturadas (JSON schema abaixo) + trecho-evidência curto + URL
   4. NUNCA inventa: opção sem URL de evidência é descartada
        ▼
[validator / merger]
   - normaliza broadcaster via catálogo (aliases: "Disney+ Premium", "Disney Plus" → disney_plus)
   - checa contra rights_table (broadcaster não detentor ⇒ confiança ↓ ou descarte)
   - dedupe por (event_id, country, broadcaster_id, region)
   - resolve conflitos (regra abaixo)
   - aplica blocklist editorial (broadcasters omitidos por política do produto)
        ▼
[store] broadcast_option (+ histórico de versões) ──► API /events/{id}/where-to-watch?country=BR
        ▼
[monitor] métricas, amostragem para revisão humana, feedback de usuários ("não está passando aqui")
```

### 3.2 Regras de resolução

- **Score de confiança (0–1):**
  - fonte primária do broadcaster ou organizador = 0,9
  - imprensa grande = 0,7
  - agregador ou crowdsourced = 0,4
  - +0,1 se for consistente com a `rights_table`
  - +0,1 se duas fontes independentes concordam
  - −0,3 se a fonte tiver mais de 72 h para jogo de liga com escolha por rodada
  - limite final em 1,0
- **Publicar** só com `confidence ≥ 0,7`. Entre 0,5 e 0,7 a opção fica guardada como `pending` e não aparece, ou aparece como "a confirmar" se o produto quiser. Abaixo de 0,5, descartar.
- **Conflito:** se duas fontes primárias divergem (ex.: Globo aberta vs. não), marque `conflict=true` e **omita** a opção até a próxima rodada de checagem. Nunca mostre informação contraditória.
- **Regionalização:** a TV aberta no Brasil varia por praça. O campo `region` aceita UF ou praça ("SP", "RJ", "MG", "nacional"). No México e na Argentina use `nacional` salvo evidência regional.
- **Política editorial:** uma blocklist de broadcasters é aplicada no merger. Opções bloqueadas nunca chegam à API pública.
- **Custo:** o job de T-7d e T-24h faz a busca completa. T-3h e T-30min só **revalidam as URLs já salvas** (fetch + diff) e só fazem busca nova se houver mudança ou faltar opção.

### 3.3 Cadência de atualização

| Momento | Objetivo |
|---|---|
| Ao criar o evento / T-7d | Preencher a partir da `rights_table` (prior) + primeira busca |
| **T-24h** | Busca completa. A maioria das escolhas por rodada (ex.: Globo, Record/CazéTV, Prime) já foi anunciada |
| **T-3h** | Revalidação: mudanças de última hora, jogos remanejados |
| **T-30min** | Revalidação final e `last_verified` fresco para o selo "verificado há X min" |
| Pós-jogo | Congelar o snapshot (útil para avaliação e histórico) |

### 3.4 JSON Schema: opção de transmissão

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://galaxie.works/schemas/broadcast-option.json",
  "title": "BroadcastOption",
  "type": "object",
  "required": ["event_id", "country", "broadcaster", "type", "source_url", "confidence", "last_verified", "status"],
  "properties": {
    "event_id":    { "type": "string" },
    "country":     { "type": "string", "pattern": "^[A-Z]{2}$", "description": "ISO 3166-1 alpha-2: BR, AR, MX, CO, CL, PE, UY, EC" },
    "region":      { "type": "string", "default": "national", "description": "UF/praça (BR) ou 'national'" },
    "broadcaster": {
      "type": "object",
      "required": ["id", "name"],
      "properties": {
        "id":   { "type": "string", "description": "id canônico do catálogo, ex.: globo, sportv, espn, disney_plus" },
        "name": { "type": "string" },
        "channel": { "type": "string", "description": "ex.: 'ESPN 2', 'Canal 5', 'Azteca 7'" }
      }
    },
    "type": { "enum": ["free_to_air", "pay_tv", "streaming", "ppv", "youtube", "official_app", "radio"] },
    "access": { "enum": ["free", "subscription", "ppv", "free_with_ads"] },
    "language": { "type": "string", "examples": ["pt-BR", "es-419"] },
    "watch_url": { "type": ["string", "null"], "format": "uri" },
    "source_url": { "type": "string", "format": "uri" },
    "source_kind": { "enum": ["broadcaster", "organizer", "press", "aggregator", "rights_table"] },
    "evidence": { "type": "string", "maxLength": 280, "description": "trecho curto parafraseado/citado da fonte" },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "conflict": { "type": "boolean", "default": false },
    "status": { "enum": ["published", "pending", "rejected", "expired"] },
    "first_seen": { "type": "string", "format": "date-time" },
    "last_verified": { "type": "string", "format": "date-time" },
    "verified_by": { "enum": ["agent", "human", "feed"] },
    "model_run_id": { "type": "string" }
  },
  "additionalProperties": false
}
```

Chave de dedupe: `(event_id, country, region, broadcaster.id, type)`.

### 3.5 Como avaliar a precisão

1. **Gold set:** 200–300 pares (jogo, país) por mês, estratificados por competição e país, rotulados por humanos após o jogo com a grade real (prints e URLs oficiais). Prioridade: Brasileirão (por praça), Liga MX (por clube), Libertadores e Champions.
2. **Métricas:**
   - **Precisão** (opções publicadas corretas / publicadas). Meta ≥ 97%, porque errar é pior que omitir.
   - **Recall** (opções reais encontradas / opções reais). Meta ≥ 85%, ≥ 95% para TV aberta.
   - **Cobertura** (% de pares com ao menos 1 opção publicada).
   - **Calibração:** curva confiança × acerto. Ajustar os pesos do score.
   - **Frescor:** `now - last_verified` no kickoff.
   - **Taxa de conflito e de mudança de última hora** (T-3h vs. T-24h).
3. **Testes de regressão do agente:** casos fixos com respostas conhecidas (fixtures de páginas salvas) para trocar modelo ou prompt sem regressão.
4. **Sinal de produção:** botão "isso está errado?" + revisão humana por amostragem (ex.: 5% das opções publicadas e 100% das com `confidence` entre 0,7 e 0,75).
5. **Auditoria de fonte:** % de opções publicadas com `source_kind = broadcaster|organizer`. Meta ≥ 60%.

### 3.6 Riscos e mitigação
- **ToS e direitos autorais:** guardar só fatos (canal, horário) + URL. Não copiar texto nem raspar agregadores proibidos. Respeitar robots.txt e limites de taxa. Para escala, licenciar feed (Gracenote, JustWatch ou Abelson).
- **Alucinação:** schema estrito, evidência obrigatória, checagem contra a `rights_table`, publicação só acima do limiar.
- **Mudança de ciclo de direitos:** em 2027 entram novos contratos (Copa do Brasil 2027–30, Libertadores e Sul-Americana 2027–30, Champions 2027–31). Versionar a `rights_table` por temporada, com `valid_from` e `valid_to`.

---

## 4. Itens não verificados
- Se o Premiere transmite os 380 jogos do Brasileirão 2026.
- SBT na Champions 2026/27 e na Sul-Americana 2026.
- Libertadores e Sul-Americana no México. Canais abertos da Libertadores em CO, CL, PE, UY e EC.
- Termos da LiveSoccerTV (403), dos sites Sofascore/FotMob e da futbolenlatv.com: ler antes de qualquer uso.
- Cobertura LatAm (CO, CL, PE, UY, EC) de Gracenote, JustWatch e Abelson: confirmar com o comercial de cada um.
- Partidas exatas em aberto no México na Copa 2026 (32 vs. "todas").
