# Hipismo: fontes de dados, cobertura e licenças

> Pesquisa feita em 2026-10-22 para a Galaxie Sports. Fontes: sites, regulamentos e termos oficiais, robots.txt, imprensa especializada e consultas leves ao Wikidata. **Nenhuma conta foi criada e nenhuma proteção anti-robô foi contornada.**
> Legenda: **[oficial]** = documento ou página da própria entidade · **[terceiros]** = imprensa ou outro site · **[inferência]** = conclusão nossa · **[não verificado]** = sem confirmação.
> Decisão e proposta de implementação: [13-hipismo.md](../13-hipismo.md).

---

## Sumário executivo

- **A api-sports não cobre hipismo**, e nenhum provedor comercial grande tem hipismo verificável:
  - Sportradar, Stats Perform/Opta, Genius, Enetpulse (que tem turfe, não hipismo), SportsDataIO e Data Sports Group: nada.
  - Hipismo olímpico só chega pelo feed oficial dos Jogos (ODF), restrito a detentores de direitos.
- **A FEI é a fonte de verdade de todo evento internacional** (CSI, CSIO, CDI, CCI, Copa do Mundo, Nations Cup, Jogos), e o regulamento dela fecha a porta:
  - O **Art. 133 do Regulamento Geral 2026** dá à FEI a propriedade dos dados dos eventos e proíbe coletá-los ou explorá-los sem autorização prévia por escrito.
  - data.fei.org e fei.org ficam atrás de um serviço anti-robô com CAPTCHA.
  - Os Web Services da FEI só atendem federações nacionais e comitês organizadores.
  - **Dado FEI para revenda só com contrato.**
- **LGCT/GCL e Longines Timing** (cronometragem oficial das provas "Longines": LGCT, Copa do Mundo, Nations Cup) não têm API pública. Os termos do LGCT proíbem uso comercial, scraping e data mining.
- **Equipe** (sistema de resultados usado em mais de 5 mil concursos por ano em 35 países):
  - O site é alimentado por endpoints JSON internos, não documentados.
  - **Os termos (01/09/2026) proíbem usar endpoints não documentados e revender os dados.** Os dados pertencem a cada organizador.
  - A API documentada (`v2`) é para apps que agem em nome de um usuário.
  - Para dados em lote, o próprio Equipe pede contato. **Nenhum dado do Equipe foi aproveitado** (§3).
- **CBH e FEA** publicam calendário e ranking em PDF, a FEA via Google Drive. Não há API nem termos de licença; a CBH nem publica resultados de concursos.
- **Wikidata (CC0)** serve como ponte de IDs e cadastro, não como fonte de resultados:
  - P3111 "FEI athlete ID" está em 1.021 itens: 22 brasileiros e 3 argentinos.
  - Não existe propriedade de ID FEI de cavalo.
- **Decisão de fonte (23/10/2026):** base inicial = pacote "FEI V3" entregue pelo dono do produto (leitura das páginas públicas do data.fei.org no navegador dele, sem contornar bloqueios, mais documentos oficiais públicos de Jerez 2002 e Atenas 2004). Os dados seguem sendo da FEI: o hipismo fica fora da oferta comercial até o licenciamento. Detalhes em [13-hipismo.md](../13-hipismo.md) §2.

---

## 1. Comparativo

| Fonte | Cobertura | Formato | Ao vivo | Uso comercial e revenda | Caminho |
|---|---|---|---|---|---|
| **FEI Database** | Tudo o que é FEI: 9 disciplinas, todos os níveis, Jogos, rankings mensais, atletas e cavalos com ID FEI | HTML (ASP.NET) atrás de CAPTCHA; programas em PDF | Não. O organizador manda o resultado em 2–5 dias (Art. 109.6) | **Proibido sem autorização escrita** (Art. 133) | Contrato com o Departamento Comercial (broadcast@fei.org) |
| **FEI Web Services** | Cavalo, pessoa, calendário e resultados | SOAP/XML com senha | — | Só para federações e organizadores | usersupport@fei.org; não há oferta para mídia |
| **Longines Timing** | LGCT, Copa do Mundo, Nations Cup, Mundiais | HTML renderizado por JS | Sim (site) | Termos não verificados; sem API | Contato com Longines / Swiss Timing |
| **LGCT / GCL** | Circuito LGCT (individual) e GCL (equipes) | API interna da plataforma do site | Vídeo pago (GCTV) | **Proibido** pelos termos | commercial@globalchampionstour.com |
| **Equipe Online** | Concursos em 35 países, sobretudo na Europa; Saltos, Adestramento, CCE | API `v2` documentada (OAuth, apps de usuário); endpoints internos não documentados | Sim, por largada | **Proibido**: endpoints não documentados e revenda | info@equipe.com (acesso B2B, como o conector usado em grafismo de TV) |
| **Hippodata** | Calendário e PDFs de resultados de grandes concursos | SPA + PDFs | Parcial | Sem termos publicados | Contato pelo imprint |
| **CBH** | Calendário, ranking nacional (Salto 2026; Adestramento, CCE e Enduro 2025), lista de atletas | HTML + PDF/XLS | Não | Sem termos de licença → contrato | marketing@cbh.org.br, imprensa@cbh.org.br |
| **FEA** | Calendário, resultados e ranking de GPs | PDFs no Google Drive | Não | Sem termos → contrato | fea@federacionecuestre.com.ar |
| **Olimpíadas (ODF / olympics.com)** | Paris 2024; LA 2028 no mesmo modelo | XML ODF (dicionário EQU público) | Sim, para quem tem o feed | Feed só para detentores de direitos | Distribuidor credenciado |
| **Olympedia** | Histórico olímpico completo, inclusive cavalos | HTML | Não | Todos os direitos reservados | — |
| **Wikidata** | Cadastro de cavaleiros, ponte FEI ↔ Olympedia | SPARQL / JSON | Não | **CC0** | Livre |
| **Horsetelex, Rimondo, Hippomundo** | Pedigree e resultados | HTML com 403 para robôs | Não | Base protegida (Diretiva UE 96/9/CE) → licença | Contato comercial |
| **Provedores comerciais** | Nenhum com hipismo verificável | — | — | — | — |

