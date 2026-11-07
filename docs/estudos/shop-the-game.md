# Estudo: Shop the game no Galaxie

> Estudo de 07/11/2026. Fonte original: https://claude.ai/artifact/GYReqXurUxtJPr3h1GTHYf
> Épico de execução: ver issues com a label **Shop the game**.
>
> **Decisões tomadas depois do estudo (07/11/2026):**
> - Modelo de afiliado, não dropshipping. O nosso código de afiliado só roda no site e no app Galaxie.
> - Com os clientes, dividimos a comissão, sem taxa fixa (repasse por sub-rede onde a loja aceita; código do cliente com taxa de sucesso onde não aceita).
> - A porcentagem da divisão é configurável por cliente, conforme o que for negociado com cada um. Os 70% a 75% para o cliente citados abaixo são só uma sugestão de partida.
> - Produto, imagem e link só vêm das ferramentas oficiais de afiliado: Impact (Fanatics), programa ou API do Mercado Livre, Creators API (Amazon), feeds do Awin. Nunca raspar site de loja.
> - Compra nunca dá ponto, selo nem prêmio (gamificação, comunidades, bolão).
> - Nos EUA, quem se cadastra, assina e recebe é a LLC de Wyoming; Brasil, Latam e Hispam ficam com a Galaxie Works Ltda.

O Shop the game é viável e barato de construir, mas como **programa de afiliados**, não como dropshipping: a loja vende, entrega e atende; nós mostramos o produto do time e recebemos de 4% a 11% de cada venda. No Brasil os melhores parceiros são Netshoes, Centauro e Mercado Livre, com a Amazon pela confiança e pela API; nos EUA, a Fanatics, que opera as lojas oficiais da NFL, NBA, MLB e MLS.

O ponto que muda o desenho: o nosso link de afiliado só pode rodar no app e no site Galaxie. No widget white-label do cliente, dividimos a comissão sem cobrar taxa fixa: repasse onde a loja aceita sub-rede (Awin, Impact), e código do cliente com taxa de sucesso onde não aceita (Amazon). Com 1 milhão de visitas por mês em páginas de jogo, a comissão própria fica perto de R$ 11 mil por mês.

Recomendação: cadastrar a Galaxie Works Ltda nos programas brasileiros agora, lançar um piloto com os 20 times da Série A no site Galaxie, e abrir o Shop the game nos portais dos clientes, com divisão da comissão, e os EUA (pela LLC) depois de 30 dias de números reais.

## Afiliado não é dropshipping

O que dá renda com Shop the game é ser **afiliado**, e isso é bem mais simples que dropshipping. São dois modelos diferentes:

|  | Afiliado | Dropshipping |
|---|---|---|
| Quem vende | A loja (Amazon, Mercado Livre, Netshoes, loja do clube) | Você. A loja é sua, o fornecedor só despacha |
| Quem recebe o pagamento, emite nota e faz o SAC | A loja | Você |
| Estoque, frete, troca e devolução | Problema da loja | Problema seu, mesmo sem ver o produto |
| Como você ganha | Comissão de 1% a 12% sobre a venda que seu link gerou | A diferença entre o seu preço e o do fornecedor |
| Risco | Quase nenhum: no pior caso, a comissão é zero | Chargeback, produto falsificado, Procon, imposto sobre a venda inteira |

No afiliado, o torcedor clica em "Comprar" no widget, cai na página da Amazon (ou do Mercado Livre) com um código nosso no link, compra lá, e a loja nos paga uma porcentagem no mês seguinte. Nós não tocamos em dinheiro do torcedor, não emitimos nota de produto e não fazemos entrega.

Dropshipping de camisa de time tem um problema extra: camisa oficial só chega por distribuidor licenciado, e quase todo dropshipping de camisa barata é réplica, o que é contrafação de marca. Por isso o estudo descarta dropshipping.

## Programas candidatos

Os melhores encaixes são Netshoes/Centauro e Mercado Livre no Brasil, e Fanatics nos EUA, porque vendem camisa oficial e pagam mais que a Amazon em artigo esportivo. A Amazon entra pela confiança e pela API de catálogo, não pela comissão.

