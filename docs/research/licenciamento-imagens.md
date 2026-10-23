# Pesquisa: licenciamento formal de imagens esportivas (escudos, logos, fotos e logos de canais)

> Data da pesquisa e de acesso às fontes: **2026-10-23**. Mercados: Brasil, Argentina, México e demais países da América Latina, com referências à UE.
> Uso pretendido: produto B2B comercial. A API e o CDN da Galaxie Sports servem imagens a operadoras de TV paga e streaming, que as exibem em apps e telas de TV.
> Legenda: **[oficial]** = página do titular, do fornecedor ou texto de lei · **[terceiros]** = imprensa, doutrina ou blog · **[inferência]** = conclusão nossa · **[não verificado]** = sem confirmação; validar por escrito.
> **Este documento não é parecer jurídico.** Ele organiza as fontes e as perguntas para um advogado de propriedade intelectual. A seção [8](#8-o-que-validar-com-advogado) lista o que precisa de validação.
> Política editorial: nenhum cliente ou operadora é citado pelo nome.

---

## Resumo executivo

1. **Um escudo tem duas camadas de direito:** a **marca** (sinal distintivo) e o **direito autoral** (o desenho como obra artística). No Brasil há uma terceira proteção, específica do esporte: o **art. 87 da Lei Pelé**, ainda vigente, dá a clubes e entidades a propriedade exclusiva da denominação e dos símbolos **"sem necessidade de registro"**. Isso vale mesmo para clubes pequenos que nunca registraram marca no INPI. Uma licença formal precisa cobrir as duas camadas e vir de quem tem os direitos: o clube, a liga ou um intermediário autorizado.
2. **O acervo do football-logos.cc não pode ser usado comercialmente pelos próprios termos.** A página [`/license/`](https://football-logos.cc/license/) (acesso em 2026-10-23) restringe o uso a fins "informativos, editoriais e de fãs" e proíbe produtos comerciais, merchandising, branding e material promocional. O repositório no GitHub só tem 231 colagens de prévia, uma por país; os ~5.300 escudos individuais ficam só no CDN do site e seguem esses termos. O autor também declara que **não é dono dos escudos**. Uma licença dele cobriria no máximo **o trabalho de vetorização e restauração**, nunca a marca nem a obra original do clube. Vale pedir (rascunho na [§5](#5-o-autor-do-football-logoscc)), mas isso **não tira o risco principal**, que é o dos titulares. **Recomendação: manter a flag desligada nos feeds de clientes pagantes até haver licença.**
3. **Nenhum fornecedor de dados licencia escudos para redistribuição B2B de prateleira.**
   - A **api-sports** e a **Sportmonks** entregam logos "só para identificação" e passam a responsabilidade ao cliente.
   - O **Sportradar Images API** entrega logos e headshots com fonte e copyright por imagem (AP, Getty, Reuters, USA Today), mas é "media use only", tem preço sob consulta e foco nas ligas dos EUA.
   - Detentores de dados oficiais (Genius Sports na Liga MX e na Serie A, e outros) negociam direitos de mídia caso a caso.
4. **Fotos de jogadores somam o direito do fotógrafo ou da agência ao direito de imagem do atleta.** Esse direito está no art. 20 do Código Civil e no art. 87-A da Lei Pelé (BR), no art. 31 da Ley 11.723 e no art. 53 do CCyC (AR), e no art. 87 da LFDA (MX). As agências (Getty, Imago, AP, Reuters, Shutterstock, EFE) vendem por padrão **licença editorial**. Para servir fotos num feed B2B por API, é preciso **contrato enterprise com cláusula de redistribuição para clientes nomeados**. O cadastro de imagens da api-sports não traz essa licença.
5. **Para logos de canais, a prática de mercado é o uso referencial ("onde assistir").** A forma mais segura é **receber os logos das próprias operadoras-clientes**, que já têm contratos de carriage com as emissoras, ou pedir os press kits às emissoras. Detalhe na [§4](#4-logos-de-canais-e-emissoras).
6. **O que fazer primeiro** (detalhe na [§7](#7-recomendação-em-fases)):
   1. Contratos com clientes que deixem as imagens como "material de identificação" e prevejam o uso de assets fornecidos pelo cliente.
   2. Política de remoção (takedown) e trilha de origem por imagem.
   3. Pedir ao autor do football-logos.cc licença comercial do trabalho de vetorização.
   4. Consulta jurídica curta, só em BR, AR e MX.
   5. RFP de mídia com Sportradar e um detentor de dados oficial.
   6. Acordos diretos com as ligas prioritárias à medida que os contratos de clientes justificarem.

---

## 1. Base legal (para orientar, não é parecer)

### 1.1 Marca × direito autoral num escudo

| Camada | O que protege | Quem é titular | Prazo | Exceções relevantes para nós |
|---|---|---|---|---|
| **Marca** | O sinal como identificador de origem: escudo, nome, apelido | Clube, liga ou federação (registro no INPI, INPI-AR ou IMPI; no Brasil também o art. 87 da Lei Pelé) | Renovável indefinidamente; no art. 87, "por tempo indeterminado" | Uso nominativo ou referencial: citar a marca para identificar o titular, sem sugerir patrocínio (BR art. 132, IV LPI; UE art. 14(1)(c) da Diretiva 2015/2436) |
| **Direito autoral** | O desenho do escudo como obra artística | O autor do desenho ou o clube (cessão ou encomenda) | Vida do autor + 70 anos (BR, UE, AR); vida + 100 anos (MX) | Limitações estreitas: citação, informação jornalística. Reproduzir o arquivo **inteiro** como produto não cabe em quase nenhuma delas |
| **Direito sobre a vetorização** | O redesenho, se tiver contribuição criativa própria | Quem vetorizou (no nosso caso, o autor do football-logos.cc) | Igual ao autoral | Redesenho fiel tende a **não** gerar obra nova (ver §1.3). A questão é incerta e varia por país |

- **Escudos antigos podem ter caído em domínio público como obra**, mas seguem protegidos como marca e, no Brasil, pelo art. 87 da Lei Pelé. Na prática, domínio público autoral **não** libera o uso comercial. [inferência]

### 1.2 Brasil

- **Lei Pelé (9.615/1998), art. 87** [oficial]: "A denominação e os símbolos de entidade de administração do desporto ou prática desportiva, bem como o nome ou apelido desportivo do atleta profissional, são de propriedade exclusiva dos mesmos, contando com a proteção legal, válida para todo o território nacional, por tempo indeterminado, sem necessidade de registro ou averbação no órgão competente." O parágrafo único garante o uso comercial pelo titular.
  - Fonte: texto consolidado no Planalto, onde o artigo aparece **sem nota de revogação** em 2026-10-23.
  - O **PL 3.074/2024** propõe levar essa regra para a Lei Geral do Esporte (14.597/2023) como art. 35-A e revogar o art. 87. O texto mantém a proteção sem registro. Tramitação não confirmada ([Senado](https://legis.senado.leg.br/sdleg-getter/documento?dm=9758918)). [oficial]
  - Leitura doutrinária: a propriedade sobre os símbolos decorre da lei ("ex vi legis"), não do registro ([Migalhas](https://www.migalhas.com.br/coluna/pi-migalhas/267594/uma-comparacao-entre-os-simbolos-do-esporte-e-as-marcas)). [terceiros]
- **LPI (9.279/1996), art. 132, IV:** o titular não pode impedir a "citação da marca em discurso, obra científica ou literária ou qualquer outra publicação, desde que sem conotação comercial e sem prejuízo para seu caráter distintivo". [oficial]
  - O requisito **"sem conotação comercial"** pesa contra nós: um feed B2B pago é comercial por natureza.
  - Não achamos precedente do STJ sobre o inciso IV aplicado a listagens esportivas ([dissertação no INPI](https://www.gov.br/inpi/pt-br/servicos/a-academia/arquivo/dissertacoes/SILVAMariaClaradeOliveira.pdf), [Migalhas](https://www.migalhas.com.br/depeso/352927/os-limites-a-utilizacao-de-marcas-em-pecas-publicitarias)). [terceiros]
- **LDA (9.610/1998):** desenhos são obras protegidas (art. 7º, VIII). Reprodução, distribuição e "inclusão em base de dados" dependem de autorização prévia e expressa (art. 29). As limitações do art. 46 são estreitas. [oficial; validar artigos com advogado]
- **Imagem do atleta:**
  - O art. 20 do Código Civil exige autorização para uso comercial da imagem.
  - O art. 87-A da Lei Pelé prevê a cessão do direito de imagem por contrato civil. [oficial]
  - Precedente sobre foto: o TJRJ condenou a CBF por usar sem autorização e sem crédito a foto histórica "Três no Tri" ([Campos Thomaz](https://camposthomaz.com/en/conhecimento-ct/rio-court-upholds-ruling-against-cbf-for-unauthorized-use-of-historic-photograph/)). [terceiros]

### 1.3 Vetorização e "restauração": gera direito novo?

- **EUA:** em *Meshwerks v. Toyota* (10º Circuito, 2008), modelos digitais que reproduzem fielmente o original **não** têm originalidade própria ([decisão](https://www.ca10.uscourts.gov/sites/ca10/files/opinions/01011513284.pdf)). Por analogia, um SVG fiel ao escudo oficial tende a não ter direito autoral próprio. [oficial + inferência]
- **Wikimedia Commons:** "é menos claro" se um vetor (SVG) de um desenho tem direito autoral próprio, ao contrário de um PNG ([Commons: regras por assunto, Trademarks and logos](https://commons.wikimedia.org/wiki/Commons:Copyright_rules_by_subject_matter)). [terceiros]
- **UE:** a Diretiva 2019/790, art. 14, nega proteção a reproduções de obras de arte visual **em domínio público**, salvo se a reprodução for original. [oficial; validar alcance para logos]
- **Conclusão prática** [inferência]:
  - O direito do vetorizador é **fraco e incerto**. Já a relação **contratual e de termos de uso** com ele é clara: os termos proíbem uso comercial.
  - Uma licença dele **reduz** o risco de conflito com ele, mas **não** substitui a licença do titular.

### 1.4 União Europeia

- **Diretiva (UE) 2015/2436, art. 14(1)(c), e Regulamento 2017/1001, art. 14:** o titular não pode impedir o uso da marca "para identificar ou referir-se a produtos ou serviços como sendo os do titular", desde que conforme às práticas honestas ([texto, legislation.gov.uk](https://www.legislation.gov.uk/eudr/2015/2436/chapter/2/section/3)). [oficial]
- **TJUE, C-361/22 (*Inditex v Buongiorno Myalert*, 11/01/2024):** a regra nova é **mais ampla** que a antiga (que só cobria a "finalidade do produto"). Os comentários divergem sobre quanto ([Bird & Bird](https://brandwrites.twobirds.com/post/102nqfm/how-grilles-and-giftcards-brought-some-clarity-to-referential-use-of-trade-mar), [Garrigues](https://blogip.garrigues.com/en?p=12221)). [terceiros]
- **Para nós** [inferência]:
  - A exceção protege **referir-se** ao clube, como num placar que mostra que o jogo é do Real Madrid.
  - **Vender o arquivo do escudo** como ativo de um feed é mais difícil de enquadrar como "referencial".
  - **Direito autoral:** a Diretiva 2001/29, art. 5, não tem exceção ampla de "identificação".

### 1.5 Argentina

- **Marcas (Ley 22.362):** a exclusividade nasce do registro (art. 4º) ([WIPO Lex](https://www.wipo.int/wipolex/en/legislation/details/17281)). Não achamos exceção legal expressa de uso nominativo.
  - Jurisprudência recente da Cámara Federal exige, para o crime do art. 31, "un acto de deslealtad o de engaño hacia el público" ([Diario Judicial](https://www.diariojudicial.com/news-31716-el-derecho-marcario-no-sirve-para-dirimir-los-conflictos-contractuales)). [terceiros]
- **Direito autoral (Ley 11.723):** protege obras com originalidade mínima ([Commons: TOO, Argentina](https://commons.wikimedia.org/wiki/Commons:Threshold_of_originality)). [terceiros]
- **Retrato:**
  - O art. 31 da Ley 11.723 proíbe comercializar retrato fotográfico sem consentimento expresso. A publicação é livre para fins culturais ou para "hechos o acontecimientos de interés público".
  - O art. 53 do CCyC exige consentimento para reproduzir a imagem, salvo em atos públicos.
  - Um capitão de Los Pumas foi indenizado por uso sem autorização ([Diario Judicial](https://www.diariojudicial.com/news-71021-la-imagen-no-es-nada); a data da nota é inconsistente). [terceiros]

### 1.6 México

- **LFPPI (2020), art. 175:** as exceções ao registro de marca são o usuário anterior de boa-fé, a exaustão de direitos e o uso do próprio nome ([texto em mley.mx](https://mley.mx/LFPPI/articulo/175/), [compêndio SDV](https://sdv.com.mx/compendio/ley-federal-de-proteccion-a-la-propiedad-industrial/articulo-175/)). **Não há exceção expressa de uso nominativo ou informativo.** O risco marcário de exibir escudos sem licença é **maior no papel** que no Brasil ou na UE. [terceiros reproduzindo texto oficial; confirmar no DOF]
- **LFDA, art. 87:** o retrato de uma pessoa só pode ser usado ou publicado com consentimento expresso. A SCJN (ADR 2808/2025) confirmou a constitucionalidade e as exceções: retratado como parte menor de um conjunto, ou foto em local público com fins informativos ou jornalísticos ([LFDA art. 87](https://mley.mx/LFDA/articulo/87/), [SCJN](https://www.scjn.gob.mx/sites/default/files/estrado_electronico_notificaciones/documento/2026-06/UT-J-0252-2026-Informacion.pdf)). [oficial]
- **Prazo autoral:** vida + 100 anos. [validar]

### 1.7 O que muda ao redistribuir por API para terceiros pagantes

[inferência; validar com advogado]
1. **Ninguém licencia o que não tem.** Para servir imagens a N clientes, precisamos do direito de **sublicenciar** (ou de distribuir em nome do titular). Licenças editoriais e de "uso no próprio produto" não dão isso.
2. **O argumento do uso nominativo enfraquece:**
   - O uso referencial protege **mostrar** o escudo para identificar o time num placar.
   - Entregar **o arquivo** como parte de um produto pago parece mais exploração da marca e da obra do que referência. Isso vale ainda mais em alta resolução e com variações (mono, fundo transparente), que servem também para merchandising.
3. **Corresponsabilidade:**
   - A operadora que exibe e a Galaxie que fornece podem ser acionadas juntas.
   - O art. 19 do Marco Civil (Brasil) **não** nos protege: ele vale para conteúdo de terceiros, e aqui somos a fonte.
   - O cliente vai pedir **garantias e indenização** que não podemos dar sem licença.
4. **Territorialidade:** a lei aplicável é a de cada país onde a imagem é exibida. Um feed pan-LatAm herda o regime mais restritivo; pelo texto, o México.
5. **TV e comunicação ao público:** exibir na TV é comunicação ao público. Isso não muda o enquadramento marcário, mas amplia o autoral.
6. **Atletas:** headshot num guia de programação tem viés informativo, mas a foto é da agência. Usá-la num produto que não é jornalismo pode exigir licença comercial e, em alguns casos, consentimento do atleta.

---

## 2. Tabela comparativa dos caminhos

| Caminho | Escudos de clubes | Logos de ligas e competições | Fotos de jogadores | Logos de canais | Permite redistribuição B2B? | Custo público | Esforço | Risco residual |
|---|---|---|---|---|---|---|---|---|
| **api-sports** (hoje) | Sim (PNG) | Sim | Sim | Não | **Não.** Logos "só para identificação"; revenda de dados proibida (ver [api-sports-football.md](api-sports-football.md)) | Já pago (dados) | — | **Alto** em produção comercial |
| **Sportmonks** | Sim (`image_path`) | Sim | Sim | Sim (TV stations) | **Não para mídia.** O cliente prova a PI ([sportmonks.md](sportmonks.md)) | Enterprise sob cotação | Médio | Alto para imagens |
| **Sportradar Images API** | Logos com campo `copyright` por imagem (AP etc.) | Sim | Headshots AP, Getty, Reuters, Imagn; coaches "tipicamente NFL, NBA, NHL e MLB" | Não | **Talvez, por contrato.** "Media use only"; termos de redistribuição não são públicos | Sob cotação | Médio (RFP + integração) | Médio. Cobertura LatAm de futebol a confirmar |
| **SportsDataIO** | Não confirmado | Não confirmado | Headshots licenciados via USA Today e Imagn (ligas dos EUA) | Não | O feed **não** pode ser revendido como produto | Sob cotação | Médio | Médio. Pouco útil para LatAm |
| **Stats Perform / Opta** | Não publicado | Não publicado | Via parceria com a AP (headshots) | Não | A negociar | Sob cotação | Alto | Médio |
| **Detentor de dados oficial** (ex.: Genius Sports na Liga MX e na Serie A) | Possível como direito de mídia | Possível | Possível | Não | A negociar. Os acordos públicos falam de dados, streaming e "media exploitation" | Sob cotação | Alto | Baixo se o contrato cobrir as imagens |
| **Agências de foto** (Getty, Imago, AP, Reuters, Shutterstock, EFE, Mexsport) | **Não** (não licenciam marcas) | Não | **Sim**, licença editorial por padrão; enterprise/API a negociar | Não | Só com contrato enterprise e cláusula para clientes | Imago: pacote inicial €999 por 100+ licenças editoriais; Shutterstock: US$199/imagem avulsa (2018) | Médio | Baixo para foto; **direito de imagem do atleta** a parte |
| **Direto com ligas e federações** | Sim (o titular do conjunto ou do clube, via liga) | **Sim** | Às vezes (bancos oficiais, como o da CBF com a Yapoli) | Não | Sim, se negociado | Não público | **Alto** (uma negociação por liga) | Baixo |
| **Direto com clubes** | **Sim** | Não | Às vezes | Não | Sim, se negociado | Não público | Muito alto (centenas de clubes) | Baixo, mas não escala |
| **Autor do football-logos.cc** | Só o **trabalho de vetorização** | Idem | Não | Não | Só para a parte dele | Desconhecido | Baixo | **Alto** (sem a camada do titular) |
| **Wikimedia Commons** | Só logos **abaixo do limiar de originalidade** (PD-textlogo), com aviso de marca | Idem | Algumas fotos CC BY-SA, com atribuição e share-alike | Raros | Sim para direito autoral (conforme a licença); **não** para marca | Grátis | Médio (curadoria por arquivo) | Médio: marca continua protegida |
| **Fornecidos pelos clientes** (operadoras) | Às vezes | Às vezes | Às vezes | **Sim** | O cliente fornece e garante; nós só processamos | Grátis | Baixo | **Baixo** para o que eles fornecem |

---

## 3. Caminhos de licenciamento em detalhe

### 3.1 Agências e bancos de imagem esportiva

| Agência | O que cobre | Licença padrão | API e CDN | Preço público | Observações |
|---|---|---|---|---|---|
| **Getty Images** | Fotos de jogos, retratos e headshots. Parceira oficial de FIFA, UEFA, COI e F1, entre outros ([Getty, UEFA](https://www.tipranks.com/news/the-fly/getty-images-renews-multi-year-partnership-with-uefa)) | Editorial: "sem model ou property release", não serve para fins "commercial, promotional, advertorial or endorsement" ([Getty FAQ](https://www.gettyimages.com/faq/working-files)) | **Getty Images API** com chave e OAuth2 para parceiros e enterprise; acesso pelo gerente de conta ([Getty API](https://www.gettyimages.com/api)) | Não publicado para enterprise | Fotos da Liga MX vêm marcadas "Strictly Editorial Use Only" ([exemplo](https://www.gettyimages.ae/detail/news-photo/pavel-perez-of-necaxa-celebrates-after-scoring-his-teams-news-photo/2209822990)). Não achamos parceria oficial com CONMEBOL ou Liga MX |
| **Imago** (Alemanha) | Grande arquivo de futebol europeu e sul-americano. Distribui a **Mexsport**, ligada historicamente à Liga MX e à seleção mexicana ([Imago, Mexsport](https://news.imago-images.com/en/new-at-imago/agencia-mexsport)) | Rights Managed (editorial) e Royalty Free; o uso comercial é "additional request" e "the client has to take care of third-party rights" ([guia Imago](https://blog.imago-images.com/en/how-to-license-sports-images-a-complete-guide-by-imago)) | API e push FTP para sistemas editoriais | **€999 por 100+ licenças editoriais** (oferta inicial); o resto sob medida ([Imago Connect](https://connect.imago-images.com/en/licensed-sports-images-for-creators-publishers-and-communities)) | Bom candidato para headshots e fotos de LatAm, mas a licença de feed B2B tem de ser negociada |
| **AP** | Fotos esportivas, headshots e logos (fonte dos logos e headshots do Sportradar) | Termos "tailored" para uso editorial, comercial ou educacional | AP Newsroom e API com licença de conteúdo ([AP, fotos](https://kompas.wasmer.app/https_www_ap_org/content/formats/photos), [AP Developer](https://jentic.com/apis/developer.ap.org/associated-press.md)) | Não publicado | Também chega via Stats Perform ([SVG Europe](https://www.svgeurope.org/blog/news-roundup/stats-perform-and-the-associated-press-extend-partnership-to-create-one-stop-sports-content-shop/)) |
| **Reuters Connect** | Fotos esportivas, inclusive de parceiros (USA Today Sports, MB Media com headshots) | B2B por pontos ("Reuters Points") | Plataforma Reuters Connect | Não publicado | O anúncio de 2019 sobre headshots precisa ser reconfirmado ([Thomson Reuters](https://www.thomsonreuters.com/en/press-releases/2019/february/reuters-expands-sports-offering-with-content-partnerships)) |
| **Shutterstock Editorial** (Rex Features) | Arquivo editorial com AP, EPA e Variety | "Editorial Use Only" não é liberado para uso comercial; a plataforma que redistribui **indeniza** a Shutterstock pelo uso dos usuários; exige "Powered by Shutterstock" ([API terms](https://developers.shutterstock.com/api-terms)) | Endpoints editoriais só para enterprise, via gerente de parceria | US$199/imagem avulsa ou US$99/imagem no pacote de 25 (preços de 2018) ([Shutterstock](https://investor.shutterstock.com/node/9996)) | Oferece clearance de direitos com a Greenlight ([Shutterstock business](https://www.shutterstock.com/business/media)) |
| **EFE** | Maior agência em espanhol; arquivo de 15 milhões de imagens ([NMC](https://www.newsmediacoalition.org/companyprofile/efe-agencia)) | Assinatura (não publicada) | Não documentada publicamente | Não publicado | Relevante para AR, MX e Andes. Contato comercial |
| **Bancos oficiais de federação** | Ex.: a CBF usa a **Yapoli** para "gerir, distribuir e monetizar" as fotos oficiais da Seleção, com rastreio de créditos e direitos ([CBF](https://www.cbf.com.br/a-cbf/noticias/informes-cbf/a/cbf-escolhe-yapoli-para-gerir-distribuir-e-monetizar-fotos-e-videos-oficiais-da-selecao-na-copa-do-mundo)) | Definida pela federação | Plataforma DAM | Não publicado | Caminho para fotos oficiais da Seleção |

**Pontos comuns:**
- As agências licenciam **fotos**, não **marcas**. Uma foto editorial em que aparece um escudo não autoriza usar o escudo isolado.
- Licença editorial ≠ licença de feed B2B: o uso dentro de um produto de dados vendido a operadoras não é "notícia". Exige contrato enterprise com cláusulas de redistribuição, cache no CDN, território e lista de clientes. [inferência]
- **Atenção de mercado (México, 2026):** uma disputa entre a administração do Estádio Banorte e agências deixou um jogo sem fotos. O motivo foi um contrato que tiraria das agências os direitos sobre as imagens captadas no estádio ([Mediotiempo](https://www.mediotiempo.com/futbol/liga-mx/conflicto-estadio-banorte-agencias-fotografia-deja-medios-imagenes-america-vs-santos)). Os direitos de foto também estão em disputa entre estádios, clubes e agências. [terceiros]

### 3.2 Fornecedores de dados que entregam mídia

| Fornecedor | Mídia entregue | O que dizem os termos | Leitura para a Galaxie |
|---|---|---|---|
| **api-sports** | Logos de times e ligas, fotos de jogadores e técnicos, estádios (`media.api-sports.io`) | Logos e marcas fornecidos **só para identificação**; o fornecedor não detém os direitos; o uso pode exigir licença dos titulares; cache recomendado; revenda de dados proibida. Fórum: "all logos/images are copyrighted by their legal owner" ([Apple Developer Forums](https://developer.apple.com/forums/thread/718427); detalhes em [api-sports-football.md](api-sports-football.md) §3 e §6) | Não dá licença. Os termos estavam inacessíveis (403) nesta data e devem ser relidos antes de qualquer conversa. Vale **pedir por escrito** uma posição sobre redistribuição de mídia |
| **Sportmonks** | `image_path` para times, jogadores, países, emissoras e estádios | Logos e fotos pertencem aos titulares; "o cliente precisa obter a prova de PI por conta própria" ([sportmonks.md](sportmonks.md) §5) | Igual à api-sports |
| **Sportradar** (Images API v3) | Headshots, logos de times e ligas, estádios, action shots | "Media use only"; proibido para clientes de apostas; "the intention is for you to save each image on your end"; cada logo traz o campo `copyright` (ex.: "Associated Press"); trial com marca d'água ([FAQ](https://developer.sportradar.com/images-and-editorials/reference/images-faqs), [logos](https://developer.sportradar.com/images-and-editorials/reference/images-logo-image), [visão geral](https://developer.sportradar.com/images-and-editorials/reference)). O "Official Media Data Addendum" (visto só no resultado de busca) **exclui** "any League Intellectual Property and Marks", incluindo direitos de imagem de times e jogadores: o uso é "at Customer's own risk" ou depende de contrato com o titular [não verificado] | **O mais próximo de "mídia licenciada junto com dados".** Perguntar: cobertura de futebol LatAm; direito de **sublicenciar a operadoras** e exibir na TV; prazo de retenção após o fim do contrato |
| **SportsDataIO** | Headshots NFL, MLB, NBA e NHL via **USA Today** e "converted headshots" via **Imagn** ([headshots](https://sportsdata.io/developers/sports-player-headshots-api)) | O feed não pode ser revendido como produto isolado; atribuição obrigatória ([FAQ](https://sportsdata.io/help/data-rights-and-licensing-questions)) | Pouco relevante para futebol LatAm |
| **Stats Perform / Opta** | Dados Opta; headshots e imagens via AP; ferramenta Opta Graphics ([SVG Europe](https://www.svgeurope.org/blog/news-roundup/stats-perform-and-the-associated-press-extend-partnership-to-create-one-stop-sports-content-shop/), [Opta Graphics](https://www.statsperform.com/news/stats-perform-launches-opta-graphics-the-most-intuitive-multimedia-graphics-tool/)) | Termos de imagem não públicos | A cotar; útil se já houver conversa de dados |
| **Genius Sports** | Dados oficiais e streaming de apostas; na Serie A também dados "for media exploitation" até 2028/29 ([Business Wire](https://www.businesswire.com/news/home/20250804278927/en/Genius-Sports-Secures-Exclusive-Official-Data-and-Betting-Streaming-Rights-with-Lega-Serie-A-Through-2029-to-Power-Next-Generation-BetVision-Product)); parceria exclusiva com a Liga MX (Liga MX, Expansión, Copa MX e Femenil) ([Inside Sport](https://www.insidersport.com/2020/11/25/genius-sports-to-raise-liga-mx-profile-in-streaming-and-data-agreement/)) | Imagens não mencionadas nos releases | Caminho para **ligas onde a Genius é detentora oficial**: perguntar se os escudos oficiais e o logo da liga entram como "brand assets" do pacote de mídia |
| **Brandfetch** (logos de marcas em geral) | Logos de empresas e marcas, incluindo emissoras | "Logos are the property of their respective trademark owners"; uso para citar a marca, sem sugerir afiliação ([fair use](https://docs.brandfetch.com/guides/logo-fair-use), [guidelines](https://docs.brandfetch.com/docs/logo-api/guidelines)) | Ferramenta, não licença. Não resolve o direito do titular |

### 3.3 Direto com ligas, federações e clubes

**Conclusão:** nenhum detentor pesquisado tem programa **público** para licenciar escudos e logos para redistribuição B2B por API ou CDN. O que existe são **diretrizes de mídia para imprensa**, de uso editorial, que proíbem justamente o nosso caso: uso comercial e repasse a terceiros. O caminho é **contrato com o braço comercial** de cada liga e, para escudos, com cada clube ou com quem os representa.

| Detentor | O que existe | Ponto-chave para nós | Status |
|---|---|---|---|
| **UEFA** | "Media Guidelines" para imprensa sem direitos ([PDF, 2013](https://editorial.uefa.com/resources/020a-0f8428bf2255-54a1767838ba-1000/uefa_s_media_guidelines_pdf_file_.pdf)). O Anexo G do regulamento da Champions é mais restritivo para clubes e parceiros | A imprensa "shall not be entitled to provide any Official Marks… to any third party without UEFA's prior approval": **repassar logos por API exige aprovação da UEFA** | [oficial] |
| **FIFA** | "Mark Request Form" no FIFA Digital Archive (com login); imagens via Digital Hub ([Legal, branding and rights](https://inside.fifa.com/organisation/contact-fifa/legal-branding-and-rights)) | Uso editorial e não comercial; o uso comercial é só para "FIFA Rights Holders" (IP Guidelines da Copa 2026) | [oficial] |
| **CONMEBOL** | Credenciamento pelo Media Hub (cadastro, aprovação e pedido por evento). Manual de clubes "NRH" da Libertadores 2026 para mídia sem direitos | Não há portal de marca nem download de logos. Dados: a Stats Perform foi parceira oficial desde 2020; em 2023 a Sportradar ganhou direitos audiovisuais e de apostas de Libertadores, Sudamericana e Recopa por 4 temporadas | [oficial] / dados [terceiros, vigência não confirmada] |
| **Premier League** | Termos: "No rights are granted… without the prior written permission of the owner"; propostas comerciais via contato de parcerias ([termos](https://www.premierleague.com/en/terms-and-conditions), [contato](https://www.premierleague.com/en/about/contact-us)) | Marcas da PL **e de cada clube** são separadas; não há guia de marca público | [oficial] |
| **Football DataCo** (PL, EFL e Escócia) | Comercializa dados e protege fotos de jogo ([site](https://www.football-dataco.com/)) | Uso comercial de imagens de partida "strictly prohibited" sem permissão dos clubes; parceiro de dados de mídia é a Opta. Fonte antiga (2009) diz que a DataCo controlava escudos via licenciado nomeado | [oficial] / escudos [terceiros, antigo] |
| **LaLiga** | Download público só dos logos da própria LALIGA ([logos](https://www.laliga.com/en-GB/pressroom/logos-and-corporate-dossier/logos)); aviso legal proíbe uso comercial sem autorização ([legal](https://www.laliga.com/en-GB/legal/legal-web)); credenciamento ([acreditaciones](https://www.laliga.com/en-GB/accreditations)) | **Exceção provável:** pelos estatutos (vistos na busca), a liga comercializa os escudos dos clubes junto com a marca dela. Um único contrato poderia cobrir os 20 clubes | [oficial]; estatutos [não verificado] |
| **Bundesliga (DFL)** | Diretrizes de mídia 26/27 em alemão; credenciamento pelo clube mandante ([media](https://www.bundesliga-group.com/media/), [guidelines](https://www.bundesliga-group.com/media/guidelines-and-accreditation/)) | A Bundesliga Media (DFL Enterprises) cuida dos direitos globais e do "central licensing" ([subsidiária](https://www.bundesliga-group.com/about/subsidiaries/bundesliga-media/)); dados oficiais com a Sportec Solutions | [oficial] |
| **Serie A** | Os termos de licença de mídia remetem a "dedicated guidelines for the use of logos and marks", emitidas pela Lega e/ou pelos clubes | Dados oficiais com a Genius Sports até 2028/29, incluindo tracking para uso editorial | [oficial, PDF não aberto] |
| **Ligue 1 (LFP)** | Logos e marcas pertencem à "FILIALE LFP 2 et des clubs"; reprodução só com autorização prévia ([aviso legal](https://ligue1.com/fr/legal/legal-notice)) | Comercialização de mídia com a Infront (2024–29); tracking com a Genius Sports | [oficial] |
| **Liga MX / FMF** | A página de mídia da Leagues Cup lista o contato de comunicação da Liga MX e uma pasta "LIGA MX Logos" ([recursos mediáticos](https://es.leaguescup.com/recursos-mediaticos/contactos/)) | Genius Sports é parceira oficial de dados e integridade desde 2020; a IMG é agência global de patrocínio. Não há manual de marca público da FMF | [oficial, indireto] |
| **AFA / LPF** | Nova identidade da LPF em 2026, com manual LPF/AFA (não encontrado) | Genius Sports é parceira exclusiva de dados e streaming da AFA desde 2021, em 13 competições | [terceiros] |
| **CBF / Brasileirão** | Termos proíbem reprodução sem autorização ([termos](https://www.cbf.com.br/termos-de-uso)) | A CBF já notificou terceiros pela marca "Brasileirão" (registrada no INPI). As fotos oficiais da Seleção são distribuídas pela Yapoli (§3.1). Não há manual de marca público | [oficial] |
| **Libra / LFU** (blocos do Brasileirão) | Vendem os direitos comerciais dos clubes; em março de 2026 começaram conversas sobre liga única | Podem vir a centralizar marcas e dados dos clubes da Série A. **Acompanhar:** uma liga única simplificaria o licenciamento no Brasil | [terceiros] |
| **Clubes** (amostra) | Flamengo: área de licenciamento no marketing, com ações contra uso não autorizado. Boca Juniors: imprensa só com credenciamento ([prensa](https://www.bocajuniors.com.ar/prensa)). Real Madrid: sem kit público | Os escudos são do clube; licenciar clube a clube não escala, mas serve para os poucos de maior audiência | [oficial] / [terceiros] |

**O que costumam exigir** [inferência a partir dos documentos]:
- contrato escrito com escopo, território, prazo e mídias;
- logo **sem alteração** e conforme o manual;
- proibição de sugerir associação oficial;
- proibição de uso em apostas sem licença específica;
- **cláusula sobre repasse a terceiros**, que é o ponto central para o nosso modelo de API e é explícita na UEFA.

**Como pedir** [recomendação]:
1. Contato comercial ou de parcerias da liga, **não** a assessoria de imprensa.
2. Apresentação curta da Galaxie como fornecedora B2B de dados a plataformas de TV.
3. Lista das competições e dos usos: guia de programação, placar e app.
4. Pedido de licença de **marcas da competição e dos clubes participantes** com direito de entrega às operadoras-clientes.
5. Onde houver detentor oficial de dados ou agência comercial (Genius Sports, Infront, Bundesliga Media, IMG), perguntar se as marcas entram no pacote de mídia dele.

### 3.4 Fontes abertas: Wikimedia Commons

- **O que o Commons hospeda** ([regras por assunto, "Trademarks and logos"](https://commons.wikimedia.org/wiki/Commons:Copyright_rules_by_subject_matter)):
  - **Logos com direito autoral não podem ser enviados** ("would be a copyright violation").
  - Logos **abaixo do limiar de originalidade** podem, marcados com `{{PD-textlogo}}` e `{{Trademark}}`.
  - Trademark "is no bar to Commons hosting": o Commons decide só pelo direito autoral. **Hospedar lá não significa que o uso comercial da marca é livre.**
- **Limiar de originalidade por país** ([COM:TOO](https://commons.wikimedia.org/wiki/Commons:Threshold_of_originality)):
  - **Brasil:** limiar **mais alto** que nos EUA ("way more strict and exigent").
  - **Argentina:** originalidade mínima basta.
  - O Commons aplica a regra do país de origem.
- **Wikipédia em inglês:** muitos escudos estão lá como **non-free** (uso justo local, em baixa resolução), não no Commons. Não podem ser reutilizados fora da Wikipédia. [inferência a partir da política do Commons]
- **Fotos de jogadores** no Commons costumam ser CC BY ou CC BY-SA. Servem se atribuirmos o autor e respeitarmos o share-alike no arquivo. Ainda assim o **direito de imagem** do atleta continua valendo para uso comercial. [inferência]
- **Para que serve:**
  - Escudos geométricos ou só com texto, que o Commons já classificou como PD.
  - Bandeiras e brasões oficiais de países e estados (geralmente PD por lei).
  - Fotos CC de atletas como fallback.
  - **Não resolve** a camada de marca nem os escudos elaborados dos grandes clubes.

---

## 4. Logos de canais e emissoras

### 4.1 Prática de mercado em guias de programação e apps

- **Quem fornece o logo do canal é a própria emissora**, por meio do contrato de distribuição (carriage) com a operadora ou plataforma.
  - A especificação de EPG da The Roku Channel pede que o canal entregue o logo pelo parceiro de distribuição: PNG transparente 114×60, versões clara e escura, sem marca do distribuidor ([Roku](https://developer.roku.com/dev/docs/epg-on-trc)). [oficial]
- **Cláusula típica de contrato de distribuição:** o uso do logo em guias e listagens de rotina conta como aprovado se seguir as diretrizes da emissora; uso promocional precisa de aprovação prévia ([cláusula-modelo](https://lawinsider.com/clause/electronic-program-guide)). [terceiros]
- **Provedores de metadados de EPG** não publicam termos de licença de logos:
  - os termos da Schedules Direct não falam de logos ([termos](https://www.schedulesdirect.org/terms), [FAQ](https://www.schedulesdirect.org/faq));
  - a TVmaze licencia os dados em CC BY-SA, mas isso **não** alcança marcas de terceiros ([API](https://www.tvmaze.com/api)). [oficial]
- **Leitura** [inferência]:
  - A operadora já tem, no contrato com cada canal, o direito de exibir o logo no guia.
  - A Galaxie deve entregar o **identificador do canal** e o nome em texto e, quando houver, o **arquivo fornecido pela emissora ou pelo cliente**.
  - A Galaxie não deve se apresentar como licenciante do logo.

### 4.2 Programas oficiais de logos das emissoras

| Emissora | Onde | Termos | Status |
|---|---|---|---|
| **Globo** (sportv, ge, Premiere, Combate, Globoplay) | Galeria de logos em [imprensa.globo.com](https://imprensa.globo.com/), área restrita para jornalistas | Licença não exclusiva, só para informação e divulgação em veículos de imprensa, só no Brasil. **Proíbe** uso comercial, associação com outras marcas e "edição, transformação, manipulação" sem autorização ([termos](https://imprensa.globo.com/termos-de-uso/)) | [oficial] |
| **ESPN** | [ESPN Press Room](https://espnpressroom.com/us/); fotos em library.espnimages.com (403) | Seção de logos e termos para a América Latina inacessíveis nesta data | [oficial, parcial] |
| **Disney+** (inclui o antigo Star+) | [press.disneyplus.com/about/logos](https://press.disneyplus.com/about/logos) | Logo para download; remete aos termos gerais da Disney | [oficial] |
| **Fox Sports** (EUA) | [Press Pass: photos & logos](https://www.foxsports.com/presspass/multimedia/photos-logos) | "All rights reserved"; o uso implica aceitar os termos. As operações de México e Argentina são de licenciados, sem sala de imprensa encontrada | [oficial] |
| **DAZN** | [Assets kit](https://dazngroup.com/assets-kit/) | Download livre, sem termos na página | [oficial] |
| **YouTube** | [Branding guidelines](https://developers.google.com/youtube/terms/branding-guidelines) | Não alterar cores; não ser o elemento mais destacado; deve linkar para conteúdo do YouTube; não sugerir endosso | [oficial] |
| **Prime Video** | [Marketing guidelines](https://videocentral.amazon.com/support/marketing-guidelines) | Parceiros de conteúdo só podem usar o texto "Available on Prime Video", **não o logo** | [oficial] |
| **TUDN / TelevisaUnivision** | [Manual de marca TUDN](https://view.ceros.com/univision/tudn-brand-guidelines) | Existe, mas não carregou para leitura; sem sala de imprensa do ViX encontrada | [oficial, não lido] |
| **TNT Sports / Max** (WBD) | press.wbd.com (403) | — | [não verificado] |
| **Paramount+** | paramountpressexpress.com (bloqueado por localização) | — | [não verificado] |
| **Telefe** | [Termos](https://www.mitelefe.com/legales/terminos-de-uso) | Sem sala de imprensa ou kit de logos | [oficial] |
| **Claro Sports** | [Termos](https://www.clarosports.com/terminos-y-condiciones/) | Só reserva genérica de PI; sem kit | [oficial] |

### 4.3 Uso referencial de logos de canais

- **EUA:** o teste de *nominative fair use* (*New Kids on the Block*, 9º Circuito, 1992) exige três coisas: o produto não pode ser identificado sem a marca; usa-se só o necessário dela; não se sugere patrocínio. Os circuitos divergem e a Suprema Corte não uniformizou ([KTS](https://ktslaw.com/insights/alert/2017/1/circuit-split-remains-scotus-passes-on-defining-nominative-fair-use)). [terceiros]
  - "Só o necessário" costuma significar **o nome, não o logo estilizado** ([Wikipedia: nominative use](https://en.wikipedia.org/wiki/Nominative_use)). [terceiros]
- **UE (art. 14(1)(c)) e Brasil (art. 132, IV):** valem as mesmas ressalvas da §1. No Brasil, "sem conotação comercial" estreita a proteção.
- **Recomendação** [inferência]:
  - **Nome do canal em texto:** sempre (risco baixo).
  - **Logo do canal:** só quando vier da operadora-cliente ou da emissora, com registro da origem.
  - **Logos baixados de press kits** (Globo à frente) **não** podem ser usados num produto comercial nem alterados sem autorização.
  - O acervo próprio no Figma deve ganhar a mesma trilha de origem (§7, Fase 0) e, idealmente, ser validado pelos clientes que exibem cada canal.

---

## 5. O autor do football-logos.cc

### 5.1 O que dizem o site e o repositório

- **Repositório** [github.com/Leo4815162342/football-logos](https://github.com/Leo4815162342/football-logos):
  - Não tem arquivo `LICENSE` nem declaração de licença. Sem licença, **todos os direitos ficam reservados por padrão**.
  - O README só descreve o acervo: "High Quality Football Logo Collection | SVG & PNG | 5300+ Logos". [oficial]
  - **O repositório não contém os escudos individuais.** A árvore do Git tem 235 arquivos. Em `logos/` estão **231 colagens de prévia em PNG**, uma por país, como `logos/brazil-1200x630.png`, conferidas pela API do GitHub em 2026-10-23. [oficial]
  - Os **~5.300 escudos individuais** ficam só no CDN do site, `assets.football-logos.cc`. As URLs seguem o padrão `logos/{país}/{tamanho}/{slug}.{hash}.png`, com tamanhos de 64×64 a 3000×3000, além de SVG. Exemplo: [Flamengo 256×256](https://assets.football-logos.cc/logos/brazil/256x256/flamengo.9c3055f2.png).
  - A página de cada país diz "Available as free SVG vectors and high-resolution transparent PNG files". **"Free" aqui quer dizer gratuito para baixar, não liberado para uso comercial.** [oficial + inferência]
  - **Consequência** [inferência]: o acervo que usamos vem do CDN do site, que é regido pela página `/license/`. Não vem de um repositório com licença aberta.
- **Rodapé do site** [football-logos.cc](https://football-logos.cc/):
  - "All logos are sourced, normalized, restored, and vectorized by Leo4815162342."
  - Contato: e-mail `info [at] football-logos.cc`, X [@Leo4815162342](https://x.com/Leo4815162342) e LinkedIn.
  - O rodapé lista "Official Shirt Partners", ou seja, o projeto tem parceiros comerciais. [oficial]
- **Página de termos** [football-logos.cc/license/](https://football-logos.cc/license/) (link "Legal" no rodapé; acesso em **2026-10-23**) [oficial]:
  - **Permitido:** os logos são apresentados "strictly for informational, editorial, and fan-based purposes". Isso cobre pesquisa, projetos de fãs e design **não comercial**.
  - **Proibido:**
    1. produtos comerciais ou merchandising;
    2. branding ou material promocional;
    3. sugerir afiliação com o dono do logo ou endosso dele.
  - **Para nós** [inferência]: uma API B2B paga e a exibição em telas de TV de operadoras se enquadram em "produto comercial". O mesmo vale para usar os escudos em material de venda ou demo comercial.
  - Os logos "are the intellectual property of their respective clubs, leagues, or associations"; o site não reivindica propriedade nem autoria dos logos.
  - Pedidos de remoção vão por X; o site promete remover "upon verified request".
  - **Não há** licença comercial, preço nem contato comercial.
- **Leitura** [inferência]:
  - O uso atual (produto B2B pago) **contraria os termos publicados**.
  - O autor pode licenciar **só o que é dele**, o trabalho de normalização e vetorização, e já declara que não é dono dos escudos.
  - Mesmo com o "sim" dele, a camada de marca e autoral dos clubes continua aberta.

### 5.2 Rascunho de mensagem (NÃO ENVIADO)

> **Não envie sem revisão.** O canal sugerido é o e-mail do site (`info [at] football-logos.cc`), com cópia por DM no X se não houver resposta em 10 dias úteis. Preencher os campos entre colchetes. Inglês, porque o site e o repositório são em inglês.

**Assunto:** Commercial license request: football-logos.cc vector work for a B2B sports data product

> Hi Leonid,
>
> I'm [nome], [cargo] at Galaxie Sports, a B2B sports data API for TV and streaming platforms in Latin America. We've been evaluating football-logos.cc: the consistency and quality of your vectorization stand out, especially on large TV screens.
>
> Your legal page limits use to informational, editorial and fan purposes, and rules out commercial products. Our use would be commercial, so we want to ask before going any further: would you grant us a **commercial license for your normalization and vectorization work**?
>
> Our use would look like this:
>
> - **B2B API:** we would store the PNG and SVG files on our own servers and CDN and serve them through our API to a limited number of paying business customers (TV operators and streaming platforms). We would not offer the files as a public download.
> - **TV screens:** those customers would show the crests next to match data in program guides (EPG), scoreboards, match pages and apps, on TVs, set-top boxes and mobile.
> - **No merchandising**, and no use of the crests in our own branding or advertising.
>
> The individual files are only on your CDN, so we'd also like to receive them through a channel you approve rather than downloading them from the site.
>
> We understand that the crests themselves are the property of the clubs, leagues and federations. **Clearing those trademark rights would remain our responsibility**, and we would never suggest any affiliation with you or with the rights holders.
>
> A few questions:
> 1. Do you offer commercial licenses, and on what terms (flat fee, annual fee, per logo, per customer)? We would start with the Latin American and main European competitions, roughly [N] crests.
> 2. Which files did you redraw yourself, and which came from official sources? Would you share that information per file?
> 3. Is there a way to receive updates (new crests, redesigns) in a structured form?
> 4. What attribution would you like, and where?
> 5. Can you remove a logo quickly if a rights holder asks?
>
> We're happy to start with a short call or a written proposal. Thanks for the work you've put into this collection.
>
> Best regards,
> [nome] · [cargo] · Galaxie Sports · [site] · [contato]

**Resumo em pt-BR:**
- Reconhecemos que os termos dele proíbem uso comercial e pedimos **licença comercial do trabalho de vetorização**.
- Explicamos o uso: guardar os arquivos no nosso CDN e servir por **API B2B** a operadoras pagantes, que os exibem em **telas de TV**, guias de programação, placares e apps. Não haverá merchandising nem uso em branding.
- Pedimos para receber os arquivos por um canal aprovado por ele, já que os escudos só existem no CDN do site.
- Deixamos claro que a liberação das marcas é responsabilidade nossa. Perguntamos sobre preço, procedência de cada arquivo, atualizações, atribuição e remoção rápida.

**Antes de enviar** [recomendação]:
- Decidir se a flag fica desligada nos feeds pagantes até a resposta. Isso reduz a exposição e é coerente com o que a mensagem diz.
- Pedir que a resposta venha **por escrito**, idealmente com minuta de licença.

---

## 6. Riscos de cada caminho

| Caminho | Riscos principais | Mitigação |
|---|---|---|
| football-logos.cc sem licença (situação atual) | Violação dos termos publicados; reclamação do autor; reclamação de clubes e ligas pelo escudo; cliente exposto | Flag desligada nos feeds pagantes; uso só em demo ou interno; takedown em menos de 24 h; trilha de origem por arquivo |
| football-logos.cc com licença do autor | Resolve só a parte do vetorizador; a procedência dos arquivos pode ser incerta (cópia de manuais oficiais?) | Exigir procedência por arquivo; manter a camada do titular no roadmap |
| Mídia dos fornecedores de dados (api-sports, Sportmonks) | Sem licença; responsabilidade nossa | Manter só como identificação, com aviso contratual ao cliente |
| Sportradar Images ou outro fornecedor com mídia licenciada | Custo; cobertura LatAm incerta; dependência; retenção após o contrato | RFP com perguntas fechadas (ver §7); prova de conceito |
| Agências (fotos) | Licença editorial insuficiente; direito de imagem do atleta; custo por volume | Contrato enterprise com cláusula B2B e lista de clientes; preferir headshots de bancos oficiais das ligas |
| Direto com ligas e federações | Prazo longo; exigências (exclusividade, branding, aprovação de layout); cobertura parcial (liga ≠ todos os clubes) | Priorizar as ligas com mais tráfego; aproveitar quem já tem pacote de mídia |
| Assets fornecidos pelos clientes | Variedade de formatos; o cliente pode não ter direito | Cláusula de garantia do cliente; normalização técnica de nossa parte |
| Wikimedia Commons | Erro de classificação PD; marca continua protegida | Usar só para PD claro e bandeiras; manter metadados de licença por arquivo |

---

## 7. Recomendação em fases

### Fase 0: agora (0 a 4 semanas). Custo: interno, mais uma consulta jurídica curta

1. **Flag do acervo football-logos.cc:**
   - Ligada **só** na demo, em vitrines internas e em POCs explicitamente não comerciais.
   - **Desligada por padrão** nos feeds de clientes pagantes até haver licença (decisão do produto).
2. **Trilha de origem por imagem** no storage, por exemplo `source` (`api-sports` | `football-logos` | `cliente` | `commons` | `licenciado:<contrato>`), `license_ref` e `takedown_at`. É o que permite responder a um pedido de remoção em horas e mostrar boa-fé. [inferência]
3. **Política de remoção:** contato público e SLA de 24 h.
4. **Contratos com clientes:**
   - Imagens de clubes, ligas e canais entregues "para fins de identificação". O cliente é responsável pelo uso promocional.
   - Opção de o cliente **enviar seus próprios assets** (logos de canais, sobretudo), que passam a ter prioridade no nosso pipeline.
5. **Mensagem ao autor do football-logos.cc** (§5.2), depois de revisada.
6. **Pergunta por escrito à api-sports** sobre redistribuição de mídia a clientes B2B, para registro.

### Fase 1: curto prazo (1 a 3 meses)

1. **Consulta jurídica em BR, AR e MX** com as perguntas da §8. Custo não público; orçar com escritório de PI.
2. **RFP de mídia licenciada:**
   - **Sportradar Images**, mais um detentor de dados oficial das ligas prioritárias (ex.: Genius Sports para Liga MX e Serie A).
   - Perguntas fechadas:
     - cobertura de escudos e headshots por liga LatAm;
     - direito de **sublicenciar a N operadoras** e de exibir na TV;
     - cache no nosso CDN;
     - retenção após o fim do contrato;
     - atualização de redesenhos;
     - preço por liga ou por cliente.
3. **Logos de canais:** pacote mínimo com os logos fornecidos pelos clientes e os press kits oficiais (§4).
4. **Wikimedia Commons** como fonte de bandeiras e escudos PD, com metadados.

### Fase 2: médio prazo (3 a 9 meses)

1. **Acordos diretos com ligas e federações prioritárias:** Brasileirão e CBF, LPF/AFA, Liga MX, CONMEBOL e as ligas europeias de maior audiência.
   - Objetivo: **licença de marcas para parceiro de mídia ou dados**, com escudos oficiais dos clubes participantes, logo da competição e manual de uso.
   - Onde houver detentor oficial de dados, negociar via ele.
2. **Agência de fotos** (Imago ou Getty) com contrato enterprise para headshots, ou bancos oficiais quando existirem (ex.: Yapoli e CBF para a Seleção).

### Fase 3: longo prazo (9 a 18 meses)

1. **Cobertura completa licenciada nas ligas tier 1**, com o football-logos.cc só como fallback interno, se licenciado.
2. **Programa de assets por cliente:** o cliente envia e aprova; a Galaxie normaliza e serve.
3. **Revisão anual** de contratos, cobertura e takedowns.

### Estimativa de custo e esforço (dados públicos são escassos)

| Item | Custo | Esforço | Fonte |
|---|---|---|---|
| Licença do autor do football-logos.cc | Desconhecido (sem preço publicado) | Baixo | §5 |
| Fotos de agência (editorial, avulso) | Imago: €999 por 100+ licenças (oferta inicial); Shutterstock: US$99–199 por imagem (2018) | Baixo | §3.1 |
| Fotos de agência (enterprise, feed B2B) | Sob cotação | Médio | §3.1 |
| Mídia de fornecedor de dados (Sportradar Images etc.) | Sob cotação | Médio | §3.2 |
| Licença de marcas de liga | Não público; depende da liga e do pacote | Alto, um contrato por liga | §3.3 |
| Consulta jurídica (3 países) | Não público | Baixo a médio | — |
| Trilha de origem e takedown no storage | Interno | ~1 a 2 semanas de dev [inferência] | §7 |

---

## 8. O que validar com advogado

1. **Brasil:**
   - O art. 87 da Lei Pelé alcança a **exibição** de escudos num feed B2B informativo, ou só a exploração comercial (merchandising)?
   - Como ele convive com o art. 132, IV da LPI, cujo "sem conotação comercial" pesa contra nós?
   - O PL 3.074/2024 muda algo?
2. **Uso nominativo e referencial em BR, AR, MX e UE:**
   - Mostrar o escudo para identificar o time num placar ou guia de TV é defensável?
   - E **entregar o arquivo** a terceiros pagantes? Qual a diferença entre o nosso papel (fornecedor) e o do cliente (exibidor)?
3. **México:** sem exceção expressa de uso informativo na LFPPI (art. 175), qual a base para exibir escudos sem licença? Há jurisprudência ou prática do IMPI?
4. **Argentina:** existe doutrina ou jurisprudência sobre uso nominativo de marca? Como a exigência de "deslealtad o engaño" (art. 31 da Ley 22.362) se aplica ao civil?
5. **Direito autoral dos escudos:**
   - Quem é o titular (clube, designer, liga)?
   - Escudos antigos estão em domínio público autoral? Isso tem efeito prático, dado que a marca segue protegida?
6. **Vetorização:**
   - O trabalho do football-logos.cc gera direito autoral próprio em BR, AR, MX e UE?
   - Usar os arquivos contra os termos do site gera responsabilidade contratual (termos de uso como contrato)?
7. **Sublicenciamento:**
   - Que cláusulas mínimas precisamos de um licenciante (liga, fornecedor, agência) para servir N operadoras?
   - Que garantias e indenizações podemos dar aos clientes?
8. **Fotos de atletas:**
   - Headshot num guia de programação ou placar é uso informativo nos três países (CC art. 20 BR, Ley 11.723 art. 31 e CCyC art. 53 AR, LFDA art. 87 MX)?
   - Precisa de consentimento além da licença da agência?
   - Há diferença para atletas menores (base, sub-17)?
9. **Logos de canais:**
   - O uso referencial para indicar "onde assistir" é defensável sem licença?
   - Os contratos de carriage dos clientes nos cobrem como fornecedores?
10. **Responsabilidade:**
    - A Galaxie e o cliente respondem juntos?
    - O Marco Civil (art. 19) não se aplica, porque somos a fonte. Há outra salvaguarda?
    - Que prazo de takedown é razoável?
11. **Termos da api-sports:** a cláusula "só para identificação" impede o uso das imagens dela num feed B2B mesmo como identificação?

---

## 9. Fontes (acesso em 2026-10-23)

**Leis e decisões**
- Lei Pelé (9.615/1998), texto consolidado, arts. 87 e 87-A: https://www.planalto.gov.br/ccivil_03/leis/l9615consol.htm
- PL 3.074/2024 (Senado): https://legis.senado.leg.br/sdleg-getter/documento?dm=9758918
- Diretiva (UE) 2015/2436, art. 14: https://www.legislation.gov.uk/eudr/2015/2436/chapter/2/section/3
- *Meshwerks v. Toyota* (10º Circuito, 2008): https://www.ca10.uscourts.gov/sites/ca10/files/opinions/01011513284.pdf
- Ley 22.362 (Argentina), WIPO Lex: https://www.wipo.int/wipolex/en/legislation/details/17281
- LFPPI (México), art. 175: https://mley.mx/LFPPI/articulo/175/ · https://sdv.com.mx/compendio/ley-federal-de-proteccion-a-la-propiedad-industrial/articulo-175/
- LFDA (México), art. 87: https://mley.mx/LFDA/articulo/87/
- SCJN, ADR 2808/2025: https://www.scjn.gob.mx/sites/default/files/estrado_electronico_notificaciones/documento/2026-06/UT-J-0252-2026-Informacion.pdf

**Doutrina e imprensa**
- Migalhas, símbolos do esporte × marcas: https://www.migalhas.com.br/coluna/pi-migalhas/267594/uma-comparacao-entre-os-simbolos-do-esporte-e-as-marcas
- Migalhas, limites ao uso de marcas: https://www.migalhas.com.br/depeso/352927/os-limites-a-utilizacao-de-marcas-em-pecas-publicitarias
- Dissertação no INPI sobre o art. 132: https://www.gov.br/inpi/pt-br/servicos/a-academia/arquivo/dissertacoes/SILVAMariaClaradeOliveira.pdf
- Bird & Bird sobre o C-361/22: https://brandwrites.twobirds.com/post/102nqfm/how-grilles-and-giftcards-brought-some-clarity-to-referential-use-of-trade-mar
- Garrigues sobre o C-361/22: https://blogip.garrigues.com/en?p=12221
- Diario Judicial (Ley 22.362): https://www.diariojudicial.com/news-31716-el-derecho-marcario-no-sirve-para-dirimir-los-conflictos-contractuales
- Diario Judicial (imagem de atleta): https://www.diariojudicial.com/news-71021-la-imagen-no-es-nada
- Campos Thomaz (CBF, foto "Três no Tri"): https://camposthomaz.com/en/conhecimento-ct/rio-court-upholds-ruling-against-cbf-for-unauthorized-use-of-historic-photograph/
- Mediotiempo (agências no Estádio Banorte): https://www.mediotiempo.com/futbol/liga-mx/conflicto-estadio-banorte-agencias-fotografia-deja-medios-imagenes-america-vs-santos

**football-logos.cc**
- Repositório: https://github.com/Leo4815162342/football-logos
- Site: https://football-logos.cc/
- Página legal (termos): https://football-logos.cc/license/
- Página de país, com as URLs do CDN `assets.football-logos.cc`: https://football-logos.cc/brazil/
- Árvore do repositório (API do GitHub): https://api.github.com/repos/Leo4815162342/football-logos/git/trees/HEAD?recursive=1

**Fornecedores de dados**
- Sportradar Images FAQ: https://developer.sportradar.com/images-and-editorials/reference/images-faqs
- Sportradar, logos: https://developer.sportradar.com/images-and-editorials/reference/images-logo-image
- Sportradar Images v3: https://developer.sportradar.com/images-and-editorials/reference
- SportsDataIO headshots: https://sportsdata.io/developers/sports-player-headshots-api
- SportsDataIO, direitos de dados: https://sportsdata.io/help/data-rights-and-licensing-questions
- Stats Perform e AP: https://www.svgeurope.org/blog/news-roundup/stats-perform-and-the-associated-press-extend-partnership-to-create-one-stop-sports-content-shop/
- Opta Graphics: https://www.statsperform.com/news/stats-perform-launches-opta-graphics-the-most-intuitive-multimedia-graphics-tool/
- Genius Sports e Serie A: https://www.businesswire.com/news/home/20250804278927/en/Genius-Sports-Secures-Exclusive-Official-Data-and-Betting-Streaming-Rights-with-Lega-Serie-A-Through-2029-to-Power-Next-Generation-BetVision-Product
- Genius Sports e Liga MX: https://www.insidersport.com/2020/11/25/genius-sports-to-raise-liga-mx-profile-in-streaming-and-data-agreement/
- Apple Developer Forums (termos da api-sports sobre logos): https://developer.apple.com/forums/thread/718427
- Brandfetch, fair use de logos: https://docs.brandfetch.com/guides/logo-fair-use · https://docs.brandfetch.com/docs/logo-api/guidelines
- Pesquisas internas: [api-sports-football.md](api-sports-football.md), [sportmonks.md](sportmonks.md)

**Agências**
- Getty, FAQ de uso de arquivos: https://www.gettyimages.com/faq/working-files
- Getty API: https://www.gettyimages.com/api
- Getty e UEFA: https://www.tipranks.com/news/the-fly/getty-images-renews-multi-year-partnership-with-uefa
- Getty, exemplo Liga MX "Strictly Editorial": https://www.gettyimages.ae/detail/news-photo/pavel-perez-of-necaxa-celebrates-after-scoring-his-teams-news-photo/2209822990
- Imago, guia de licenças: https://blog.imago-images.com/en/how-to-license-sports-images-a-complete-guide-by-imago
- Imago Connect (preço inicial): https://connect.imago-images.com/en/licensed-sports-images-for-creators-publishers-and-communities
- Imago e Mexsport: https://news.imago-images.com/en/new-at-imago/agencia-mexsport
- Shutterstock, termos da API: https://developers.shutterstock.com/api-terms
- Shutterstock Editorial (2018): https://investor.shutterstock.com/node/9996
- Shutterstock business media: https://www.shutterstock.com/business/media
- AP, fotos (espelho): https://kompas.wasmer.app/https_www_ap_org/content/formats/photos
- AP Developer (catálogo de API): https://jentic.com/apis/developer.ap.org/associated-press.md
- Reuters, conteúdo de parceiros: https://www.thomsonreuters.com/en/press-releases/2019/february/reuters-expands-sports-offering-with-content-partnerships
- EFE (NMC): https://www.newsmediacoalition.org/companyprofile/efe-agencia
- CBF e Yapoli: https://www.cbf.com.br/a-cbf/noticias/informes-cbf/a/cbf-escolhe-yapoli-para-gerir-distribuir-e-monetizar-fotos-e-videos-oficiais-da-selecao-na-copa-do-mundo

**Fontes abertas**
- Commons, regras por assunto (logos e marcas): https://commons.wikimedia.org/wiki/Commons:Copyright_rules_by_subject_matter
- Commons, limiar de originalidade: https://commons.wikimedia.org/wiki/Commons:Threshold_of_originality

**Ligas, federações e clubes**
- UEFA, Media Guidelines: https://editorial.uefa.com/resources/020a-0f8428bf2255-54a1767838ba-1000/uefa_s_media_guidelines_pdf_file_.pdf
- FIFA, legal, branding and rights: https://inside.fifa.com/organisation/contact-fifa/legal-branding-and-rights
- Premier League, termos e contato: https://www.premierleague.com/en/terms-and-conditions · https://www.premierleague.com/en/about/contact-us
- Football DataCo: https://www.football-dataco.com/
- LaLiga, logos, aviso legal e credenciamento: https://www.laliga.com/en-GB/pressroom/logos-and-corporate-dossier/logos · https://www.laliga.com/en-GB/legal/legal-web · https://www.laliga.com/en-GB/accreditations
- Bundesliga, mídia, diretrizes e Bundesliga Media: https://www.bundesliga-group.com/media/ · https://www.bundesliga-group.com/media/guidelines-and-accreditation/ · https://www.bundesliga-group.com/about/subsidiaries/bundesliga-media/
- Ligue 1, aviso legal: https://ligue1.com/fr/legal/legal-notice
- Liga MX via Leagues Cup, recursos de mídia: https://es.leaguescup.com/recursos-mediaticos/contactos/
- CBF, termos de uso: https://www.cbf.com.br/termos-de-uso
- Boca Juniors, imprensa: https://www.bocajuniors.com.ar/prensa

**Emissoras e EPG**
- Roku, EPG na The Roku Channel: https://developer.roku.com/dev/docs/epg-on-trc
- Cláusula-modelo de EPG em contrato de distribuição: https://lawinsider.com/clause/electronic-program-guide
- Schedules Direct, termos e FAQ: https://www.schedulesdirect.org/terms · https://www.schedulesdirect.org/faq
- TVmaze API: https://www.tvmaze.com/api
- Globo Imprensa e termos: https://imprensa.globo.com/ · https://imprensa.globo.com/termos-de-uso/
- ESPN Press Room: https://espnpressroom.com/us/
- Disney+, logos: https://press.disneyplus.com/about/logos
- Fox Sports Press Pass: https://www.foxsports.com/presspass/multimedia/photos-logos
- DAZN, assets kit: https://dazngroup.com/assets-kit/
- YouTube, branding guidelines: https://developers.google.com/youtube/terms/branding-guidelines
- Prime Video, marketing guidelines: https://videocentral.amazon.com/support/marketing-guidelines
- TUDN, manual de marca: https://view.ceros.com/univision/tudn-brand-guidelines
- Telefe, termos: https://www.mitelefe.com/legales/terminos-de-uso
- Claro Sports, termos: https://www.clarosports.com/terminos-y-condiciones/
- KTS sobre nominative fair use: https://ktslaw.com/insights/alert/2017/1/circuit-split-remains-scotus-passes-on-defining-nominative-fair-use
- Wikipedia, nominative use: https://en.wikipedia.org/wiki/Nominative_use