## 2. FEI

- **Cobertura** [oficial] ([Clear URLs](https://inside.fei.org/system/files/Access_via_clear_URLs_November_2020.pdf), [TI](https://inside.fei.org/node/4477)):
  - **Disciplinas:** Saltos, Adestramento, CCE, Atrelagem, Enduro, Rédeas (histórico), Volteio, Para-Adestramento e Para-Atrelagem.
  - **Tipos de evento:** CI (CSI1*–5*, CDI, CCI), OG, CH-M (Mundiais), WF (Finais de Copa do Mundo) e G-C/R (Jogos continentais, como o Pan).
  - **Ligas de Copa do Mundo**, inclusive a Sul-Americana.
  - **Rankings:** o Longines Ranking de Saltos é publicado uma vez por mês ([regras 2025](https://inside.fei.org/sites/default/files/LonginesRanking_Rules_2025_clean.pdf)).
- **Licença:** [Regulamento Geral 2026](https://inside.fei.org/sites/default/files/FEI%20General%20Regulations%20-Effective%201%20January2026%20-%20clean-Final_0.pdf) [oficial].
  - **Art. 133.1.2:** a FEI é dona da propriedade intelectual sobre dados e informações dos eventos. Ninguém os coleta ou explora sem autorização prévia por escrito.
  - **Art. 133.1.3:** direito exclusivo da FEI de explorar os dados em mídia, patrocínio e apostas.
- **Ao vivo:**
  - **Art. 109.6:** o organizador entrega o feed ao vivo à FEI quando ela pedir.
  - O banco de dados da FEI só recebe o resultado depois da prova.
- **Acesso automatizado:**
  - `data.fei.org/robots.txt` e `www.fei.org/robots.txt` respondem 403 com CAPTCHA (captcha-delivery).
  - **Não contornamos e não vamos contornar** essa proteção, nem com headers copiados de navegador, delays "humanos" ou serviços de raspagem com rotação de IP.
- **Modelo de dados de referência:** os XSDs públicos de resultados da FEI e o dicionário ODF EQU ([PDF](https://odf.olympictech.org/2026-Dakar/YOG/ODF_EQU_Data_Dictionary.pdf)) orientaram o nosso modelo (§4 do doc 13).

## 3. Equipe

- **Produto** [oficial] ([equipe.com](https://equipe.com/), [docs v2](https://online.equipe.com/api/docs), [Federation API](https://api-docs.equipe.com)):
  - Equipe AB (Helsingborg, Suécia), FEI Certified Service Provider.
  - Resultados em tempo real no site e no app, em concursos de 35 países.
- **APIs:**
  - `v2` documentada: exige token pessoal ou OAuth, é para apps que agem em nome de um usuário, e o Equipe não aprova apps que concorram com os produtos dele.
  - A Federation API é para federações e organizadores.
  - O site também usa endpoints JSON internos (`/api/v1/...`), **não documentados**.
- **Termos** ([Online](https://online.equipe.com/about/policies/terms), [publicação](https://policies.equipe.com/organizers/publication)) [oficial]:
  - Os dados pertencem aos organizadores.
  - "Do not sell the data and do not pass it on to anyone else."
  - "If you want data automatically, ask us rather than crawl the site."
  - Proíbe usar endpoints que não fazem parte da API documentada.
- **robots.txt:** só tem `Disallow: /about/policies/`. A proibição está nos termos.
- **Registro de transparência:**
  - Durante a pesquisa (22/10/2026) foram feitas requisições de leitura aos endpoints internos `v1`.
  - Essas requisições contrariam os termos acima.
  - **Tudo o que veio delas foi apagado e nada foi aproveitado** neste documento, no código ou em dados.
  - Não haverá novas chamadas a endpoints não documentados de nenhuma fonte.
- **Caminho legítimo:** acesso B2B via info@equipe.com. Um conector comercial de grafismo de TV usa chave de API com taxa de licença, o que indica que esse acesso existe [terceiros].

## 4. LGCT, Longines Timing e cronometragem

- **LGCT/GCL** ([termos](https://www.gcglobalchampions.com/terms-and-conditions)) [oficial]:
  - Exige permissão para "any commercial distribution, publishing or exploitation".
  - Proíbe copiar "content, code, data or materials".
  - O GCTV proíbe scraper e data mining.
  - O site usa uma API interna da plataforma (`api.globalchampions.pulselive.com`), que não chamamos.
  - Direitos de mídia internacionais 2024–2026 com a Sportfive [terceiros].
- **Longines Timing:**
  - Resultado oficial das provas Longines em `longinestiming.com/equestrian/{ano}/{evento}/resultlist_NN.html`, renderizado por JS.
  - O robots.txt permite tudo, mas os termos não foram verificados.
- **Swiss Timing:** vende cronometragem, placar e grafismo a eventos.
- **ALGE:** só hardware.
- **Hippodata:** calendário e PDFs de resultados de grandes concursos (robots.txt aberto, sem termos).
- **ClipMyHorse.TV:** vídeo e resultados (via ShowNet) com paywall; a FEI é acionista.
- **ShowGroundsLive e HSO:** circuito dos EUA, sem API pública.
- **EquiRatings:** analytics de CCE e Saltos; não vende feed.

## 5. Federações da América Latina

- **CBH (cbh.org.br)** [oficial]:
  - robots.txt aberto.
  - Calendário em HTML/ICS/PDF.
  - **Não publica resultados de concursos.**
  - Ranking em PDF/XLS: Salto Sênior Top 2026, atualizado em 20/10/2026.
  - Lista pública de atletas, sem cavalos.
  - Sem termos de licença.
- **FEA (fedecuarg.com.ar)** [oficial]:
  - Calendário em HTML/ICS.
  - Resultados e ranking de GPs em PDF no Google Drive.
  - Busca de federados só de jinetes.
  - Sem termos de licença.
- **FEM (México):** tem um "Sitio de Resultados" dinâmico e ranking em PDF.
- **Chile e Colômbia:** não encontramos resultados estruturados.
- **Rédeas:** saiu da FEI (fim do acordo FEI–NRHA). No Brasil, os resultados ficam com a ANCR e a ABQM, sem dados estruturados públicos. **Fora do escopo inicial.**

## 6. Jogos Olímpicos e Pan-Americanos

- **Paris 2024:** o livro oficial de resultados de hipismo está em PDF; o feed ODF fica com detentores de direitos.
- **LA 2028:** hipismo em Santa Anita Park de 14 a 29/07/2028: CCE de 14 a 18/7, Adestramento por volta de 20 a 24/7, Saltos de 27 a 29/7 [terceiros, provisório].
- **Santiago 2023:** os PDFs oficiais saíram do ar (403); só restam cópias no Web Archive.
- **Lima 2027:** de 23/07 a 08/08/2027; o hipismo ainda não tem sede nem datas publicadas.
- **Encaixe no produto:** o módulo multiesporte (doc 08) cobre os Jogos. O hipismo olímpico entra lá como unidades, e o histórico vem do Wikidata/Olympedia.

## 7. Atletas sul-americanos em nível 5* (temporada 2026)

| Atleta | País | Cavalo | Resultado e fonte |
|---|---|---|---|
| Marlon Zanotelli | BRA | Charly Heart | Venceu o GP CSI5* do CHI Al Shaqab (Doha) 2026 ([Gulf Times](https://www.gulf-times.com/article/721096/sport/zanotelli-clinches-chi-al-shaqab-grand-prix-with-charly-heart)) [terceiros] |
| Yuri Mansur | BRA | Vitiki | Venceu o GP LGCT Valkenswaard em 06/09/2026 ([equi-pages](https://equi-pages.de/en/?p=9258)) [terceiros] |
| Eduardo Pereira de Menezes | BRA | H5 Knockando | Venceu prova CSI5* no Stephex Masters, em 27/08/2026 ([Jumper News](https://jumpernews.com/2026/08/29/eduardo-pereira-de-menezes-the-fastest-in-the-equihome-qualifier-csi-5/)) [terceiros] |
| Rodrigo Pessoa | BRA | Prins van't Eigenlo | Venceu o GP CSI5* de Monterrey em 02/05/2026 [terceiros] |
| José María Larocca | ARG | Finn Lente | 2º no Rolex GP de Aachen 2026 [terceiros] |
| Luis Pedro Biraben | ARG | Chacco Bumpy | Vitórias em CSI3*/4* (WEC Ocala, 06/2026) [terceiros] |
| **Lucas Werthein** (destaque pedido) | ARG | Warren (KWPN, 1994) · Vlaminck Trefle (SF, 1987) | ID FEI 10000380. O histórico público exibido pela FEI tem 2 classificações: 60º no Mundial de Jerez 2002 (Vlaminck Trefle) e 71º em Atenas 2004 (Warren), mais 5 rodadas documentadas (Atenas: 9 penalidades na 1ª qualificatória e eliminação na 2ª; Jerez: 10,09 · 21 · 11, pontuação do campeonato). Fonte: pacote FEI V3 e documentos oficiais. Isso não cobre necessariamente a carreira inteira, e não há resultados FEI de 2025–2026. |
