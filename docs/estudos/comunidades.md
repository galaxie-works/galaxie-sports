# Estudo: Comunidades no Galaxie

> Data: **2026-11-07**. Mercados: América Latina, mundo hispânico e, em breve, EUA e Canadá.
> Épico: label `Comunidades` no repositório. Estudos irmãos: Chat ao vivo, Gamificação e Shop the game (labels próprias).
> **Este documento não é parecer jurídico.** As seções de termos e de menores são um mapa para o advogado revisar antes do piloto.
> Política editorial: nenhum cliente é citado pelo nome.

---

## Resumo

A comunidade é a "casa" que junta chat, conquistas e loja num lugar só, e não um quarto módulo solto. O cliente (portal, emissora, operadora) cria comunidades, e o torcedor entra por time, por campeonato ou por convite. Lá dentro ele joga bolão, conversa no jogo, ganha pontos e vê o que a torcida está comprando.

- **Comece pelo bolão de grupo ("prode" / pick'em).** É o que mais prende gente no futebol da América Latina e nos EUA, usa dados que já temos e não exige moderação pesada.
- **Uma identidade e um placar de pontos só** para tudo: palpite, presença no chat, trivia. É isso que unifica a experiência. **Compra nunca dá ponto, selo nem prêmio.**
- **Moderação em camadas:** regras automáticas sempre ligadas e grátis, Cosmos AI como add-on pré-pago e cargos de moderador para a equipe do cliente. Os dois juntos é o pacote recomendado.
- **Sem bet, em nenhum país.** O bolão é só por pontos, sem entrada paga, sem dinheiro entre usuários e sem casa de aposta como patrocinadora.
- **MVP em cerca de 3 semanas** de desenvolvimento com agentes Claude, aproveitando o chat (SSE + Valkey) e a gamificação, estudados em paralelo.

## 1. O que é uma comunidade no Galaxie

Uma comunidade é um grupo de torcedores com um tema, um dono e regras. Quem cria é sempre o cliente ou, se o cliente permitir, o próprio torcedor. O Galaxie fornece a estrutura (dados, salas, pontos, moderação) e o cliente coloca a marca dele, como já fazemos com os widgets.

| Tipo | Quem cria | Exemplo | Quem entra |
| --- | --- | --- | --- |
| Oficial do cliente | Equipe do cliente | "Torcida Flamengo do Portal X", "Brasileirão 2027" | Aberta a todos os usuários do cliente |
| Patrocinada | Cliente + marca parceira | "Bolão da Copa do Banco Y" | Aberta, com prêmios da marca |
| De criador | Jornalista, influenciador ou podcast convidado pelo cliente | "Resenha do Fulano" | Seguidores, aberta ou paga |
| Privada de amigos | O próprio torcedor (se o cliente liberar) | "Bolão da firma" | Só por convite ou código |

**Regra de ouro do B2B: o login e o cadastro são do cliente.** O servidor dele pede um token curto ao Galaxie com um id do usuário, sem e-mail nem documento, igual ao desenho do chat. Assim o cliente continua dono do público dele, e nós não guardamos dados pessoais.

## 2. Cardápio: o que uma comunidade pode fazer

O cliente liga e desliga cada recurso por comunidade, como peças de Lego. A coluna "Dado nosso" mostra o que já vem pronto do espelho da api-sports, que é o que nos diferencia de uma ferramenta genérica de comunidade.

| Recurso | Como funciona para o torcedor | Dado nosso | Fase |
| --- | --- | --- | --- |
| Bolão da rodada (prode / pick'em) | Palpita placar antes do jogo, ganha pontos, sobe no ranking | Jogos, horários, resultados ao vivo | MVP |
| Ligas dentro da comunidade | Subgrupos privados com código ("bolão da firma") | Mesmo do bolão | MVP |
| Sala do jogo (chat ao vivo) | Abre 1 h antes, gols e cartões aparecem na conversa, fecha 1 h depois | Lance a lance, escalações | MVP |
| Mural da comunidade | Posts curtos, fotos, reações, fixados pelo moderador | Card de jogo ou jogador anexado | MVP |
| Enquetes e "craque do jogo" | Votação rápida durante ou após o jogo | Elenco e escalação | MVP |
| Trivia e desafios | Perguntas sobre o time e o campeonato, valendo pontos | Histórico, artilharia, tabelas | Fase 3 |
| Chaveamento (bracket) | Preenche o mata-mata antes de começar | Widget de chaveamento | Fase 3 |
| Desafios entre comunidades | Torcida A contra torcida B no bolão do clássico | Confronto direto | Fase 3 |
| Watch party | Anfitrião comanda a sala com enquetes sincronizadas ao jogo | Placar e eventos ao vivo | Fase 4 |
| Área paga do criador | Conteúdo e sala exclusiva para assinantes do criador | — | Fase 4 |
| Fantasy da comunidade | Monta time com jogadores reais, pontua pelos números da rodada | Números dos jogadores por jogo | Fase 5 |

Nos EUA o cardápio troca o nome: pick'em semanal na NFL, bracket no basquete universitário e na NBA, palpite de estatística no beisebol. A regra continua a mesma: só pontos.

## 3. Referências e benchmark

| Referência | O que ensina | O que copiar |
| --- | --- | --- |
| Fixture 2026 (Mercado Pago) | Bolão grátis vira motor de uso de um app de compras (2,3 milhões de usuários, 60 milhões de palpites) | Pontuação simples (6 no placar exato, 3 no vencedor), grupos privados de até 50, prêmio em crédito da loja |
| TyC Sports (app) | Comentários, enquetes e trivia, alguns sem exigir login; perfil com Fan ID | Participação leve para quem ainda não se cadastrou |
| Superbru | Ponto extra por "chegar perto", até 10 ligas por pessoa, ranking ao vivo | Regra de "quase acerto" como opção pronta |
| Super 6 (Sky Sports) | Desafio curto (6 placares) com prêmio-destaque | Formato "Desafio da rodada". O Super 6 é funil para casa de aposta; o nosso não leva a bet nenhuma |
| Kicktipp\* | Perguntas bônus da temporada, bolões patrocinados | Perguntas bônus geradas dos nossos dados |
| Cartola FC\* | Ligas de amigos e patrocinadas, prêmio por rodada, mês e turno | Os mesmos recortes de ranking |
| ESPN Tournament Challenge e NFL pick'em\* | Bracket e palpite semanal são hábito de massa nos EUA | Mesmo motor para o público americano |
| Sleeper\* | Liga de fantasy com chat embutido é uma comunidade de verdade | Chat da liga ao lado da tabela |
| Discord e Twitch\* | Watch party, AutoMod, cargos, registro de auditoria | Sala do jogo com anfitrião; níveis de rigor; pedido de desbanimento no app |
| Reddit (match threads)\* | Um tópico por jogo, aberto antes e fechado depois | Sala do jogo que abre e arquiva sozinha |
| Fan Hub Media (Genius Sports) | Concorrente B2B white-label de pick'em, bracket e fantasy para ligas e emissoras dos EUA | A prova de que o mercado compra isso pronto. Nossa diferença: todos os esportes, Latam primeiro, chat e loja juntos, nenhuma ligação com bet |

\* Conhecimento público, sem consulta nova nesta pesquisa.

O padrão que se repete: entrada grátis, regra simples, ranking em vários recortes de tempo, grupos privados e prêmio que traz a pessoa de volta à loja ou ao app de quem paga. Ninguém junta isso com dados ao vivo de todos os esportes e com a marca do cliente, e é aí que entra o Galaxie.

## 4. Como o cliente monta um bolão

O bolão, os palpites e os prêmios são do cliente: o Galaxie entrega a ferramenta, e o cliente monta a **campanha** em Ajustes, em seis passos. O Galaxie cuida do resto: abrir os jogos, travar os palpites, pontuar ao vivo e fechar os rankings.

1. **Escopo:** em qual comunidade (ou em todas), qual esporte e competição, quais rodadas. Pode ser a temporada inteira, um mês, só o mata-mata ou um "Desafio da rodada" com 3 a 10 jogos escolhidos.
2. **Formato do palpite:** placar exato, só vencedor, bracket do mata-mata, ou perguntas do jogo ("quem marca primeiro?", "mais de 2 gols?", em pontos, sem odds). Prazo: até o apito ou X minutos antes.
3. **Pontuação:** modelos prontos ("Clássico" 6/3, "Quase acerto" 3/1,5/1, "Bracket" com peso por fase) ou regra própria. Extras opcionais: rodada em dobro, sequência de acertos, perguntas bônus da temporada.
4. **Rankings:** semanal, mensal, por turno e da temporada, geral e por comunidade; ligas privadas ganham ranking próprio. Desempate configurável (ex.: mais placares exatos, depois quem palpitou primeiro).
5. **Prêmios:** o cliente cadastra o prêmio de cada ranking e posição (físico, cupom, ingresso, experiência ou só selo). Patrocinador pode assinar a campanha, menos casa de aposta.
6. **Regras e publicação:** o Galaxie gera o regulamento a partir das escolhas, nos três idiomas, para o jurídico do cliente revisar, e publica a campanha na comunidade, num widget e na sala do jogo.

No fim de cada ranking, o painel mostra os vencedores e manda a lista por webhook ou planilha. **Quem entrega o prêmio é o cliente**, porque ele tem o cadastro do ganhador; nós só temos o id. Antifraude ligado: uma conta por pessoa (verificada pelo cliente), bloqueio de palpite depois do prazo e alerta de contas que palpitam em bloco.

O tempero Galaxie:

- **Qualquer esporte**, com os nossos dados: bolão de NBA, F1 ou MLS no mesmo motor do Brasileirão.
- **Perguntas bônus automáticas**, sugeridas pelo Cosmos AI com o que está acontecendo no campeonato; o cliente só aprova.
- **Ranking ao vivo dentro da sala do jogo:** cada gol mexe a tabela do bolão na hora.
- **Prêmio ligado ao Shop the game:** o cupom do vencedor já vai para o produto do time dele.

## 5. Experiência unificada

Quatro peças compartilhadas unem comunidade, chat, conquistas e loja. Se cada módulo tiver as suas, o torcedor sente quatro produtos; com elas em comum, sente um só.

| Peça comum | O que é | Onde aparece |
| --- | --- | --- |
| Perfil do torcedor | Apelido, time do coração, nível, selos. Vem do login do cliente, sem dados pessoais | Chat, mural, ranking, bolão |
| Carteira de pontos | Um saldo só, que sobe com palpite, presença no chat e trivia (compra não conta) | Todas as telas; troca por prêmios do cliente |
| Linha do tempo do jogo | Os eventos do jogo (gol, cartão, fim) disparam mensagem no chat, pontos do bolão e produto em destaque | Sala do jogo, notificações, widgets |
| Painel do cliente | Um lugar em Ajustes para criar comunidades, ligar recursos, moderar e ver números | Backoffice Galaxie |

**Um dia de jogo na comunidade "Torcida do Flamengo":**

1. **Véspera:** a comunidade abre o bolão do clássico. Quem palpita ganha pontos e o selo "Palpiteiro" na 5ª rodada seguida.
2. **1 hora antes:** a sala do jogo abre. Escalação confirmada aparece no chat. Enquete: "quem marca primeiro?".
3. **Gol aos 23':** o chat mostra o lance; o bolão recalcula o ranking ao vivo; a loja destaca a camisa do autor do gol no card do evento.
4. **Intervalo:** trivia de 3 perguntas valendo pontos; o moderador fixa a melhor mensagem.
5. **Fim de jogo:** votação do craque; pontos do bolão creditados; top 10 ganha o selo da rodada.
6. **Dia seguinte:** a sala vira arquivo só de leitura; o mural mostra o resumo com os destaques da torcida.

Três regras para não virar bagunça:

- **Pontos não se compram.** Comprar não dá ponto nem selo, e o ranking do bolão é só de palpite. Isso protege o ranking e evita dois problemas legais: programas de afiliados (ex.: Amazon Associates) proíbem recompensar quem compra pelo link, e no Brasil o concurso com prêmio só dispensa autorização se não depender de compra (Lei 5.768, art. 3º, II).
- **A loja nunca interrompe o chat.** O produto aparece no card do evento ou na aba Loja, nunca como mensagem no meio da conversa.
- **Quem escreve é maior de 18** (proposta do estudo do chat). Menores podem ler, palpitar e jogar trivia, sem mensagem livre.

## 6. Moderação

O cliente escolhe entre três modos; o recomendado é o terceiro.

| Modo | Quem modera | Para quem serve | Custo para o cliente |
| --- | --- | --- | --- |
| Equipe do cliente | Funcionários convidados com cargo de moderador | Cliente pequeno, ou que já tem time de comunidade | Incluso no módulo |
| Cosmos AI | Nossa IA, 24 horas, em todas as salas | Cliente que não quer montar equipe | Saldo pré-pago, descontado pelos tokens consumidos |
| Os dois (recomendado) | IA filtra e decide o óbvio; humanos revisam o duvidoso e as apelações | Emissoras, portais grandes, jogos de massa | Add-on + equipe do cliente |

Em qualquer modo, uma **camada básica fica sempre ligada e de graça**: lista de palavras proibidas por idioma, bloqueio de links e telefones, bloqueio de links e menções a casas de aposta, limite de mensagens por minuto e "modo lento" automático quando a sala enche.

### 6.1 Como o Cosmos AI modera

1. **Filtro rápido (todas as mensagens, milissegundos):** regras e listas, iguais à camada básica.
2. **Classificador leve (todas as mensagens):** um modelo pequeno dá nota de risco para ofensa, racismo, homofobia, ameaça, spam e golpe. Nota baixa passa direto.
3. **LLM (só o que ficou na dúvida):** lê a mensagem com o contexto da conversa e do jogo, entende gíria e ironia de torcida ("vamos matar o jogo" não é ameaça) e decide: aprovar, esconder, avisar o autor ou mandar para um humano. Explica o motivo em uma linha, que vai para o registro.
4. **Fila humana:** o que a IA não tem certeza, e toda apelação, cai no painel da equipe do cliente. A segunda apelação de uma decisão automática sempre vai para uma pessoa (LGPD art. 20); para cliente sem equipe, essa pessoa é o suporte da Galaxie.

Passar só a dúvida pelo LLM é o que deixa o custo viável em jogo grande. Estimativa, sem medição ainda: 5% a 10% das mensagens chegam ao passo 3. O Cosmos AI também revisa posts do mural, nomes de comunidade, apelidos e fotos de perfil.

**Quando o saldo acaba, a moderação nunca desliga.** Os passos 1 e 2 continuam rodando, e o que iria para o LLM cai direto na fila humana (ou fica escondido até alguém olhar, se o cliente não tem equipe). O painel avisa quando 90% do saldo foi usado e mostra quanto cada comunidade, bolão ou sala consumiu.

**Cobrança:** segue o modelo de créditos da Suzette, que já funciona: carteira de créditos por cliente, créditos de teste ao ativar, pacotes pré-pagos, crédito só entra com pagamento confirmado e sem duplicar, extrato com saldo antes e depois de cada lançamento, orçamento por "filial" (aqui, cada comunidade, bolão ou sala) e alerta em 90%. Só o passo 3 consome créditos; filtros e classificador são nossos e não descontam. Os valores dos pacotes da Cosmos ainda serão definidos.

### 6.2 Cargos da equipe do cliente

| Cargo | O que pode fazer |
| --- | --- |
| Dono do cliente | Tudo, inclusive criar e apagar comunidades, ligar o Cosmos AI e ver o registro completo |
| Admin | Configurar a comunidade, nomear moderadores, banir de vez |
| Moderador sênior | Tudo do moderador, mais banir da comunidade e julgar a segunda apelação |
| Moderador | Apagar e esconder mensagens, silenciar, suspender por tempo, fixar, ativar modo lento, julgar apelações |
| Moderador voluntário (torcedor promovido) | Esconder mensagem e silenciar por até 1 hora; o resto vai para a fila |

### 6.3 Punições, em escada

1. **Aviso**, automático ou manual, visível só para o autor.
2. **Esconder** a mensagem (o autor continua vendo; os outros não).
3. **Silenciar** por 10 min, 1 h ou 24 h na sala ou na comunidade.
4. **Suspender** por dias em todas as comunidades do cliente.
5. **Banir** de vez da comunidade ou de todo o cliente.
6. **Silenciar sem avisar (shadow mute)** para spam e golpista, que só trocaria de conta.

O Cosmos AI pode aplicar sozinho os degraus 1 a 3 (até silenciar 24 h). Do 4 em diante, o padrão é pedir confirmação humana; o cliente pode mudar isso em Ajustes.

### 6.4 Denúncia, apelação e registro

- **Denúncia:** qualquer torcedor denuncia mensagem ou perfil em dois toques, escolhendo o motivo.
- **Apelação:** quem foi punido vê o motivo e pode pedir revisão uma vez por punição, julgada por quem não aplicou a punição, com fila e prazo visível (ex.: 72 h).
- **Registro de auditoria:** toda ação fica gravada com quem fez (pessoa ou Cosmos AI), quando, sobre quem, motivo e a mensagem original. Ninguém apaga o registro, nem o dono do cliente.
- **Guarda legal:** registros por 6 meses (Marco Civil, art. 15); entrega à Justiça só com ordem judicial, respondida pelo cliente junto com a Galaxie.
- **Painel de saúde:** mensagens por minuto, % escondidas, denúncias e tempo médio de resposta da equipe, por sala e por comunidade.

## 7. Menores e privacidade em todas as regiões

O recurso vai para Latam, Hispam e, em breve, EUA e Canadá, então a regra tem que ser uma só e servir para a lei mais rígida. **Padrão global proposto:** só maiores de 18 escrevem; maiores de 13 leem, palpitam e jogam trivia; idade e consentimento são verificados pelo cliente no login dele; nós nunca recebemos e-mail, documento ou data de nascimento, só um sinal de faixa etária.

| Região | Leis que pesam (a confirmar com advogado) | O que muda para nós |
| --- | --- | --- |
| Brasil | ECA Digital, LGPD, Marco Civil | Padrões protetivos para menores; registros por 6 meses |
| Argentina, Chile, Colômbia, México e demais Hispam | Leis nacionais de dados pessoais (ex.: Ley 25.326, nova lei chilena, Ley 1581, lei federal mexicana) | Consentimento dos pais para menores; direito de apagar conta e dados |
| EUA | COPPA (menores de 13), leis estaduais de privacidade e de redes sociais para adolescentes | Menor de 13 fora de qualquer recurso social; verificação de idade em alguns estados |
| Canadá | PIPEDA e Lei 25 do Quebec | Consentimento claro, avaliação de impacto, dados de menores como sensíveis |

Na prática, isso vira três chaves por cliente e por país no painel: idade mínima para escrever (padrão 18), idade mínima para participar (padrão 13) e prazo de guarda do registro.

## 8. Termos das plataformas: riscos e como orientar o cliente

O resultado mais importante: **o Mercado Pago teve que mudar o próprio bolão** em junho de 2026, depois que a associação das loterias estaduais argentinas (ALEA) o acusou, com base no art. 301 bis do Código Penal, de operar jogo de azar sem autorização. Os torneios entre amigos perderam qualquer ligação com dinheiro. É o mesmo caminho que já escolhemos: só pontos, sem entrada paga e sem dinheiro entre usuários.

| Plataforma ou lei | O que diz (resumo) | Risco para o cliente | Como procedemos |
| --- | --- | --- | --- |
| [Apple, diretriz 1.2](https://developer.apple.com/app-store/review/guidelines/) | App com conteúdo de usuário precisa de filtro, denúncia com resposta rápida, bloqueio de usuário e contato publicado; chat anônimo não é aceito | App reprovado ou removido | Filtro, denúncia, bloqueio e contato ligados e não desligáveis. Todo usuário vem do login do cliente |
| [Apple, 5.3.1 e 5.3.2](https://developer.apple.com/app-store/review/guidelines/) | Concurso patrocinado pelo dono do app, com regulamento no app dizendo que a Apple não patrocina | Bolão com prêmio reprovado | Cliente é o patrocinador oficial. O regulamento gerado aparece no app e traz a frase sobre Apple (e Google) |
| [Apple, 5.1.1 e 4.7.5](https://developer.apple.com/app-store/review/guidelines/) | Conta criada no app pode ser apagada no app; recurso acima da classificação etária precisa de trava por idade | Reprovação | API para o cliente apagar o perfil do torcedor e tudo o que ele escreveu; chave de idade por país |
| [Google Play, conteúdo de usuário](https://support.google.com/googleplay/android-developer/answer/12923286?hl=en) | Termos aceitos antes de postar, moderação contínua, denúncia e bloqueio no app | Reprovação ou remoção | Tela de aceite das regras antes da primeira mensagem, com modelo de termos que o cliente adapta |
| [Lei 5.768/1971](https://www2.camara.leg.br/legin/fed/lei/1970-1979/lei-5768-20-dezembro-1971-357812-normaatualizada-pl.html) (Brasil) | Prêmio grátis por sorteio ou concurso precisa de autorização prévia da SPA/Ministério da Fazenda. O art. 3º, II, dispensa o concurso exclusivamente desportivo ou recreativo, sem sorte, sem pagamento e sem obrigação de compra | Multa e campanha suspensa | Bolão 100% de habilidade, grátis e sem compra. Desempate nunca por sorteio. Sorteio ou prêmio ligado a compra = o cliente pede a autorização |
| Argentina: art. 301 bis do Código Penal e loterias provinciais | Caso Mercado Pago acima | Denúncia criminal | Nenhum dinheiro entre usuários, nenhuma entrada paga, nenhum "pote" nas ligas privadas |
| EUA: leis estaduais de concursos\* | Alguns estados pedem registro ou garantia para prêmio alto | Multa estadual | Regulamento com estados excluídos quando o advogado mandar; valor máximo de prêmio configurável |

\* A confirmar caso a caso.

Pendente de leitura completa: termos da TyC Sports e do Superbru, e regulamentos oficiais do Fixture.

**Como ajudamos o cliente juridicamente**, sem virar escritório de advocacia:

1. **Kit de conformidade** em cada campanha e comunidade: modelo de termos da comunidade, regras de conduta e regulamento do bolão gerado das escolhas dele, nos três idiomas. O modelo usa a lei e o foro do país do torcedor, não um só para todos.
2. **Travas no produto** que impedem o erro: sem entrada paga, sem dinheiro entre usuários, sem sorteio sem autorização marcada, sem bet, filtro e denúncia sempre ligados.
3. **Lista de checagem antes de publicar**, por país: "tem autorização se for sorteio?", "estados excluídos?", "idade mínima?".
4. **Contrato claro:** o cliente é o organizador e o patrocinador; o Galaxie é o fornecedor da tecnologia.

## 9. Quem contrata

| Peça | Latam e Hispam | EUA e Canadá |
| --- | --- | --- |
| Contrato com o cliente e termos da API | Galaxie Works Ltda | Galaxie Works LLC (Wyoming) |
| Fornecedor de tecnologia nos termos da comunidade | Ltda | LLC |
| Cobrança do módulo e dos créditos do Cosmos AI | Em reais, pela Ltda | Em dólares, pela LLC |
| Foro do contrato com o cliente | São Paulo, lei brasileira | Lei de Wyoming |

Os termos dos torcedores são do cliente e seguem o país do torcedor.

## 10. Como vender

Um pacote "Engajamento" com três peças, cada uma cobrada do jeito que combina com o custo dela. Valores ficam para a tabela de preços.

| Peça | Como cobrar | Por quê |
| --- | --- | --- |
| Comunidades + chat + gamificação | Assinatura mensal por faixa de usuários ativos e de pico simultâneo no chat | O custo cresce com o pico do jogo grande, não com o número de comunidades |
| Cosmos AI moderador | Pré-pago: créditos descontados pelos tokens do passo 3 | Mesmo modelo do resto do Cosmos AI |
| Shop the game | Divisão de comissão, sem taxa fixa | Cliente só paga quando vende |

Criar comunidade, cargos de moderador e a camada básica de filtros ficam inclusos, para que nenhum cliente tenha chat sem proteção mínima.

## 11. Fases e prazos

Prazos contam desenvolvimento feito por agentes Claude, sem contar revisão e decisão. Encaixam depois do MVP do chat (cerca de 2 semanas), porque a sala do jogo é o chat.

| Fase | O que entrega | Prazo |
| --- | --- | --- |
| 1. MVP de comunidades | Perfil e carteira únicos, criar comunidade no painel, entrar por link, mural, bolão da rodada com ligas privadas, enquetes, sala do jogo usando o chat, camada básica de filtros, cargos, denúncia, registro de auditoria, chaves de idade | ~3 semanas |
| 2. Cosmos AI moderador | Classificador leve + LLM na dúvida, fila humana, apelação, painel de saúde, desconto do saldo pré-pago | ~2 semanas |
| 3. Unificação | Gamificação na mesma carteira, produto do Shop the game nos eventos do jogo, trivia, chaveamento, desafios entre comunidades | ~2 semanas |
| 4. Criadores e EUA | Watch party com anfitrião, área paga do criador, pick'em e bracket das ligas americanas | ~2 semanas |
| 5. Fantasy | Fantasy da comunidade com os números dos jogadores por rodada | ~3 semanas |

O fantasy fica por último porque depende dos números dos jogadores por jogo estarem atualizados todo dia, frente que acabou de entrar no sync diário.

## 12. Decisões em aberto

- [ ] Aprovar o bolão de grupo como recurso principal do MVP
- [ ] Liberar ou não que o torcedor crie comunidade privada (ou só o cliente cria)
- [ ] Confirmar o padrão global: 18+ escrevem, 13+ participam, ajustável por país
- [ ] Confirmar que o Cosmos AI pode aplicar sozinho até "silenciar 24 h", e o resto pede humano
- [ ] Escolher o cliente piloto (o mesmo do chat faz sentido)
- [ ] Validar com o advogado a lista de riscos da seção 8

## Fontes

- [TyC Sports na App Store (Argentina)](https://apps.apple.com/ar/app/tyc-sports/id887613794)
- [Mercado Pago apresenta o Fixture 2026](https://mercado.com.ar/negocios/mercado-pago-presento-fixture-2026-con-20-millones-diarios-y-premios-en-dolares)
- [Fixture 2026: 2,3 milhões de usuários e 60 milhões de palpites](https://mercado.com.ar/marketing/fixture-2026-en-mercado-pago-23-millones-de-usuarios-y-60-millones-de-pronosticos)
- [Yogonet: Mercado Pago muda as condições do torneio de palpites](https://www.yogonet.com/latinoamerica/noticias/2026/06/24/109493-mercado-pago-cambio-las-condiciones-de-su-torneo-de-pronosticos-para-el-mundial-2026)
- [Superbru Premier League Predictor](https://www.superbru.com/epl)
- [Super 6: how the Sky Sports game swept a nation (Football Critic)](https://www.footballcritic.com/news/super-6-how-the-sky-sports-game-swept-a-nation/3805)
- [Fan Hub Media](https://fanhubmedia.com/about)
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play: conteúdo gerado por usuários](https://support.google.com/googleplay/android-developer/answer/12923286?hl=en)
- [Lei 5.768/1971](https://www2.camara.leg.br/legin/fed/lei/1970-1979/lei-5768-20-dezembro-1971-357812-normaatualizada-pl.html) e [autorização da SPA](https://www.gov.br/pt-br/servicos/obter-autorizacao-para-atividades-de-distribuicao-gratuita-de-premios-a-titulo-de-propaganda-ou-de-captacao-de-poupanca-popular)
