# Gamificação para todos os esportes

Estudo de 07/11/2026. Fonte viva: o documento "Gamificação para todos os esportes" no projeto. Épico de desenvolvimento com a label `Gamificacao`.

> **As decisões do Wagner de 07/11 (seção "Decisões tomadas") valem sobre as recomendações do corpo do estudo quando as duas divergem**: idade 18+ para todo o módulo, economia por cliente e por país, arte gerada por IA sem entidades reais.

## Resumo

Dá para fazer, e o Galaxie tem uma vantagem que quase ninguém tem: as conquistas podem ser disparadas pelo que acontece de verdade no jogo (gol nos acréscimos, triple-double, no-hitter, nocaute no 1º round), porque esses eventos já passam pelo nosso ao vivo. O produto vira um módulo que o cliente liga no painel e entrega por widget e por webhook.

O que recomendo:

- **Conquistas com 5 níveis** (Bronze, Prata, Ouro, Platina, Lendário), mais conquistas únicas para momentos raros. Cerca de 25 conquistas comuns a todos os esportes e 8 a 12 próprias de cada esporte.
- **Cartas colecionáveis ganhas, nunca compradas.** Cada carta sai de uma conquista ou de um evento real do jogo, sem sorteio. O usuário consegue no máximo metade de uma coleção sozinho; o resto vem de troca, como no Steam.
- **Marketplace fechado**: troca de cartas e venda por pontos, com taxa em pontos e sem nenhum saque em dinheiro.
- **Pontos com valor honesto.** O sistema recomenda ao cliente quanto vale 1 ponto a partir do orçamento de prêmios dele, e mostra o valor em reais ou dólares para o usuário.
- **Quatro regras de ouro jurídicas**: nada pago com resultado aleatório, nada que vire dinheiro fora do programa nada de cartas ou pontos com valor para menores de 18 anos e nenhuma conquista ou ponto ganho por compra.

Sobre a piada do Livelo/Stix: dá para entender a matemática deles e usar a parte saudável (pontos que expiram, pontos + dinheiro). Mas um sistema desenhado para nunca pagar sozinho é exatamente o que o Procon, o CDC e a FTC punem. A FTC multou a dona do Genshin Impact em US$ 20 milhões em janeiro de 2025 por enganar sobre o custo real dos pacotes pagos em moeda virtual. A seção de pontos mostra o modelo que recomendo no lugar.

MVP: motor de conquistas com futebol, basquete e futebol americano em 2 a 3 dias de desenvolvimento por agentes Claude de fronteira, com as issues em paralelo. O pacote completo, com cartas, pontos e marketplace, fica em cerca de 2 semanas corridas. O gargalo não é escrever código: é revisão e merge, a geração e curadoria da arte e o portão jurídico, que precisa terminar antes de ligar pontos com valor.

## De onde vêm os gatilhos

Toda conquista junta duas coisas: o que o **fã** fez (acompanhou, palpitou, seguiu, explorou) e o que o **jogo** fez (o evento real). O primeiro lado vem do widget ou do app do cliente; o segundo já temos, porque somos espelho da api-sports.

| Esporte | Eventos que temos e que viram gatilho | Detalhe do dado |
| --- | --- | --- |
| Futebol | gols com minuto, viradas, pênaltis, cartões, VAR, escalações, notas e estatísticas de jogador, tabela, artilharia | o mais rico: evento a evento ao vivo |
| Basquete e NBA | placar por quarto, estatísticas de jogador (pontos, rebotes, assistências), prorrogação | triple-double sai do box score; buzzer-beater não dá, porque a API de basquete não tem lance a lance (só placar por quarto e estatísticas agregadas) |
| Beisebol | placar por entrada, rebatidas, home runs, erros | no-hitter e virada no 9º inning saem do placar por entrada |
| Futebol americano (NFL e NCAA) | placar por quarto, estatísticas de jogador e de time | virada no 4º quarto, jogo decidido em field goal no fim |
| Hóquei | gols por período, prorrogação, shootout | hat-trick e vitória no shootout |
| Vôlei e handebol | placar por set ou tempo | virada de 0x2 para 3x2, tie-break |
| Rugby e AFL | placar por tempo | virada e diferença final |
| Fórmula 1 | grid, resultado, voltas mais rápidas, pit stops | pole e vitória, vitória saindo do fundo do grid |
| MMA | resultado, método e round | nocaute ou finalização no 1º round |

Como vale o "acompanhou ao vivo": o widget avisa o servidor periodicamente enquanto está visível. A conquista só conta se o usuário estava presente no minuto do evento, pelo relógio do nosso servidor. Isso impede quem abre o app depois do jogo de ganhar o "Eu estava lá".

## Conquistas

O catálogo tem duas camadas: conquistas que servem para qualquer esporte (o motor é o mesmo, só muda o texto) e conquistas próprias de cada esporte, ligadas a momentos que o torcedor daquele esporte reconhece na hora. O cliente escolhe quais ligar.

### Comuns a todos os esportes (cerca de 25)