| Programa | País | Comissão em esporte/moda | Janela do clique (cookie) | Catálogo por API | Como entra |
|---|---|---|---|---|---|
| [Amazon Associados](https://www.divulganinja.com.br/blog/quanto-ganha-um-afiliado-amazon-no-brasil-2026/) | BR | até 13% em moda; esporte varia (ver tabela oficial) | 24 h (90 dias se o item foi para o carrinho) | Sim, Creators API | Cadastro grátis; precisa vender nos primeiros meses para manter a conta |
| Amazon Associates | EUA | cerca de 3% a 4% em esporte e vestuário (aproximado, de memória; conferir a tabela oficial) | 24 h | Sim, Creators API | Mesmo modelo, cadastro pela LLC |
| [Mercado Livre Afiliados](https://www.divulganinja.com.br/blog/quanto-mercado-livre-paga-afiliados-comissoes) | BR | 4% a 10% esporte; 6% a 16% moda | definida no painel | Não há API de afiliado pública confirmada: link gerado no painel | CPF ou CNPJ; paga no Mercado Pago |
| [Netshoes](https://www.divulganinja.com.br/blog/netshoes-afiliados-como-cadastrar-divulgar-2026) (via Awin) | BR | 4% a 8% | 30 dias | Deeplinks; feed de produtos a confirmar no Awin | Conta de publisher no Awin + aprovação da marca |
| [Centauro](https://ui.awin.com/merchant-profile/17806) (via Awin) | BR | 11% sem cupom; 6% com cupom; 0% marketplace | 1 dia | Feed a confirmar | Awin + aprovação; afiliado estrangeiro paga taxa de 25% |
| Magalu (Parceiro Magalu) | BR | não verificado neste estudo | não verificado | não verificado | Pouco forte em camisa oficial; baixa prioridade |
| [Fanatics](https://getlasso.co/affiliate/fanatics/) (via Impact) | EUA | 8% em tudo | 7 dias | Feed via Impact, a confirmar | Aprovação em poucos dias; devolução estorna a comissão |
| Redes Awin, Rakuten, Impact, CJ | BR e EUA | depende de cada loja | depende | Muitas lojas dão feed de produtos | Uma conta por rede, depois uma aprovação por loja |

**O que é a API da Amazon hoje.** A antiga Product Advertising API 5 foi [desligada em 2026](https://www.keywordrush.com/blog/?p=245); quem chama recebe erro 403. A substituta é a [Creators API](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation?tag=searcht-20), que devolve título, preço, disponibilidade, imagens e o link já com o nosso código. Historicamente a Amazon só libera a API para contas com vendas recentes (a regra antiga era 10 vendas em 30 dias); precisamos confirmar o critério atual no cadastro.

**Por que Fanatics importa nos EUA.** A Fanatics opera as lojas oficiais da NFL, NBA, MLB e MLS. Um único programa cobre os quatro mercados que estão no plano americano.

**Lojas dos clubes.** Palmeiras e Corinthians têm lojas oficiais próprias. Alguns clubes têm programa de afiliados em redes como Awin; isso precisa ser levantado clube a clube, começando pelos 20 da Série A.

## Regras que mudam o desenho

A regra mais importante: **o link de afiliado só pode rodar em site nosso.** Num widget white-label instalado no portal de um cliente, a comissão tem que ser do cliente, com o código de afiliado dele.

**1. Widget em site de terceiro.** As [regras da Amazon](https://affiliate-program.amazon.com/help/operating/participation/) proíbem exibir links com o nosso código "em um site que não é o seu Site", proíbem sublicenciar o conteúdo e proíbem dar sub-códigos a usuários finais. Redes como Awin e Impact seguem a mesma lógica: cada site que exibe o link tem que estar declarado na conta do afiliado. Consequência prática:

- No app e no site do Galaxie (galaxiesports.com), usamos os nossos códigos e ficamos com a comissão.
- No widget do cliente, o nosso código comum não pode rodar. A comissão vai para o cliente por repasse, onde a loja aceita sub-rede, ou pelo código dele com taxa de sucesso para nós. Detalhes na seção de repasse abaixo.
- A divisão da comissão precisa de um formato que a loja aprove (sub-rede ou contrato direto), nunca improvisada em cima de uma conta comum.

**2. Smart TV.** A Amazon proíbe links e conteúdo do programa em TVs conectadas e set-top boxes. O Shop the game não entra no app de TV (smarttv.galaxiesports.com) com Amazon; no máximo um QR code para outra loja que permita, a confirmar caso a caso.

**3. App de celular.** A Amazon aceita app gratuito nas lojas oficiais, mas proíbe abrir a página dela dentro do app (WebView). O botão "Comprar" tem que abrir o navegador ou o app da Amazon.

**4. Preço e imagem.** Preço só pode aparecer se vier da API, e o dado em cache vale no máximo 24 horas. Imagem não pode ser guardada no nosso servidor: mostramos a URL da imagem que a API devolve.

**5. Quem se cadastra.**

| Programa | Entidade | Observação |
|---|---|---|
| Amazon.com.br, Mercado Livre, Awin Brasil | Galaxie Works Ltda (CNPJ) | Comissão entra como receita de serviço no Brasil; o contador define o enquadramento |
| Amazon.com, Fanatics/Impact, CJ, Rakuten | LLC de Wyoming (pronta perto de 14/11) | Pede EIN e formulário fiscal do IRS; usar a LLC evita a taxa de 25% que redes cobram de afiliado estrangeiro |

**6. Produto oficial e licenciamento.** Quem tem que ter licença para vender a camisa é a loja, não o afiliado. O nosso cuidado é outro:

- Mostrar só produto oficial. No Mercado Livre e no marketplace da Amazon há muita réplica; filtramos por vendedor oficial ou pela marca fornecedora do clube (por exemplo, Puma no Palmeiras e Nike no Corinthians).
- Não sugerir parceria que não existe. "Produtos do Palmeiras" é descrição; "Loja oficial Galaxie do Palmeiras" ou o escudo usado como selo não.
- Avisar que são links de afiliado, como pedem o CONAR no Brasil e a FTC nos EUA: um rótulo "Links de parceiros" no widget resolve.

## Dividir a comissão com o cliente (repasse)

Dá para fazer repasse, e sem cobrar nada fixo do cliente. Mas só em parte das lojas: nas redes (Awin, Impact, CJ) entrando como sub-rede, e na Amazon não. Onde o repasse não é permitido, o cliente usa o código dele e nos paga uma taxa de sucesso, só sobre o que vender.

**Por que o estudo tinha posto a comissão no cliente.** O problema não é dividir dinheiro, é onde o link aparece. Os programas pagam comissão a quem é dono do site. Se o nosso código roda no portal de um cliente, para a Amazon isso é link em "site que não é o seu", e ela fecha a conta e retém as comissões. Para a loja também não é transparente: ela acha que a venda veio do Galaxie, mas veio do portal.

**Como o repasse funciona onde é permitido.** As redes têm um tipo de conta feito para isso, a [sub-rede](https://help.awin.com/docs/subnetworks): um parceiro que traz vários sites debaixo do nome dele e repassa parte da comissão. É o modelo do Skimlinks e do Sovrn Commerce, que, segundo [fontes secundárias](https://www.makeinfluence.com/en/academy/skimlinks-viglink-sovrn-commerce-and-automatic-affiliate-link-conversion), ficam com cerca de 25% e repassam 75% aos sites. As regras da sub-rede no Awin:

- Ser declarada como sub-rede e responder pelos sites que traz.
- Cada venda mostra à loja de qual site veio, e a loja pode bloquear um site.
- Evitar fraude (cookie forçado, compra do nome da marca no Google).

Cada loja decide se aceita sub-rede. Muitas aceitam; algumas recusam. Só sabemos loja a loja, depois do cadastro.

**As três opções por loja:**

| Loja | Repasse pela Galaxie | Alternativa |
|---|---|---|
| Amazon (BR e EUA) | Não permitido: sem sub-códigos para terceiros, sem link em site que não é nosso | Código do cliente + taxa de sucesso |
| Netshoes, Centauro e outras no Awin | Sim, se a Galaxie for aprovada como sub-rede e a loja aceitar sub-redes | Código do cliente + taxa de sucesso |
| Fanatics e outras no Impact ou CJ | Sim, com acordo de parceiro aprovado pela loja (as redes têm a mesma figura de sub-rede ou plataforma) | Código do cliente + taxa de sucesso |
| Mercado Livre | Não verificado; o programa é pensado para criadores individuais | Código do cliente + taxa de sucesso |
| Loja com contrato direto | Sim: o contrato já nasce prevendo os sites dos parceiros | não precisa |

**A taxa de sucesso, na prática.** O cliente cria um código só para o widget (a Amazon deixa criar vários códigos de rastreio na mesma conta) e manda o relatório dele todo mês. Nós conferimos com os nossos registros de clique e cobramos uma porcentagem do que ele recebeu. Se não vender nada, ele não paga nada: resolve o mesmo problema que o repasse.

**Imposto e contrato.** As duas formas dão o mesmo dinheiro ao cliente, mas pesam diferente no imposto:

- **Repasse:** a Galaxie recebe a comissão inteira, e ela conta como receita nossa. No Simples Nacional o imposto incide sobre o total, mesmo a parte que vai para o cliente. O cliente emite nota de serviço para receber a parte dele.
- **Taxa de sucesso:** a Galaxie só fatura a parte dela, e o imposto incide só sobre essa parte.
- Nos EUA, pela LLC: recolher o formulário fiscal de cada cliente (W-9 para americano, W-8BEN-E para estrangeiro) e emitir os informes anuais do IRS quando couber.
- Pagamento para cliente no exterior, saindo do Brasil, é remessa com câmbio e tributos próprios. Melhor cada entidade pagar cliente do próprio país.
- O contrato precisa dizer: a porcentagem, que o repasse só sai depois que a loja nos paga (de 60 a 90 dias), que devolução estorna a comissão, e que o cliente segue as regras da loja.

O contador precisa confirmar os dois pontos fiscais antes da primeira assinatura.

**Recomendação.** Nenhuma taxa fixa para o cliente. Em cada loja, repasse pela Galaxie quando a loja aceitar sub-rede ou fizer contrato direto. Onde não aceitar, ou quando o cliente preferir, o código dele com taxa de sucesso. Como referência de mercado, 70% a 75% da comissão para o cliente.

## Como casar produto com time e jogo

O casamento é feito por um cadastro nosso de "time → como achar os produtos dele em cada loja", não por busca solta. Busca solta por "Palmeiras" traz réplica, caneca genérica e produto do rival.

**O que vai no cadastro de cada time** (uma tabela nova, ligada ao id do time que já temos da api-sports):

- Marca fornecedora e temporada do uniforme (Puma, Nike, Adidas…).
- Palavras de busca e filtros por loja: ASINs ou categoria na Amazon, vendedor oficial no Mercado Livre, página do time na Netshoes/Centauro, "team slug" na Fanatics.
- Lista curada de 6 a 12 produtos "âncora" (camisa 1, camisa 2, agasalho, boné, caneca), revisada por temporada.

**Como o widget escolhe o que mostrar num jogo**:

1. Pega os dois times do jogo (já temos isso em qualquer evento).
2. Para cada time, busca os produtos âncora e consulta preço e estoque na loja (Creators API na Amazon, feed da rede nas outras), com cache de no máximo 24 horas.
3. Ordena pelo contexto do jogo: com a escalação saída, sobe a camisa do jogador destaque; em clássico, sobe produto comemorativo; em final, produto de campeão depois do apito.
4. Esconde o que está sem estoque ou sem preço e, sem nada para mostrar, não exibe o widget.

Na Série A, 20 times; nas quatro ligas americanas, 30 a 32 times cada. Cerca de 150 cadastros cobrem o que importa para o piloto, e o resto do catálogo pode usar só a busca filtrada pela marca oficial.

## O widget Shop the game

Um novo tipo de widget no Builder, `shop_the_game`, com duas colunas (uma por time) de 3 a 6 produtos: foto, nome, preço, loja e botão "Comprar". No rodapé, o aviso "Links de parceiros: podemos receber comissão".

Opções no Builder, no mesmo padrão das opções dos outros widgets:

- Lojas ligadas e ordem (Amazon, Mercado Livre, Netshoes, Centauro, Fanatics).
- Por loja: repasse pela Galaxie (onde a loja aceita) ou código de afiliado do cliente.
- Quantos produtos por time e se mostra preço.
- Modo do jogo: antes, ao vivo, depois ("campeão" após a final).

No app e no site Galaxie ele aparece na página do jogo e na página do time. Cada clique é registrado (jogo, time, produto, loja), para medir a conversão e mostrar ao cliente quanto o widget rendeu.

## Cenários de receita

Comissão só vira dinheiro relevante com tráfego grande: com 1 milhão de visitas por mês em páginas de jogo, o site Galaxie renderia cerca de R$ 11 mil por mês. Por isso o volume vem da divisão da comissão com os portais dos clientes, que têm muito mais tráfego que o Galaxie.

**Comissão no app e no site Galaxie** (premissas: 1,5% das visitas clicam em um produto, 3% dos cliques viram compra, comissão média de 8%; ticket de R$ 300 no Brasil e US$ 90 nos EUA):

| Cenário | Visitas em páginas de jogo por mês | Cliques | Pedidos | Vendas geradas | Comissão por mês |
|---|---|---|---|---|---|
| Brasil, início | 100 mil | 1.500 | 45 | R$ 13.500 | R$ 1.080 |
| Brasil, médio | 1 milhão | 15.000 | 450 | R$ 135.000 | R$ 10.800 |
| Brasil, forte | 5 milhões | 75.000 | 2.250 | R$ 675.000 | R$ 54.000 |
| EUA, médio | 1 milhão | 15.000 | 450 | US$ 40.500 | US$ 3.240 |

As premissas são estimativas de mercado, não medidas nossas; o primeiro mês de piloto troca os números pelos reais. Picos multiplicam o mês: clássico, final, lançamento de uniforme e Black Friday. Na Amazon a comissão é menor (3% a 4% nos EUA), mas o cookie de 24 horas paga qualquer compra feita na sequência, não só a camisa.

**Divisão com os clientes** (sem taxa fixa): ficamos com 25% a 30% da comissão gerada no site do cliente, por repasse ou por taxa de sucesso. Um portal com 1 milhão de visitas em páginas de jogo gera cerca de R$ 10.800 de comissão por mês: R$ 2.700 a R$ 3.240 para nós e o resto para ele. Com 10 portais assim, R$ 27 mil a R$ 32 mil por mês. Para portais grandes, o argumento de venda é o relatório de cliques e vendas por jogo.

## Termos das redes de afiliado: riscos e como proceder

Li os termos das redes que vamos usar, para saber o que o cliente pode e não pode fazer. O ponto novo mais importante: **comprar nunca pode dar ponto, selo ou prêmio** na gamificação ou no bolão, porque a Amazon proíbe recompensar quem usa o link, e no Brasil isso também faria o bolão precisar de autorização da Fazenda.

| Rede | O que os termos dizem | Risco | Como procedemos |
|---|---|---|---|
| [Amazon Associates: requisitos](https://affiliate-program.amazon.com/help/operating/participation/) | §6(g): proibido dar recompensa, pontos, desconto ou programa de fidelidade a quem usa o link. §4: proibido uso offline. §5: proibido em software cliente e set-top box de TV, salvo app móvel aprovado. §2(a): preço só vindo da API, com data e hora ao lado. §2(b): sub-tags só com aprovação e nunca ligadas a um usuário específico | Conta encerrada e comissões perdidas | Compra fora da carteira de pontos. Preço com data e hora. Nada de link Amazon na TV. Sub-tag por cliente, nunca por torcedor |
| [Amazon Associates: políticas](https://affiliate-program.amazon.com/help/operating/exclusions) | §6(b): link com a nossa tag só em site nosso. §6(n) e política de apps: não abrir a Amazon dentro de WebView. §1(f): site voltado a menores de 13 não pode participar | Mesmo acima | Widget white-label usa a tag do próprio cliente, como já está neste estudo. Link sempre abre fora do app. Comunidade com público infantil fica sem Amazon |
| [Awin: código de conduta de sub-redes](https://resources.awin.com/code-of-conduct-subnetwork/en-gb/) | A sub-rede precisa se declarar como sub-rede no perfil, identificar cada sub-afiliado no clickref, responde pelos atos deles como se fossem dela e tem 24 h para reconhecer e 48 h para resolver uma violação | Cliques não pagos, suspensão | Galaxie declarado como sub-rede; um clickref por cliente; contato de conformidade nomeado; cláusula no contrato do cliente com as mesmas regras |
| Cupons (ex.: [termos de um anunciante na Awin e na Impact](https://ui.awin.com/merchant-profile-terms/74100)) | Só cupom atribuído ao afiliado pode ser usado; usar cupom alheio estorna a comissão | Comissão estornada | Prêmio do bolão em cupom só com código emitido para aquele cliente |
| Mercado Livre Afiliados | A [página do programa](https://mercadolivre.com.br/l/afiliados-home) bloqueia leitura automática; não consegui ler os termos | Os termos gerais do site (versão de 15/10/2026, §12) proíbem robôs, scrapers e agentes de IA de acessar, extrair ou redistribuir conteúdo sem autorização expressa, e protegem imagens e descrições (§10). Puxar produtos raspando o site viola isso | Produtos e imagens só pelos links e ferramentas oficiais do programa ou pela API do Mercado Livre, nunca raspando o site. Os termos específicos do programa de afiliados ainda precisam ser lidos logado na conta da Galaxie Works |
| Fanatics (Impact) | Termos de uso do site (29/02/2024): proibido criar link para qualquer página sem permissão escrita, usar framing, copiar imagens e textos, ou extrair dados com robô para uso comercial (§3); marcas e logos só com permissão (§10); compra só para maiores de 18 e regida pela lei de Delaware, com arbitragem obrigatória e sem ação coletiva (§21, §22) e responsabilidade limitada (§17, §18) | Link, imagem ou catálogo fora do programa de afiliado viram uso não autorizado; o torcedor compra sob regras americanas que talvez não espere | Só links, imagens e catálogo vindos da Impact (a aprovação no programa é a permissão escrita); nada de raspar o site nem abrir a loja dentro do widget; aviso no widget de que a compra é feita na Fanatics, sob os termos dela. O contrato de afiliado da Impact ainda precisa ser lido no cadastro da LLC |

Isso é um mapa para o advogado e o contador, não um parecer. A regra prática para o cliente vira uma lista de checagem dentro do Builder: "o widget vai para site seu?", "é app ou TV?", "o público é infantil?", e o Builder só libera os links que cabem na resposta.

## Nos EUA, tudo pela LLC

Nos EUA, quem se cadastra nas lojas, assina com os clientes e recebe e paga comissões é a LLC de Wyoming. A Galaxie Works Ltda fica com Brasil, Latam e Hispam.

| Peça | O que muda com a LLC |
|---|---|
| Contas de afiliado (Impact/Fanatics, Amazon.com e outras) | Cadastro em nome da LLC, com o EIN dela e conta bancária em dólar. Na entrevista fiscal das redes vai o formulário W-8 ou W-9 que o contador indicar; um formulário errado pode levar a retenção de 30% nas comissões |
| Repasse para clientes americanos | A LLC paga o cliente em dólar e pede o W-9 dele. Acima do limite anual, ela emite o 1099 para o cliente (o limite subiu para US$ 2 mil a partir de 2026, a confirmar) |
| Taxa de sucesso na Amazon (código do cliente) | A LLC fatura o cliente americano em dólar |
| Contrato com o cliente | Lei de Wyoming, com arbitragem ou foro em Wyoming |
| Imposto | A LLC entrega o Form 5472 com o 1120 pro forma todo ano; o lucro é tributado no Brasil para o dono. A regra do Simples sobre repasse, deste estudo, vale só para a Ltda |
| Entre Ltda e LLC | Contrato de serviço com preço de mercado, se a Ltda fizer o trabalho e a LLC vender |

Nada disso substitui o contador e o advogado; é a lista do que levar para eles.

## Riscos

| Risco | O que acontece | Como evitar |
|---|---|---|
| Conta de afiliado banida | Amazon fecha a conta e retém as comissões se o link aparecer em site não declarado, TV ou WebView | Nosso código só no site e no app Galaxie; cliente usa o código dele |
| Sem vendas no começo | Amazon encerra a conta e não libera a API sem vendas recentes | Começar com links curados sem API e gerar as primeiras vendas |
| Réplica no catálogo | Torcedor recebe camisa falsa e a marca do cliente fica manchada | Filtrar por vendedor oficial e marca fornecedora; lista âncora curada |
| Parecer parceria oficial | Clube reclama do uso do nome e do escudo como selo de loja | Texto descritivo e aviso de link de parceiro |
| Pouco tráfego próprio | Comissão fica em centenas de reais por mês | Tratar a comissão própria como bônus; o volume vem da divisão com os portais |
| Regras mudam | Programas trocam comissão e API sem aviso (a PA-API foi desligada em 2026) | Uma camada nossa por loja; trocar ou desligar uma loja sem mexer no widget |
| Conflito com cliente | Portal já tem acordo próprio com uma loja ou com um patrocinador | Lojas liga e desliga por cliente; nada ligado por padrão fora do Galaxie |
| Imposto e câmbio | Comissão em dólar ou euro com taxa de rede e retenção | Programas americanos pela LLC; o contador define o enquadramento no Brasil |

## Caminho recomendado

Começar pelo Brasil, no site e no app Galaxie, com links curados e sem API; abrir o widget para os clientes, com divisão da comissão, e os EUA quando os primeiros números reais chegarem. Os prazos de desenvolvimento consideram agentes Claude de fronteira (Opus, Fable) fazendo o código, sem time humano; o que demora é a aprovação das lojas.

| Fase | O que entra | Desenvolvimento | Depende de |
|---|---|---|---|
| 0. Cadastros | Amazon Associados, Mercado Livre e Awin (Netshoes, Centauro) pela Galaxie Works Ltda | nenhum | Aprovação das lojas: dias a 2 semanas |
| 1. Piloto Brasil | Cadastro dos 20 times da Série A, links curados, widget na página do jogo, registro de cliques | 1 a 2 dias | Fase 0 aprovada |
| 2. Catálogo vivo | Creators API da Amazon e feeds do Awin; preço e estoque atualizados | 1 a 2 dias | Vendas suficientes para a Amazon liberar a API |
| 3. Módulo para clientes | Widget `shop_the_game` no Builder com repasse ou código do cliente por loja, cadastro como sub-rede no Awin e no Impact, e relatório por jogo | 2 a 3 dias | Piloto com 30 dias de números |
| 4. EUA | Fanatics via Impact e Amazon.com pela LLC; times de MLS, NBA, MLB e NFL | 2 a 3 dias | LLC com EIN (a partir de 14/11) e aprovação da Fanatics |

**Decisões que estavam em aberto no estudo** (a divisão sem taxa fixa já foi decidida, ver o topo):

- Aprovar os cadastros da fase 0 pela Galaxie Works Ltda.
- Definir a divisão com o cliente (sugestão: 70% a 75% para ele, sem taxa fixa).
- Confirmar com o contador como a comissão entra no Brasil e na LLC.

O que não recomendo: dropshipping, e colocar o nosso código nos widgets dos clientes sem a aprovação da loja como sub-rede.

## Fontes

- [Amazon: regras de participação do Programa de Associados](https://affiliate-program.amazon.com/help/operating/participation/)
- [Amazon: aviso de desligamento da PA-API 5 e Creators API](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation?tag=searcht-20)
- [Keywordrush: datas da troca para a Creators API](https://www.keywordrush.com/blog/?p=245)
- [Divulga Ninja: comissões Amazon Associados Brasil 2026](https://www.divulganinja.com.br/blog/quanto-ganha-um-afiliado-amazon-no-brasil-2026/)
- [Divulga Ninja: comissões Mercado Livre Afiliados](https://www.divulganinja.com.br/blog/quanto-mercado-livre-paga-afiliados-comissoes)
- [Divulga Ninja: Netshoes Afiliados 2026](https://www.divulganinja.com.br/blog/netshoes-afiliados-como-cadastrar-divulgar-2026)
- [Awin: perfil do anunciante Centauro BR](https://ui.awin.com/merchant-profile/17806)
- [Lasso: programa de afiliados Fanatics](https://getlasso.co/affiliate/fanatics/)

Comissões mudam com campanhas; os números acima devem ser conferidos no painel de cada programa depois do cadastro. A taxa da Amazon nos EUA e o programa da Magalu não foram verificados em fonte aberta.