| Família | Exemplos | Com níveis? |
| --- | --- | --- |
| Fidelidade | Acompanhou X jogos do seu time ao vivo; sequência de rodadas sem perder um jogo; temporada inteira acompanhada | sim |
| Palpites | Acertou o vencedor X vezes; acertou o placar exato; sequência de acertos; acertou a zebra | sim |
| Explorador | Acompanhou jogos em X ligas, X países, X esportes diferentes | sim |
| Madrugador e coruja | Jogo de outro fuso acompanhado ao vivo (Europa de manhã, Ásia de madrugada) | sim |
| Eu estava lá | Estava ao vivo quando seu time virou, foi campeão, subiu ou fugiu do rebaixamento | única |
| Conhecedor | Quiz montado com dados reais (quem fez mais gols na temporada?) | sim |
| Comunidade | Convidou amigos, compartilhou card, participou do chat do jogo | sim |
| Colecionador | Completou coleções de cartas (ver adiante) | sim |

### Próprias de cada esporte (8 a 12 por esporte, exemplos)

| Esporte | Conquistas de momento |
| --- | --- |
| Futebol | Gol nos acréscimos, hat-trick do seu time, virada depois de estar perdendo por 2, defesa de pênalti, clássico vencido, VAR anulou gol contra você |
| Basquete e NBA | Triple-double ao vivo, jogo com duas prorrogações, 50 pontos de um jogador, virada no último quarto |
| Beisebol | No-hitter acompanhado, grand slam, walk-off no 9º inning, jogo de extra innings |
| Futebol americano | Virada no 4º quarto, field goal decisivo no fim, pick-six, temporada regular completa |
| Hóquei | Hat-trick (o chapéu no gelo), vitória no shootout, shutout do goleiro |
| Vôlei | Virada de 0x2 para 3x2, tie-break vencido |
| Handebol, rugby, AFL | Virada no último tempo, vitória por 1 ponto |
| Fórmula 1 | Viu a corrida inteira, vitória saindo do fundo do grid, pole + vitória + volta mais rápida |
| MMA | Nocaute no 1º round, finalização, luta que foi para a decisão |

Raridade automática: o sistema mede quantos usuários têm cada conquista e mostra "3% dos torcedores têm". Isso custa pouco e é o que mais dá vontade de mostrar o perfil.

## Níveis dentro de uma conquista

Recomendo **5 níveis** para conquistas de contagem. Menos que isso acaba rápido; mais que isso o usuário não enxerga a diferença. Cada nível pede cerca de 2,5 a 3 vezes o anterior, para que o primeiro saia no primeiro dia e o último leve uma temporada inteira.

| Nível | Exemplo: jogos do seu time acompanhados ao vivo | Exemplo: palpites certos | Quem chega lá (meta) |
| --- | --- | --- | --- |
| Bronze | 1 | 3 | quase todo mundo, no 1º dia |
| Prata | 5 | 10 | quem volta na 2ª semana |
| Ouro | 15 | 30 | metade de um turno |
| Platina | 38 | 75 | a temporada do Brasileirão inteira |
| Lendário | 100 | 200 | 2 a 3 temporadas; menos de 1% |

Regras de desenho:

- **Conquistas de momento não têm nível.** "No-hitter acompanhado" é única; o que dá nível é a família ("Eu estava lá" com 5, 15, 30 momentos).
- **Os números se ajustam ao esporte.** A NFL tem 17 jogos por time na temporada regular; a MLB tem 162. O sistema calcula os níveis pelo calendário da liga, para que Platina seja sempre "uma temporada".
- **Temporada nova, faixa nova.** Além da conquista vitalícia, cada temporada tem a sua versão ("Ouro 2026"). Quem chegou agora pode competir e quem está há anos não perde nada.
- **100% de uma conquista = Lendário.** É nesse ponto, ou num conjunto de conquistas, que o cliente pendura as recompensas maiores.

## Coleções de cartas no estilo Steam

No Steam, você ganha cartas jogando, mas o jogo só entrega metade da coleção; o resto vem de troca ou compra entre usuários. Com a coleção completa você fabrica um emblema, que dá nível no perfil e itens cosméticos. Copiamos a mecânica e trocamos o sorteio por eventos reais.

**Como uma coleção é montada.** Uma coleção por time e por temporada, com 10 cartas: escudo, estádio, uniforme, 5 cartas de momento ("Virada no Maracanã, 12/10") e 2 cartas de marca da temporada (campanha, artilheiro do time). Também há coleções de competição (os 20 escudos da Série A), de esporte e especiais (Copa, Super Bowl, World Series).

**Como se ganha uma carta, sem sorteio.**

- Cada nível de conquista dá uma carta definida (Prata em "Fidelidade" dá a carta Estádio).
- Acompanhar um jogo ao vivo dá a carta do momento que aconteceu nele. Quem viu a virada recebe a carta da virada.
- O usuário consegue no máximo 5 das 10 cartas de uma coleção sozinho. As outras 5 só virão por troca. É isso que dá vida ao marketplace.

**Raridade vem do mundo real**, não de uma tabela de chances: carta de jogo comum é comum; carta de hat-trick, de título ou de no-hitter é rara porque o fato é raro. Cada carta tem tiragem conhecida e mostrada ("1.204 existem"). Uma versão brilhante ("foil") sai para quem estava no nível Ouro da conquista correspondente.

**Completou a coleção:** o usuário "fabrica" o emblema do time 2026. As cartas são consumidas (isso tira cartas de circulação e mantém o valor), o perfil sobe de nível e a recompensa que o cliente ligou àquela coleção é liberada. A mesma coleção pode ser fabricada de novo, até 5 vezes, com emblema de nível maior.

**Arte das cartas: cuidado com imagem de jogador.** Foto e nome de atleta em produto colecionável exige licença: no Brasil, direito de imagem do atleta; nos EUA, as associações de jogadores (NFLPA, MLBPA, NBPA) licenciam nome e imagem em grupo. Recomendo que nossas cartas usem escudos licenciados pelo cliente, ilustrações de momento e estatísticas, sem foto de jogador. Cartas de jogador só entram quando o cliente traz os direitos.

## Recompensas que o cliente pode atrelar

O cliente liga uma recompensa a um gatilho: um nível de conquista, uma conquista 100% (Lendário), um conjunto de conquistas ("as 5 de Fidelidade no Ouro") ou uma coleção completa. Quando o gatilho dispara, avisamos o sistema do cliente por webhook e ele entrega. Nós não guardamos cupom nem fazemos entrega física.

| Tipo | Exemplos | Custo para o cliente | Cuidado |
| --- | --- | --- | --- |
| Cosmético | emblema, moldura de avatar, tema do perfil, título ("Sócio Lendário") | quase zero | nenhum |
| Acesso | conteúdo antecipado, vídeo exclusivo, destaque no chat do jogo, enquete só para colecionadores | baixo | nenhum |
| Pontos | bônus de pontos no programa | o valor do ponto | regras de pontos (adiante) |
| Desconto e cupom | % na loja oficial, frete grátis, cupom de parceiro | margem | pode casar com o Shop the game |
| Assinatura | 1 mês de streaming, upgrade de plano de sócio | médio | bom para OTT e operadora |
| Experiência | ingresso, tour no estádio, visita ao treino, meet and greet | alto, poucas unidades | entregar por ordem de chegada ou ranking, não por sorteio |
| Sorteio | camisa autografada entre quem completou a coleção | médio | no Brasil, sorteio precisa de autorização da Secretaria de Prêmios e Apostas; nos EUA, regras de sweepstakes por estado |
| Bônus de aposta | aposta grátis para casa de apostas | — | **não cabe no Brasil**: as bets estão proibidas desde 25/09/2026 pela [MP 1.394](https://www.projuris.com.br/blog/proibicao-bets-mp-1394-2026/); nos EUA depende do estado |

Dois formatos que funcionam bem: **escada** (cada nível libera algo um pouco melhor, para o usuário sempre ter o próximo alvo) e **troféu de temporada** (completar todas as coleções do time na temporada libera a recompensa grande, como o ingresso).

## Marketplace de troca e venda de cartas

O marketplace é onde a coleção se completa. Ele aceita dois tipos de negócio: troca de carta por carta (uma ou várias de cada lado) e venda de carta por pontos. Nunca existe carta por dinheiro nem saque de pontos em dinheiro.

Como funciona:

1. O usuário anuncia uma carta por um preço em pontos ou abre uma proposta de troca.
2. Quando o negócio fecha, a carta e os pontos ficam presos por 24 horas (no Steam são 7 dias). Se houver suspeita de fraude, o negócio é desfeito nesse prazo.
3. Passado o prazo, cada lado recebe o que comprou. O sistema cobra uma taxa de 10% em pontos do vendedor, e esses pontos somem. A taxa é o principal freio da inflação de pontos.

Regras para a economia não quebrar:

- **Preço mínimo e máximo por raridade**, calculados pela média dos últimos 30 dias. Isso impede passar pontos de uma conta para outra com uma venda por 1 ponto ou por 1 milhão de pontos.
- **Economia por cliente.** As cartas e os pontos do programa do Flamengo ficam no programa do Flamengo. Uma rede Galaxie entre clientes pode vir depois, se os clientes quiserem.
- **Cartas consumidas ao fabricar emblemas** saem de circulação, e as cartas antigas ficam mais raras com o tempo.
- **Preço de referência visível** em cada carta (últimas vendas), para o usuário não ser enganado por outro usuário.
- **Marketplace só para maiores de 18 anos** com conta verificada pelo cliente. Menores podem colecionar e fabricar emblemas, mas não negociam.

## Pontos e conversão em valor

A recomendação é o sistema calcular para o cliente quanto vale 1 ponto a partir do orçamento de prêmios dele, e mostrar esse valor ao usuário em reais ou dólares. O programa fica sustentável sem precisar enganar ninguém.

### Como Livelo, Smiles e Stix ganham dinheiro de verdade

A sensação de que "nunca paga nada sozinho" tem explicação, e quase toda ela é legal porque está nas regras:

- **Venda de pontos.** O banco ou a loja compra pontos do programa para dar aos clientes. O programa lucra a diferença entre o preço de venda e o custo do resgate.
- **Pontos que nunca são usados** (no mercado se chama *breakage*). Pontos expiram ou ficam parados em saldos pequenos demais. No setor, isso costuma ficar entre 15% e 30% dos pontos emitidos (número aproximado, de memória). Cada ponto expirado é receita pura.
- **Catálogo com margem.** O produto no catálogo custa mais pontos do que o preço de mercado justificaria. Na prática, 1 ponto rende algo entre R$ 0,01 e R$ 0,03 (aproximado).
- **Pontos + dinheiro.** O saldo típico cobre só parte do prêmio, e o usuário completa com dinheiro. O programa vende o resto com margem e ainda recebe pelo que faltava.

### Onde isso vira problema

Um sistema montado de propósito para que o usuário nunca chegue a um prêmio só com pontos é publicidade enganosa e prática abusiva (CDC, arts. 6º, 37 e 39). O Procon age com frequência contra validade de pontos escondida e regras mudadas no meio do caminho. Nos EUA, a FTC multou a dona do Genshin Impact em US$ 20 milhões em janeiro de 2025 e exigiu que ela revele as chances dos pacotes e as taxas de câmbio entre as moedas virtuais ([fonte](https://www.ftc.gov/news-events/news/press-releases/2025/01/genshin-impact-game-developer-will-be-banned-selling-lootboxes-teens-under-16-without-parental); [cobertura](https://www.claimsjournal.com/news/national/2025/01/22/328527.htm)). E há um risco de reputação para o Galaxie: se o cliente for multado, o motor de pontos é nosso.

### O modelo que o sistema recomenda

O cliente informa três números: quanto quer gastar por mês em prêmios, quantos usuários ativos espera e quantos pontos quer dar por ação. O sistema calcula o valor do ponto:

```latex
\text{valor do ponto} = \frac{\text{orçamento mensal de prêmios}}{\text{pontos emitidos por mês} \times \text{taxa de resgate esperada}}
```

Exemplo: orçamento de R$ 10.000 por mês, 1 milhão de pontos emitidos e 60% resgatados dão R$ 0,0167 por ponto. Um prêmio que custa R$ 50 ao cliente sai por 3.000 pontos.

| Parâmetro | O que o sistema recomenda | Por quê |
| --- | --- | --- |
| Primeiro prêmio | ao alcance de um usuário ativo em 2 a 4 semanas, só com pontos | quem nunca resgata nada desiste |
| Pontos + dinheiro | permitido, mas sempre com prêmios que saem só com pontos | o cliente ganha margem sem armadilha |
| Validade | 12 meses a partir do último uso, com aviso 30 e 7 dias antes | a quebra existe, mas avisada |
| Valor exibido | "3.000 pontos, cerca de R$ 50" em todo prêmio | transparência que vai além do exigido: a ordem da FTC no caso Genshin trata de pacotes pagos (chances e câmbio entre moedas), mas o mesmo princípio protege o cliente |
| Mudança de regra | aviso de 30 dias e sem efeito sobre pontos já ganhos | evita a reclamação mais comum no Procon |
| Reserva para quebra | o simulador assume 20% de pontos não resgatados, ajustado com o histórico real | o cliente não estoura o orçamento |
| Taxa do marketplace | 10% em pontos, destruídos | controla a inflação |

No painel isso vira um **simulador**: o cliente mexe no orçamento e vê o valor do ponto, quanto tempo leva para o primeiro prêmio e quanto ele gasta em cenários de 40%, 60% e 80% de resgate. Os pontos nunca saem do programa em dinheiro, o que também nos mantém longe de regras de moeda eletrônica do Banco Central.

## Benchmark: o que as outras plataformas fazem e o que dizem os termos

Quem não vende cartas nem pacotes está tranquilo; quem vende pacote aleatório ou deixa sacar dinheiro está sendo processado. Li os termos e regulamentos abaixo em 07/11/2026; onde não consegui ler, está dito.

| Plataforma | O que faz | O que os termos dizem | Risco que apareceu | Lição para nós |
| --- | --- | --- | --- | --- |
| [Steam](https://store.steampowered.com/subscriber_agreement/) (Valve) | cartas ganhas jogando, emblemas, mercado entre usuários com taxa | saldo "não tem valor em dinheiro" e não é reembolsável nem transferível (§3.C); itens são "licenciados, não vendidos" (§2.A); a Valve não reconhece transferência feita fora do Steam (§3.D); mínimo 13 anos (§1) | mercado paralelo em dinheiro com itens de jogos | copiar a ideia de licença e de "sem valor em dinheiro" nas regras do cliente |
| [Livelo](https://www.livelo.com.br/regulamentos/programa-pontos-livelo) | pontos de coalizão, catálogo, pontos + dinheiro | pontos sem valor monetário e sem conversão em dinheiro (4.1.3); validade de 24 meses (4.2.2); proibido comprar, vender ou trocar pontos (10.1); pontos comprados no pontos + dinheiro só servem para aquele resgate (7.2); mudança de regra com 30 dias de aviso (10.3); no encerramento os pontos perdem a validade (9.2); só 18+ (2.1) | perder pontos no encerramento do programa é o tipo de cláusula que o Procon questiona | usar as cláusulas boas e melhorar duas: janela para resgatar no encerramento e mudança sem efeito sobre pontos já ganhos |
| [Stix](https://rdsaude.com.br/wp-content/uploads/2025/09/Regulamento-Missoes_mes-stix_2025.pdf) (RD e GPA) | "Missões do mês": quem cumpre 2 missões ganha 1.000 pontos | bônus para os primeiros 15.000 CPFs, uma vez por CPF (5.1, 6.3); missão feita em outra rede da coalizão não conta (4.4); o regulamento não fala de idade, fraude nem autorização | regras curtas demais deixam lacunas (idade, fraude) | missões mensais funcionam e são bônus certo, não sorteio; nosso modelo de regras precisa cobrir as lacunas |
| Sócio-torcedor (Avanti e outros) | pontos por plano e presença viram prioridade na compra de ingresso e resgates | não consegui ler o regulamento (o site do Palmeiras bloqueia leitura automática) | — | a recompensa mais desejada no futebol é prioridade de ingresso; nosso webhook entrega isso ao sistema do clube |
| Cartola (Globo) | fantasy grátis, Cartola PRO pago, Campeonato Brasileiro de Cartola com R$ 500 mil ([fonte](https://propmark.com.br/anunciantes/com-gato-mestre-cartola-apresenta-novidades-para-o-brasileirao-2026/)) | base legal: [Lei 14.790, art. 49](https://www2.camara.leg.br/legin/fed/lei/2023/lei-14790-29-dezembro-2023-795206-normaatualizada-pl.html): fantasy não é aposta nem promoção comercial se o time virtual tem 2+ pessoas reais, as regras são prévias, o prêmio não depende do número de participantes e o resultado não depende de uma pessoa só | o art. 49 continua valendo depois da MP que proibiu as bets | bolão de placar de um jogo não é fantasy (depende do resultado, não do desempenho de jogadores); com prêmio, precisa de autorização ou de virar concurso só de habilidade |
| [MLB Beat the Streak](https://www.mlb.com/apps/play/prizes) | palpite grátis de rebatedor; prêmios a cada 5 acertos seguidos até 50 | "no purchase necessary"; teto de US$ 599 em prêmios por pessoa; só 21+; arbitragem obrigatória e renúncia a ação coletiva; proibido usar "em conexão com qualquer forma de aposta" | baixo | é o modelo pronto da nossa escada de prêmios para palpites nos EUA |
| [Sorare](https://www.blockchaingamer.biz/news/34595/uk-gambling-commission-charges-sorare/) | cartas de jogador compradas com dinheiro; fantasy com prêmios | — | a Gambling Commission do Reino Unido acusa a Sorare de oferecer jogo de azar sem licença; julgamento marcado para 7/6/2027; a França pressionou e a Sorare ampliou o modo grátis | carta comprada + prêmio pelo desempenho real = risco de jogo; nós não vendemos carta |
| NBA Top Shot (Dapper Labs) | pacotes pagos de "Moments" e marketplace com saque | — | ação coletiva por venda de investimento sem registro; acordo de [US$ 4 milhões](https://www.coindesk.com/policy/2024/06/04/dapper-labs-agrees-to-4m-settlement-in-class-action-securities-suit/) em 2024, com mudanças nos saques | nunca prometer valorização; sem saque em dinheiro |
| EA FC Ultimate Team | pacotes pagos com jogadores aleatórios | — | a Bélgica considerou esses pacotes jogo de azar e a EA [parou de vender](https://www.videogameschronicle.com/news/ea-stops-selling-fifa-loot-boxes-in-belgium-jan-29-2019/) lá em 2019 | pacote aleatório pago é o alvo número 1 dos reguladores |
| Topps BUNT (Fanatics) | moedas compradas abrem pacotes; trocas entre usuários | não achei os termos publicados | cartas vendidas no eBay por até US$ 200 ([fonte](https://www.beckett.com/news/topps-bunt-players-create-real-demand-for-virtual-baseball-cards/)), mesmo sem saque oficial | o mercado por fora aparece sozinho; regra proibindo e antifraude desde o início |
| Genshin Impact (HoYoverse) | pacotes aleatórios com moeda virtual | — | [FTC: US$ 20 milhões](https://www.claimsjournal.com/news/national/2025/01/22/328527.htm) em 2025; obrigada a revelar as chances dos pacotes e o câmbio entre moedas virtuais | valor do ponto sempre visível em reais ou dólares |

### O kit jurídico que entregamos ao cliente

O programa é do cliente: ele é o promotor perante o consumidor e o Procon, e nós somos o fornecedor da tecnologia (operador de dados na LGPD). Para ajudá-lo, o módulo vem com um modelo de regulamento e uma lista de conferência, para o advogado do cliente adaptar. Isso não substitui parecer jurídico, e o contrato com o cliente deve dizer isso.

Cláusulas do modelo, com a origem de cada uma:

1. Pontos e cartas são licença de uso, sem valor monetário e sem conversão em dinheiro (Livelo 4.1.3; Steam §2.A e §3.C).
2. Proibido negociar pontos ou cartas fora da plataforma; conta envolvida pode ser suspensa depois de apuração (Livelo 10.1 e 3.1; Steam §3.D).
3. Validade de 12 meses desde o último uso, com avisos 30 e 7 dias antes (mais generoso que os 24 meses fixos da Livelo).
4. Mudança de regra com 30 dias de aviso e sem efeito sobre pontos e cartas já ganhos (Livelo 10.3, melhorado).
5. Encerramento com 30 dias de aviso e janela de resgate antes de os pontos expirarem (melhora a Livelo 9.2).
6. Valor de referência em reais ou dólares em todo prêmio (boa prática nossa, inspirada na transparência de câmbio exigida pela FTC no caso Genshin, que tratava de pacotes pagos).
7. Nenhuma compra necessária para participar ou ganhar, e nenhuma relação com apostas (MLB).
8. Faixas de idade: 13+ no módulo, 18+ no marketplace e nos pontos com valor (Livelo e Steam como referência; ECA Digital e COPPA).
9. Nos EUA: arbitragem e renúncia a ação coletiva, teto de prêmio por pessoa e lista de estados excluídos, a validar com advogado local (MLB).
10. Antifraude: uma conta por pessoa, cancelamento depois de apuração, direito de desfazer negócios suspeitos dentro da retenção de 24 horas.

### Nos EUA, pela Galaxie Works LLC

Nos EUA, quem contrata e fatura é a Galaxie Works LLC, de Wyoming, e não a empresa brasileira. A LLC fica pronta por volta de 14/11/2026, e nenhum contrato ou regulamento americano deve ser assinado antes disso. No kit americano, o papel de cada um muda assim:

| Situação | Patrocinador (*sponsor*) | Administrador | O que o regulamento diz |
| --- | --- | --- | --- |
| Programa de um cliente (time, liga, mídia) | o cliente | Galaxie Works LLC | "Sponsor: \[cliente\]. Administrator: Galaxie Works LLC, Wyoming." O cliente responde pelos prêmios; a LLC opera a tecnologia |
| Promoção no site ou app do próprio Galaxie | Galaxie Works LLC | Galaxie Works LLC | a LLC responde por tudo: prêmios, impostos, registros |

O que isso muda nas regras americanas de prêmios:

- **Imposto do ganhador.** Quem paga o prêmio precisa informar à Receita americana (IRS), no formulário 1099-MISC, todo ganhador que receber acima do limite anual, e para isso precisa colher o formulário W-9 dele. O limite era US$ 600 até 2025 (por isso o MLB Beat the Streak limita os prêmios a US$ 599 por pessoa) e passou a [US$ 2.000 para pagamentos a partir de 2026](https://www.irs.gov/instructions/i1099mec), com correção pela inflação a partir de 2027. O limite só decide quando informar: o prêmio é tributável para o ganhador em qualquer valor. A regra fixa do projeto é o teto de US$ 599 nas promoções da própria LLC, que agora fica bem abaixo do limite e pode ser revista; nos programas de clientes, a obrigação é do cliente, como patrocinador.
- **Registro em estados.** Sorteios com prêmios somando mais de US$ 5.000 exigem registro prévio e garantia financeira em Nova York e na Flórida (de memória; confirmar com o advogado). Nosso desenho, com conquistas e palpites sem sorteio, não entra nisso; sorteio de cliente americano passa por essa checagem.
- **Lei aplicável e disputas.** O regulamento das promoções da própria LLC pode adotar a lei de Wyoming, com arbitragem e renúncia a ação coletiva, como faz a MLB. Nos programas de clientes, vale a lei que o cliente escolher.
- **Dados pessoais.** Nos programas de clientes, a LLC é prestadora de serviço (*service provider*, na lei da Califórnia) e assina com o cliente um acordo de tratamento de dados. A regra de menores de 13 anos (COPPA) continua: o módulo só é aberto para maiores de 13.
- **Contrato da LLC com o cliente.** O contrato deve dizer que a LLC fornece tecnologia e um modelo de regulamento, sem dar parecer jurídico; que o cliente é o patrocinador e responde pelos prêmios; e que a LLC tem um limite de responsabilidade.
- **Seguro e contador.** Vale cotar um seguro de responsabilidade para a LLC antes de operar promoções próprias. Prêmios pagos pela LLC entram na contabilidade dela e na declaração anual de LLC com dono estrangeiro (Form 5472), que já está no radar.

## Riscos legais

Um sistema de cartas vira jogo de azar quando junta três coisas: o usuário **paga**, o resultado depende de **sorte** e o prêmio tem **valor** fora do jogo. Isso vale no Brasil (contravenção do art. 50 da Lei de Contravenções Penais) e nos EUA (a regra "prize, chance, consideration" dos estados). O desenho deste estudo tira dois dos três de propósito: não há pacote pago e não há sorteio de carta.

| Risco | Onde | Como o desenho evita |
| --- | --- | --- |
| Loot box (caixa de recompensa) | Brasil: o [ECA Digital (Lei 15.211/2025)](https://www.mattosfilho.com.br/unico/eca-digital-sancionada-lei/) proíbe caixas de recompensa em jogos acessíveis a menores, em vigor desde março de 2026. EUA: FTC e processos coletivos | nenhum pacote aleatório; carta vem de conquista ou de evento real |
| Jogo de azar online | EUA: no caso Big Fish Casino, em Washington, ficha virtual revendável foi considerada "coisa de valor" (acordo de US$ 155 milhões, de memória) | marketplace sem saque em dinheiro e sem compra de cartas com dinheiro |
| Promoção comercial | Brasil: a Lei 5.768/1971 exige autorização para sorteio e vale-brinde; só fica isento (art. 3º, II) o concurso grátis, sem sorte e sem compra; um bolão com prêmio só escapa da autorização assim | conquistas e palpites grátis, por habilidade; sorteio só com autorização pedida pelo cliente |
| Aposta | Brasil: desde 25/09/2026 a MP 1.394 proíbe as apostas de quota fixa (a MP está contestada no STF e o Congresso tem 120 dias para votá-la); o fantasy do art. 49 da Lei 14.790 continua permitido | palpite sempre grátis, nunca com entrada paga; nenhuma integração com casa de apostas no Brasil enquanto a MP valer |
| Consumidor | CDC e Procon; FTC Act nos EUA | valor do ponto visível, validade avisada, regras estáveis |
| Imagem de atleta | Brasil: direito de imagem; EUA: licenças das associações de jogadores | cartas sem foto e nome de jogador, salvo quando o cliente tem a licença |
| Dados de crianças | COPPA (EUA, menores de 13 anos) e LGPD + ECA Digital | módulo só para 13+; marketplace e pontos com valor só 18+ |

**Compra nunca dá conquista, ponto ou carta.** Duas regras fecham essa porta. Os termos da Amazon Associates (§6(g)) proíbem dar recompensa, pontos ou fidelidade por usar o link de afiliado, e isso afeta o Shop the game. E, pela Lei 5.768, um prêmio ligado a compra deixa de ser concurso isento e passa a precisar de autorização. Por isso o motor de conquistas não recebe eventos de compra. Um cupom pode ser *recompensa* de uma conquista; ele só não pode ser *gatilho*. Se o cliente quiser pontos por compra na loja dele, isso é o programa de fidelidade dele, fora do nosso módulo e validado pelo advogado dele.

**Apostas no Brasil.** A [MP 1.394](https://www.projuris.com.br/blog/proibicao-bets-mp-1394-2026/), de 25/09/2026, proibiu as bets e extinguiu as licenças em 25/10/2026. Ela está contestada no STF e ainda precisa passar pelo Congresso. Enquanto valer, casa de apostas não é cliente da gamificação no Brasil, e nenhuma recompensa pode envolver aposta. O fantasy (art. 49 da Lei 14.790) não foi revogado, e é por isso que o Cartola continua.

**Menores.** Recomendo três faixas: abaixo de 13 anos, nada; de 13 a 17, conquistas, cartas e emblemas cosméticos, sem marketplace, sem pontos com valor e sem recompensa paga; a partir de 18, tudo. A idade vem do login do cliente, como no estudo do chat ao vivo. Se o cliente não informa idade, o sistema assume a faixa de 13 a 17.

Antes de ligar pontos com valor ou marketplace com um cliente real, precisamos de parecer de advogado no Brasil e, para os EUA, de um advogado de jogos e promoções. Conquistas e emblemas cosméticos podem sair antes.

## Fraude e abuso

Quando a carta tem valor, aparece gente para fabricá-la em escala. As fraudes previsíveis e o que fazer com cada uma:

| Fraude | Como seria | Defesa |
| --- | --- | --- |
| Fazenda de contas | 100 contas falsas juntando cartas e mandando tudo para uma conta principal | conta precisa ter idade mínima (14 dias) e atividade real para negociar; limite de negócios por dia; mesmo aparelho em várias contas acende alerta |
| Robô assistindo jogo | script deixa o widget aberto o dia todo | presença medida só com aba visível; interação ocasional pedida; limite de jogos simultâneos por conta |
| Palpite depois do lance | palpite enviado depois do gol | palpites fecham no apito inicial pelo relógio do nosso servidor, nunca do aparelho |
| Passar pontos entre contas | vender carta comum por 50 mil pontos para a própria conta-irmã | faixas de preço por raridade; detecção de pares que só negociam entre si |
| Golpe na troca | trocar carta e reclamar que não recebeu | toda troca passa pelo sistema, sem acordo por fora; retenção de 24 horas |
| Venda por fora em dinheiro | vender a conta ou cartas em grupo de WhatsApp | termos de uso proíbem; conta banida perde tudo; sem saque, o incentivo é menor |
| Abuso do próprio cliente | cliente muda a regra e zera pontos | regras versionadas e com aviso; mudança só vale para pontos novos |

Tudo fica registrado (quem ganhou o quê, por qual evento, quando negociou), para o cliente auditar e para responder a um Procon com provas.

## Como encaixa no Galaxie

Quase tudo reaproveita peças que já temos. O caminho de uma conquista:

1. **O jogo acontece**: o evento (gol, home run, nocaute) chega pelo nosso ao vivo, como já chega hoje.
2. **O fã está presente**: o widget ou o app do cliente avisa que o usuário está acompanhando. O usuário é identificado por um código do cliente, sem e-mail nem CPF.
3. **O motor de conquistas confere as regras**: junta evento e presença, sobe o nível, entrega a carta.
4. **O cliente é avisado**: um webhook (o mesmo mecanismo que ligamos em produção em 06/11) diz "usuário X chegou a Ouro em Fidelidade" e o sistema do cliente entrega a recompensa.
5. **O fã vê**: widgets novos no Builder mostram a estante de conquistas, o álbum de cartas, o marketplace e o ranking, com o tema da marca do cliente.

O que o cliente ganha no painel, em Ajustes → Gamificação: escolher quais conquistas e coleções ligar, pendurar recompensas em cada gatilho, usar o simulador de pontos e ver o relatório (quantos usuários em cada nível, quantas cartas negociadas). Pela API, o cliente que tem app próprio lê e grava tudo sem usar nossos widgets.

Como vender: módulo adicional, cobrado por usuário ativo por mês, com faixas. O argumento para o cliente é retenção: o torcedor volta a cada rodada para não perder a sequência.

## MVP e fases

O MVP é só a fase 1: conquistas com níveis, sem nada que tenha valor em dinheiro, o que dá para vender e medir sem esperar o jurídico.

| Fase | O que entra | Prazo (agentes) | Depende de |
| --- | --- | --- | --- |
| 1. Conquistas (MVP) | motor de conquistas, 5 níveis, catálogo comum + futebol, basquete e futebol americano, presença ao vivo, webhooks, widget de estante, painel | 2 a 3 dias | — |
| 2. Cartas | coleções, cartas por conquista e por momento, fabricação de emblemas, álbum | 2 a 3 dias, mais a curadoria da arte | fase 1 |
| Portão jurídico | revisão dos termos e do kit de regulamento antes de qualquer coisa com valor | em paralelo às fases 1 e 2 | — |
| 3. Pontos | carteira de pontos, simulador de valor do ponto, troca por recompensas materiais (opcional por cliente) | ~2 dias | portão jurídico |
| 4. Marketplace | troca e venda de cartas por pontos, retenção, faixas de preço, antifraude | 3 a 4 dias | fase 3 |
| 5. Expansão | demais esportes, kit EUA pela LLC, relatórios | ~2 dias por lote de esportes | — (pode antecipar com cliente americano) |

Prazos contam desenvolvimento por agentes Claude de fronteira, com as issues de cada fase em paralelo, como no épico de widgets (#820), que fechou 9 de 15 widgets em cerca de um dia. São estimativas pelo ritmo do projeto, não promessas. O parecer jurídico corre em paralelo às fases 1 e 2 e só trava a fase 3. A fase 5 pode entrar antes se um cliente americano aparecer.

## Decisões tomadas (Wagner, 07/11/2026)

- **Pontos:** pontos existem desde o início (ponto cosmético é ponto de verdade). A troca de pontos por recompensas materiais é uma opção que o cliente liga, e o cliente define o cálculo, partindo da nossa sugestão (simulador) e do benchmark, porque pontos e trocas criam uma macroeconomia.
- **Economia:** separada por cliente (tenant) **e por país-alvo** do cliente. Não se mistura público argentino com chileno, por exemplo.
- **Idade:** 18+ para o módulo inteiro (conquistas, cartas, pontos e marketplace).
- **Esportes do MVP:** futebol, basquete e futebol americano.
- **Jurídico:** em vez de parecer antes de tudo, o portão é a pesquisa dos termos, políticas e documentos públicos das plataformas semelhantes (benchmark acima), mantida atualizada.
- **Arte das cartas:** gerada por IA (Magnific, com os vários estilos disponíveis). Nada pode ser ou remeter a uma entidade real: sem escudo, nome ou logo de clube, liga ou atleta. Coleções genéricas e temáticas, o que abre possibilidades quase infinitas.
- **Cliente piloto:** em conversa, a definir.
- **Regras fixas:** sem aposta em nenhum país; compra nunca dá conquista, ponto, carta ou prêmio; prêmio limitado a US$ 599 por pessoa nas promoções da LLC nos EUA (conservador desde 2026, quando o limite do 1099-MISC passou a US$ 2.000; pode ser revisto). Escopo: Brasil, Latam, Hispam, EUA e Canadá, com regras de menores e privacidade por país.

## Fontes

- [MP 1.394/2026: proibição das bets, resumo do Senado](https://www12.senado.leg.br/publicacoes/estudos-legislativos/tipos-de-estudos/sumarios-de-proposicoes/mpv1394)
- [MP 1.394/2026: o que muda, Projuris](https://www.projuris.com.br/blog/proibicao-bets-mp-1394-2026/)
- [Lei 14.790, texto atualizado na Câmara (art. 49, fantasy)](https://www2.camara.leg.br/legin/fed/lei/2023/lei-14790-29-dezembro-2023-795206-normaatualizada-pl.html)
- Termos da Amazon Associates, §6(g), lidos no estudo de comunidades deste projeto
- [FTC e HoYoverse (Genshin Impact): acordo de US$ 20 milhões, janeiro de 2025](https://www.claimsjournal.com/news/national/2025/01/22/328527.htm)
- [ECA Digital sancionado (Lei 15.211/2025), Mattos Filho](https://www.mattosfilho.com.br/unico/eca-digital-sancionada-lei/)
- [Loot boxes proibidas no Brasil pelo ECA Digital, TecMundo](https://www.tecmundo.com.br/voxel/502437-loot-boxes-serao-proibidas-no-brasil-apos-sancao-de-lula-entenda-impacto-da-lei-felca-nos-games.htm)

Números de mercado de fidelidade (quebra de 15% a 30%, valor do ponto) e o valor do acordo Big Fish são aproximados, de memória, e devem ser conferidos antes de ir para um cliente.
