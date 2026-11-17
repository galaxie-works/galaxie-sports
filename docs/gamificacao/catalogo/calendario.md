# Calendário por esporte e Degraus de fidelidade

Documento de trabalho interno, consolidado dos 12 pacotes de pesquisa de esporte em [pesquisa/](pesquisa/) (consultas de 16/11/2026). Aqui aparecem nomes reais de competições para calibrar; nada disso vai ao torcedor. As perguntas, extensões e exceções que os pacotes levantaram estão em [pesquisa/consolidado.md](pesquisa/consolidado.md).

**A regra** ([padronização, seção 3](padronizacao.md)): a Conquista de contagem tem cinco Degraus (Bronze, Prata, Ouro, Platina, Lendário). O Bronze sai no primeiro dia; cada Degrau pede cerca de 2,5 a 3 vezes o anterior. **Platina = uma temporada** do esporte do ponto de vista do torcedor assíduo (os jogos do time dele numa liga de 38 rodadas; as corridas de um ano; as lutas que ele acompanha num ano). **Lendário = 2 a 3 temporadas**, com meta de menos de 1% dos torcedores ativos. A referência é a liga de 38 rodadas: `1 / 5 / 15 / 38 / 100`, que é o que a função `seasonSteps(seasonGames)` do `packages/game-rules` devolve para 38; as tabelas abaixo são o mesmo cálculo aplicado ao calendário de cada competição. Nas competições curtas (torneios de seleções, copas), o Platina é o máximo de jogos que um time disputa na edição e o Lendário soma 2 ou 3 edições (Conquista vitalícia). Quando as competições do mesmo esporte divergem, cada pacote escolheu **uma** base para a Platina da Conquista de fidelidade ao time (`<esporte>.loyalty.favorite_games`) e deixou o resto como folga ou para Conquistas sazonais por competição que vierem depois; a linha "Base adotada no pacote" de cada seção diz qual e por quê.

Colunas, iguais em todas as tabelas: Competição | Jogos por time na temporada regular | Mata-mata ou playoff típico (e o máximo de jogos por edição) | Degraus de fidelidade resultantes.

## 1. Futebol (`football`)

| Competição | Jogos por time na temporada regular | Mata-mata ou playoff típico | Degraus de fidelidade resultantes |
| --- | --- | --- | --- |
| Brasileirão Série A (20 clubes, pontos corridos) | 38 | nenhum (máx. 38) | 1 / 5 / 15 / 38 / 100 |
| Premier League, La Liga, Serie A, Ligue 1 (20 clubes) | 38 | nenhum (máx. 38) | 1 / 5 / 15 / 38 / 100 |
| Bundesliga, Eredivisie, Primeira Liga (18 clubes) | 34 | nenhum; repescagem de rebaixamento (2) (máx. 34 a 36) | 1 / 4 / 13 / 34 / 90 |
| Liga MX, por torneo (Apertura e Clausura, 18 clubes) | 17 | play-in (1 ou 2) + liguilla de quartas, semi e final em ida e volta (6) (máx. 25 por torneo, 50 por ano) | 1 / 5 / 15 / 40 / 100 (ano = 2 torneos) |
| MLS (30 clubes) | 34 | wild card (1) + melhor de 3 (até 3) + semi e final de conferência e MLS Cup (3) (máx. 41) | 1 / 4 / 13 / 36 / 95 |
| Liga Profesional Argentina 2025, por torneo (30 clubes em 2 zonas) | 16 | oitavas, quartas, semi e final em jogo único (4) (máx. 20 por torneo, 40 por ano; formato muda em 2027) | 1 / 5 / 15 / 38 / 100 (ano) |
| Copa Libertadores e Sudamericana | 6 (grupos de 4, ida e volta) | oitavas, quartas e semi em ida e volta (6) + final única (1) (máx. 13, mais 2 a 6 de fases prévias) | 1 / 2 / 5 / 13 / 35 |
| Champions League (formato 2024-25) | 8 (fase de liga) | play-off (2) + oitavas, quartas e semi em ida e volta (6) + final (1) (máx. 17) | 1 / 2 / 6 / 15 / 40 |
| Copa do Brasil | 2 (1ª e 2ª fases em jogo único) | 3ª fase em diante em ida e volta (10) (máx. 12; 8 para quem entra na 3ª fase) | 1 / 2 / 4 / 8 / 20 |
| Copa do Mundo 2026 (48 seleções) | 3 (grupos de 4) | 32avos, oitavas, quartas, semi e final (5) (máx. 8, a cada 4 anos) | 1 / 2 / 4 / 8 / 20 (vitalício, soma edições) |
| Eliminatórias sul-americanas (10 seleções, 2 anos) | 18 | nenhum; repescagem (1 ou 2) (máx. 18 por ciclo) | 1 / 3 / 8 / 18 / 36 |
| Campeonato Paulista | 12 (4 grupos) | quartas e semi em jogo único (2) + final em ida e volta (2) (máx. 16) | 1 / 2 / 6 / 15 / 40 |
| Campeonato Carioca | 11 (Taça Guanabara, turno único) | semi e final em ida e volta (4) (máx. 15) | 1 / 2 / 6 / 15 / 40 |
| Demais estaduais (Mineiro, Gaúcho etc.) | 8 a 12 | 2 a 4 (máx. 12 a 16) | 1 / 2 / 5 / 12 / 30 |

**Base adotada no pacote:** Platina **38** em `football.loyalty.favorite_games`, que é a liga de 38 rodadas; as copas ficam como folga. A tabela acima fica para as Conquistas sazonais por competição que vierem depois.

**Mercados que divergem:** a temporada completa do torcedor assíduo (jogos do time do coração por ano) é 60 a 75 no Brasil (estadual + liga + Copa do Brasil + continental), 45 a 55 na Argentina, 50 no México, 36 a 41 nos EUA e Canadá, 45 a 60 na Europa. México e Argentina jogam em dois torneos curtos por ano (17 e 16 jogos), com finais todo semestre.

## 2. Basquete (`basketball`)

| Competição | Jogos por time na temporada regular | Mata-mata ou playoff típico | Degraus de fidelidade resultantes |
| --- | --- | --- | --- |
| NBB 2025-26 (20 clubes, turno e returno) | 38 | 16 classificados, séries melhor de 5 das oitavas à final (até 20); Copa Super 8 em jogo único (até 3) (máx. 61) | 1 / 5 / 15 / 38 / 100 |
| Liga Nacional de Básquet, Argentina 2025-26 (19 clubes) | 36 | reclasificación, quartas, semi e final, todas melhor de 5 (até 20) (máx. 56) | 1 / 5 / 15 / 36 / 100 |
| Demais ligas nacionais da América do Sul (Uruguai, Chile, Colômbia, Venezuela) | 20 a 30 | playoffs em séries curtas (6 a 12) (máx. 30 a 40) | 1 / 4 / 10 / 25 / 70 |
| Basketball Champions League Americas 2025-26 (12 clubes) | 6 (ida e volta no grupo) | quartas em série curta + Final Four (até 5) (máx. 11) | 1 / 2 / 4 / 11 / 30 |
| FIBA AmeriCup 2025 (12 seleções) | 3 | quartas, semi e final ou 3º lugar (3) (máx. 6, a cada 4 anos) | 1 / 2 / 3 / 6 / 15 (soma edições) |
| Copa do Mundo FIBA 2027 (32 seleções) | 3 | segunda fase (2) + quartas, semi e final (3) (máx. 8, a cada 4 anos) | 1 / 2 / 4 / 8 / 20 (soma edições) |
| Torneio olímpico (12 seleções) | 3 | quartas, semi e final (3) (máx. 6, a cada 4 anos) | 1 / 2 / 3 / 6 / 15 (soma edições) |
| Jogos Pan-Americanos (8 seleções) | 3 | semi e final (2) (máx. 5, a cada 4 anos) | 1 / 2 / 3 / 5 / 12 (soma edições) |
| LBF, Liga de Basquete Feminino 2025 (11 equipes) | 20 | 8 classificadas, quartas, semi e final em séries curtas (6 a 9) (máx. 29) | 1 / 3 / 8 / 20 / 50 |
| Liga Femenina de Básquet, Argentina 2025 (18 equipes) | 16 a 20 (por zonas, estimativa) | playoffs em séries curtas (máx. 25 a 30) | 1 / 3 / 8 / 20 / 50 |
| FIBA Women's AmeriCup (10 seleções) | 4 | quartas, semi e final (3) (máx. 7, a cada 2 anos) | 1 / 2 / 4 / 7 / 18 (soma edições) |

**Base adotada no pacote:** Platina **38** em `basketball.loyalty.favorite_games`, o NBB; a Argentina fica a 2 jogos. Nas seleções, 5 a 8 por torneio, vitalício. Os limiares de pontos do pacote (quarto de 30+, vitória por 15+, massacre por 25+, 180+ somados) seguem as ligas sul-americanas, que fazem 80 a 85 pontos por jogo.

**Mercados que divergem:** o NBB e a Argentina têm 36 a 38 jogos; as demais ligas sul-americanas, 20 a 30. As seleções jogam 5 a 8 por torneio, a cada 2 a 4 anos, com ritmo de pontos diferente das ligas (pergunta sobre limiares por tipo de competição no consolidado).

## 3. NBA (`nba`)

| Competição | Jogos por time na temporada regular | Mata-mata ou playoff típico | Degraus de fidelidade resultantes |
| --- | --- | --- | --- |
| NBA (30 franquias) | 82 | play-in (até 2) + 4 séries de até 7 (28) (máx. 112) | 1 / 6 / 25 / 82 / 200 |
| NBA Summer League de Las Vegas | 4 | semifinal e final para 4 times, jogo de consolação para os outros (1 ou 2) (máx. 6) | 1 / 2 / 3 / 5 / 12 (soma edições) |

**Base adotada no pacote:** Platina **82** em `nba.loyalty.favorite_games`, a temporada regular inteira. O Degrau Ouro para Platina pula de 25 para 82 (3,3x) e o Bronze para Prata de 1 para 6, fora da faixa de 2,5 a 3x, porque a temporada é longa e o Bronze tem de sair no primeiro dia; a alternativa levantada é Platina 60 (uma temporada de quem perde os jogos de madrugada). Playoffs assistidos: 1 / 3 / 10 / 30 / 75 (até 28 jogos por time, 85 na liga; o assíduo vê 30). Meses diferentes: Platina 8, Lendário 16 (outubro a junho mais julho da Summer League).

**Mercados que divergem:** para o Brasil e a Argentina, cerca de um terço do calendário (jogos da costa oeste) começa entre 23h30 e 1h30: 25 a 30 jogos por temporada para quem segue um time da costa oeste, 10 a 15 para os demais. A Summer League conta nas Conquistas da franquia pela regra atual (pergunta ao dono).

## 4. Futebol americano (`american-football`)

| Competição | Jogos por time na temporada regular | Mata-mata ou playoff típico | Degraus de fidelidade resultantes |
| --- | --- | --- | --- |
| Liga profissional (32 times, 17 jogos desde 2021, 14 classificados desde 2020) | 17 | wild card, divisional, final de conferência e final: até 4 (3 para o cabeça de chave com folga) (máx. 21) | 1 / 3 / 8 / 17 / 45 |
| Futebol universitário de primeira divisão (134 programas, 12 jogos por regra, 13 com a exceção do Havaí) | 12 | final de conferência (1) + bowl (1), ou playoff de 12 times desde 2024: até 4 (3 para os 4 cabeças de chave) (máx. 17) | 1 / 3 / 7 / 13 / 35 |
| Torcedor que acompanha os dois níveis (time profissional + programa universitário) | 29 | até 8 (máx. 38) | 1 / 5 / 15 / 30 / 80 |

**Base adotada no pacote:** Platina **17** em `american_football.loyalty.favorite_games` (a liga profissional) e Lendário 45 (2,5 temporadas). 17 jogos é uma temporada curta: muitos fatos que seriam repetíveis numa liga de 38 ou 82 jogos viram únicos aqui. `explorer.months` tem Platina 7 (agosto a fevereiro, somando os dois níveis) e Lendário 14, com aviso aceito do validador. Playoffs: 13 jogos profissionais + 11 universitários por temporada; o assíduo assiste a cerca de 10 e palpita em 20 a 30 jogos de mata-mata.

**Mercados que divergem:** o universitário tem calendário (12 + até 5), apelo (rivalidades, playoff de 12) e frequências (shutout, massacre, 40 pontos muito mais comuns) diferentes do profissional; a raridade segue o profissional. Há a pergunta de um pacote `college-football` separado.

## 5. Beisebol (`baseball`)

| Competição | Jogos por time na temporada regular | Mata-mata ou playoff típico | Degraus de fidelidade resultantes |
| --- | --- | --- | --- |
| MLB (30 times) | 162 (81 em casa) | wild card (até 3) + série divisional (5) + série de liga (7) + final (7) (máx. 184) | 1 / 8 / 27 / 81 / 200 |
| Liga Mexicana de Beisbol, verão (20 times, 2025) | 93 (31 séries de 3) | 12 classificados; 4 rodadas melhor de 7 (até 28) (máx. 121) | 1 / 5 / 20 / 93 / 230 |
| Liga Mexicana del Pacífico, inverno (10 times, 2025-26) | 68 | 8 classificados; 3 rodadas melhor de 7 (até 21) (máx. 89) | 1 / 4 / 15 / 68 / 170 |
| Liga Venezolana (8 times, 2025-26) | 56 | round robin de 5 times, 16 jogos; final melhor de 7 (máx. 79) | 1 / 4 / 14 / 56 / 140 |
| Liga Dominicana (6 times, 2025-26) | 50 | round robin de 4 times, 18 jogos; final melhor de 9 (máx. 77) | 1 / 3 / 12 / 50 / 125 |
| Liga de Porto Rico (6 times, 2025-26) | 40 | semifinais e final melhor de 7 (até 14) (máx. 54) | 1 / 3 / 10 / 40 / 100 |
| Série Nacional de Cuba (16 times, 2025-26) | 75 na primeira fase | segunda fase e playoffs (máx. ~100) | 1 / 5 / 18 / 75 / 190 |
| Série do Caribe (5 times em 2026) | 4 (todos contra todos) | semifinal (1) + final (1) (máx. 6) | 1 / 2 / 4 / 6 / 15 (vitalício, soma edições) |
| Clássico Mundial 2026 (20 seleções) | 4 (grupos de 5) | quartas, semi e final em jogo único (3) (máx. 7, a cada 3 ou 4 anos) | 1 / 2 / 4 / 7 / 18 (vitalício) |
| Olimpíada 2028 (6 seleções) | 2 | 2 a 3 jogos de decisão (máx. 5, a cada 4 anos) | 1 / 2 / 3 / 5 / 12 (vitalício) |
| Jogos Pan-Americanos 2027 (8 seleções) | 3 a 4 | super round ou semi + final (2 a 3) (máx. 7, a cada 4 anos) | 1 / 2 / 4 / 7 / 18 (vitalício) |

**Base adotada no pacote:** Platina **81** em `baseball.loyalty.favorite_games`: a metade exata da temporada da MLB (os 81 jogos em casa), número que o torcedor de beisebol reconhece, e que coincide com a temporada inteira com pós-temporada de uma liga de inverno (Venezuela 56 + 16 + 7 = 79; Dominicana 50 + 18 + 9 = 77; México inverno 68 + até 21). Nenhum torcedor assiste aos 162 com presença verificada; o assíduo da MLB acompanha 60 a 100 por ano. Lendário 200 = 2,5 temporadas de 81. Os Degraus 1 / 8 / 27 / 81 / 200 crescem 8x, 3,4x, 3x e 2,5x: o salto do Bronze para a Prata é maior porque há jogo todo dia e 8 jogos saem em duas semanas. A raridade dos momentos foi calibrada na temporada de 162; para o torcedor de liga de inverno (40 a 68 jogos) o Platina de "Entradas extras" (14) e "Por uma corrida" (23) vale por 2 temporadas.

**Mercados que divergem:** a temporada de 162 jogos é só da MLB; as ligas de inverno têm 40 a 68, a mexicana de verão 93 e Cuba 75. Para a liga mexicana de verão e Cuba, o Platina 81 sai antes do fim da temporada regular. Pós-temporada: 40 a 80 jogos de mata-mata por ano para o assíduo e 10 a 20 jogos de final. A raridade do mercado principal (México e Caribe) prevalece onde diverge (vitória em final).

## 6. Hóquei no gelo (`hockey`)

| Competição | Jogos por time na temporada regular | Mata-mata ou playoff típico | Degraus de fidelidade resultantes |
| --- | --- | --- | --- |
| Liga norte-americana (NHL, 32 times) | 82 | 4 séries de melhor de 7 (4 a 28) (máx. 110) | 1 / 5 / 15 / 41 / 100 |
| Liga russa (KHL, 22 times em 2025-26) | 68 | 4 séries de melhor de 7 (16 a 28) (máx. 96) | 1 / 5 / 15 / 34 / 90 |
| Liga de desenvolvimento (AHL, 32 times) | 72 | melhor de 3, melhor de 5, melhor de 5, melhor de 7, melhor de 7 (até 27) (máx. 99) | 1 / 5 / 15 / 36 / 90 |
| Liga sueca (SHL, 14 times) | 52 | play-in (até 3) + 3 séries de melhor de 7 (até 21) (máx. 76) | 1 / 4 / 12 / 26 / 65 |
| Liga finlandesa (Liiga, 16 times) | 60 | play-in + 3 a 4 séries (até 28) (máx. 88) | 1 / 4 / 12 / 30 / 75 |
| Liga alemã (DEL, 14 times) | 52 | pré-playoff (até 3) + 3 séries de melhor de 7 (até 21) (máx. 76) | 1 / 4 / 12 / 26 / 65 |
| Liga suíça (National League, 14 times) | 52 | play-in + 3 séries de melhor de 7 (até 21) (máx. 76) | 1 / 4 / 12 / 26 / 65 |
| Mundial masculino da IIHF (16 seleções) | 7 (grupo de 8) | quartas, semi, final ou bronze (3) (máx. 10 por edição, anual) | 1 / 2 / 4 / 10 / 25 (soma edições) |
| Torneio olímpico masculino (12 seleções) | 3 (grupo de 4) | qualificação (1) + quartas, semi, final ou bronze (3) (máx. 7, a cada 4 anos) | 1 / 2 / 4 / 7 / 14 (soma edições) |
| Liga feminina profissional (PWHL, 8 times) | 30 | 2 séries de melhor de 5 (6 a 10) (máx. 40) | 1 / 3 / 8 / 20 / 50 |

**Base adotada no pacote:** Platina **41** em `hockey.loyalty.favorite_games`, metade da temporada da NHL, e não 82: a liga joga 3 a 4 vezes por semana durante 6 meses, boa parte em dia de semana e em fusos distantes do Brasil e da América hispânica (costa oeste depois da meia-noite em Brasília), e o assíduo acompanha, com presença de 2/3, cerca de metade dos jogos do time. Nas ligas europeias (52 a 60), 41 é 70 a 80% da temporada. Lendário 100 = 2,5 temporadas desse ritmo. Playoff: o assíduo assiste a 15 a 20 jogos de mata-mata por temporada; Platina de `knockout_watched` = 16 (as vitórias que levam ao título), Lendário 40. Meses diferentes: 9 (setembro a junho, com Mundial em maio e olímpico em fevereiro), Lendário 18.

**Mercados que divergem:** no Canadá e nos EUA o torcedor assíduo assiste a mais jogos e a Platina seria 60 ou mais; o pacote calibrou para o Brasil e a América hispânica, onde o hóquei é nicho. Para a PWHL (30 jogos), a tabela acima fica para a Conquista sazonal por competição que vier depois.

## 7. Vôlei (`volleyball`)

| Competição | Jogos por time na temporada regular | Mata-mata ou playoff típico | Degraus de fidelidade resultantes |
| --- | --- | --- | --- |
| Superliga masculina e feminina (12 clubes, turno e returno; 8 aos playoffs) | 22 | quartas e semi em melhor de três (até 6) + final única (1) (máx. 29) | 1 / 3 / 8 / 22 / 60 |
| Ligas nacionais sul-americanas (Argentina, Peru, Chile, Colômbia etc.; 8 a 12 times com playoffs) | 14 a 24 | 4 a 8 (máx. 20 a 30) | 1 / 3 / 8 / 22 / 60 (mesma régua) |
| Campeonato Sul-Americano de Clubes (9 times em 3 grupos de 3 em 2026) | 2 | semi e final (2) (máx. 4) | 1 / 2 / 4 / 8 / 20 (vitalício) |
| Liga das Nações, masculina e feminina (18 seleções, 3 semanas de 4 jogos; 8 à fase final) | 12 | quartas, semi e final (3) (máx. 15) | 1 / 3 / 7 / 15 / 40 |
| Torneio olímpico (12 seleções, 3 grupos de 4; 8 às quartas) | 3 | quartas, semi e final (3) (máx. 6, a cada 4 anos; 8 no formato antigo) | 1 / 2 / 4 / 8 / 20 (vitalício) |
| Torneio pan-americano (8 seleções, 2 grupos de 4; líderes direto à semi) | 3 | quartas (1) + semi e final (2) (máx. 5 a 6, a cada 4 anos) | 1 / 2 / 4 / 8 / 20 (vitalício) |

**Base adotada no pacote:** Platina **22** em `volleyball.loyalty.favorite_games`, a fase classificatória da Superliga, e Lendário 60 (quase três fases classificatórias ou duas temporadas com playoffs e copas). A temporada completa do torcedor assíduo de clube no Brasil é de 35 a 45 jogos (Superliga 22 a 29 + Copa Brasil 2 a 3 + Sul-Americano 4 + estadual 6 a 10), mais 12 a 15 da seleção na Liga das Nações para quem também torce pela seleção.

**Mercados que divergem:** o torcedor de vôlei no Brasil torce pela seleção tanto quanto pelo clube; a Liga das Nações, os Jogos Olímpicos e o Pan são a metade mais vista do vôlei no país, e dependem de o time do coração aceitar seleção (pergunta no consolidado). Os formatos das ligas sul-americanas variam de 14 a 24 jogos e usam a mesma régua da Superliga.

## 8. Handebol (`handball`)

| Competição | Jogos por time na temporada regular | Mata-mata ou playoff típico | Degraus de fidelidade resultantes |
| --- | --- | --- | --- |
| Liga alemã masculina (18 clubes) | 34 | nenhum (copa nacional à parte, 3 a 5) (máx. 34) | 1 / 4 / 13 / 34 / 90 |
| Liga espanhola (16 clubes) e liga francesa (16 clubes) | 30 | nenhum (máx. 30) | 1 / 4 / 12 / 30 / 80 |
| Liga alemã feminina (14 clubes; 11 em 2025-26) | 26 | nenhum (máx. 26) | 1 / 3 / 10 / 26 / 70 |
| Liga dos Campeões masculina 2024-25 (16 clubes, 2 grupos de 8) | 14 | play-off (2) + quartas (2) + Final4 (2) (máx. 20) | 1 / 2 / 6 / 20 / 50 |
| Liga dos Campeões masculina a partir de 2026-27 (24 clubes) | 6 + 8 | quartas (2) + Final4 (2) (máx. 18) | 1 / 2 / 6 / 18 / 45 |
| Liga dos Campeões feminina (16 clubes, 2 grupos de 8) | 14 | play-off (2) + quartas (2) + Final4 (2) (máx. 20) | 1 / 2 / 6 / 20 / 50 |
| Mundial masculino e feminino (32 seleções: grupos, fase principal, quartas, semi, final) | 3 + 3 | quartas, semi, final (3) (máx. 9) | 1 / 2 / 4 / 9 / 25 |
| Europeu masculino e feminino (24 seleções: grupos, fase principal, semi, final) | 3 + 4 | semi e final (2) (máx. 9) | 1 / 2 / 4 / 9 / 25 |
| Torneio olímpico (12 seleções, 2 grupos de 6) | 5 | quartas, semi, final (3) (máx. 8, a cada 4 anos) | 1 / 2 / 4 / 8 / 20 (vitalício) |
| Pan-Americano (8 seleções, 2 grupos de 4) | 3 | semi e final (2) (máx. 5, a cada 4 anos) | 1 / 2 / 3 / 5 / 12 |
| Sul e Centro-Americano de seleções | 3 a 4 | 2 (máx. 6) | 1 / 2 / 3 / 6 / 15 |

**Base adotada no pacote:** duas Platinas de fidelidade, porque o público-alvo (Brasil e América hispânica) acompanha seleção antes de clube. `favorite_games` tem Platina **30**, o meio das ligas europeias (26 a 34): o torcedor de clube fecha numa temporada; o torcedor só de seleção leva 1,5 a 2 anos (com amistosos), aceitável porque a Conquista é vitalícia além da sazonal. `tournament_games` tem Platina **18**: dois torneios inteiros no ano (masculino e feminino, ou seleção e Olimpíada no ano olímpico). Mata-mata assistido: Platina 10 (3 por torneio de seleção, mais play-off e Final4 de clube). Vitória fora e mata-mata vencido: Platina 8; virada no 2º tempo: 8; dois tempos vencidos: 12.

**Mercados que divergem:** quem segue a seleção masculina e a feminina vê 2 torneios grandes por ano (18 jogos no máximo) mais 4 a 8 amistosos e qualificatórios; quem adota um clube europeu soma 55 a 60 jogos (30 a 34 de liga, 3 a 5 de copa, até 20 de Liga dos Campeões). Se o programa do cliente cobrir só uma seleção, a Platina de `tournament_games` justa seria 9 (pergunta no consolidado).

## 9. Rugby (`rugby`)

| Competição | Jogos por time na temporada regular | Mata-mata ou playoff típico | Degraus de fidelidade resultantes |
| --- | --- | --- | --- |
| Super Rugby Pacific (11 times) | 14 (16 rodadas, 2 folgas) | top 6: qualificatória, semi e final (3) (máx. 17) | 1 / 2 / 5 / 14 / 40 |
| Super Rugby Americas (8 times) | 14 (turno e returno) | top 4: semi e final (2) (máx. 16) | 1 / 2 / 5 / 14 / 40 |
| Top 14 (14 clubes) | 26 | top 6: barragem, semi e final (3) (máx. 29) | 1 / 4 / 10 / 26 / 70 |
| Premiership (10 clubes) | 18 | top 4: semi e final (2) (máx. 20) | 1 / 3 / 8 / 18 / 50 |
| URC (16 times) | 18 | top 8: quartas, semi e final (3) (máx. 21) | 1 / 3 / 8 / 18 / 50 |
| Champions Cup (4 jogos de fase de liga, oitavas a final) | 4 | 4 (máx. 8) | 1 / 2 / 4 / 8 / 20 |
| Six Nations (6 seleções) | 5 | nenhum (máx. 5) | 1 / 2 / 3 / 5 / 15 (vitalício, soma edições) |
| Rugby Championship (4 seleções, mini-turnês) | 6 (3 em ano de Copa; sem edição em 2026) | nenhum (máx. 6) | 1 / 2 / 3 / 6 / 15 |
| Testes de julho e novembro (seleções de primeiro escalão) | 3 + 3 a 4 | — (máx. 7) | — (entram na soma de 10 a 14 testes por ano) |
| Copa do Mundo masculina 2027 (24 seleções) | 3 (grupos de 4) | oitavas, quartas, semi e final (4) (máx. 7, a cada 4 anos) | 1 / 2 / 4 / 7 / 20 (vitalício) |
| Copa do Mundo feminina 2025 (16 seleções) | 3 | quartas, semi e final (3) (máx. 6, a cada 4 anos) | 1 / 2 / 4 / 6 / 18 (vitalício) |
| Sudamérica Rugby Championship (4 seleções) | 3 | repescagem (2) (máx. 5) | 1 / 2 / 3 / 5 / 15 |
| Série mundial de sevens 2025-26 (8 seleções, 6 etapas de 2 dias + campeonato em 3 pernas) | 3 de grupo por etapa | semi e final ou disputa de posição (2) (máx. 5 por etapa, 30 por série, mais 15 a 18 no campeonato) | 1 / 5 / 12 / 30 / 75 |
| Sevens olímpico (12 seleções, 3 dias) | 3 | quartas, semi e final ou posição (3) (máx. 6, a cada 4 anos) | 1 / 2 / 4 / 6 / 18 (vitalício) |
| Sevens pan-americano (8 seleções, 2 dias) | 3 | semi e final ou posição (2) (máx. 5, a cada 4 anos) | 1 / 2 / 3 / 5 / 15 (vitalício) |

**Base adotada no pacote:** Platina **20** em `rugby.loyalty.favorite_games`: cobre a liga regional de 14 a 18 jogos com o mata-mata, ou a seleção com os testes de um ano (10 a 14); o Top 14 (26) sobra para o Lendário chegar antes. A frequência dos momentos usa 20 jogos por temporada como base. `loyalty.dawn_games` (jogos das 2h às 8h) tem Platina 15, uma temporada de Super Rugby Pacific; `predictions.round_streak` tem Platina 20, uma temporada do URC ou da Premiership sem pular rodada. Explorador: competições Platina 15 (41 cobertas), times diferentes 30, meses 12.

**Mercados que divergem:** o torcedor só de seleção (caso típico do Brasil e da Argentina) vê 10 a 14 testes por ano, 7 a mais em ano de Copa, mais 30 jogos de sevens se acompanhar a série; o torcedor de clube de liga regional, 16 a 29 jogos do time mais os testes. O sevens (jogo de 14 minutos, 5 a 6 jogos da mesma seleção num fim de semana) acelera as Conquistas de contagem, e isso é aceito; o Super Rugby Pacific joga das 3h às 7h no fuso de Buenos Aires e Brasília.

## 10. Futebol australiano (`afl`)

| Competição | Jogos por time na temporada regular | Mata-mata ou playoff típico | Degraus de fidelidade resultantes |
| --- | --- | --- | --- |
| Liga masculina (18 clubes) | 23 em 24 rodadas (uma de folga; 25 contando a rodada de abertura de 2025) | 8 clubes, 4 semanas: quem vence a final qualificatória joga 3; quem perde e segue, 4 (máx. 27) | 1 / 3 / 9 / 23 / 60 |
| Liga feminina (18 clubes) | 12 em 12 rodadas (2025; 11 em 2024) | mesmo sistema de 8 clubes e 4 semanas (máx. 16) | 1 / 2 / 5 / 12 / 30 |
| Finais masculinas (todas as partidas da fase) | 9 jogos por temporada | — (máx. 9) | 1 / 2 / 4 / 9 / 25 |
| Torcedor de um clube que acompanha os dois times | 35 (23 + 12) | até 8 (máx. 43) | 1 / 4 / 12 / 35 / 90 |

**Base adotada no pacote:** Platina **23** em `afl.loyalty.favorite_games` (a temporada regular masculina), **9** nas finais assistidas (todas as finais de uma temporada masculina), e a liga feminina fica como folga, já que o `where` não filtra por competição. Meses com jogo: março a setembro (masculino) e agosto a novembro (feminino), 9 por ano; meses diferentes 1 / 2 / 4 / 8 / 16 (Platina quase o ano inteiro, Lendário 2 anos). Clubes diferentes assistidos tem Lendário 18, o total de clubes.

**Mercados que divergem:** para o Brasil e a América hispânica, quase todos os 23 jogos começam entre 0h e 8h locais (um jogo às 19h30 de Melbourne começa às 6h30 em Brasília; um de sábado às 13h45, 0h45): a Conquista `dawn_games` (0h às 7h) é a que mais fala com o mercado principal. A temporada feminina (12 jogos) só vira Carta própria com `where.competition` ou `where.gender`.

## 11. Fórmula 1 (`formula-1`)

| Competição | Jogos por time na temporada regular | Mata-mata ou playoff típico | Degraus de fidelidade resultantes |
| --- | --- | --- | --- |
| Campeonato mundial de monopostos (24 corridas em 2024, 2025 e 2026; 21 países sede em 2026; 20 carros em 2024-25, 22 em 2026) | 24 corridas por temporada (março a dezembro, 10 meses) | não há; 6 sprints por ano à parte (2025: China, Miami, Bélgica, Austin, São Paulo, Catar; 2026: Xangai, Miami, Montreal, Silverstone, Zandvoort, Singapura) | corridas assistidas 1 / 3 / 8 / 24 / 60; Palpite em toda corrida, idem |

**Base adotada no pacote:** Platina **24** = a temporada inteira de corridas; Lendário 60 = duas temporadas e meia. Não há piloto nem equipe do coração no Perfil, então o lado do torcedor é "as corridas do ano que ele acompanha", e a frequência de cada momento é "quantas corridas por temporada têm o fato". Os sprints ficam à parte: se a plataforma os espelhar como eventos próprios, entram numa Conquista futura (`formula_1.loyalty.sprints`, 1 / 2 / 3 / 6 / 15) e nunca dentro das 24 corridas; hoje o contrato só tem `race_weekend` em `event.stage.kind`. Meses diferentes: Platina 10 (os meses com corrida).

**Mercados que divergem:** o que muda entre as Américas é só o horário. Madrugada (22h às 5h59 no fuso do programa): Austrália, China, Japão e Las Vegas, 4 corridas por temporada no Brasil, na Argentina e nos EUA, 5 no México (janela 22h a 6h). Manhã cedo (6h às 10h59): as europeias, Bahrein, Baku e Singapura, 10 a 12 corridas; a janela converge nas três regiões. Horários de largada de 2025 no horário local do torcedor:

| Etapa (fuso da pista) | Brasil e Argentina | México (centro) | EUA (leste) |
| --- | --- | --- | --- |
| Austrália | 1h dom | 22h sáb | 0h dom |
| China (sprint 0h BRT) | 4h dom | 1h dom | 3h dom |
| Japão | 2h dom | 23h sáb | 1h dom |
| Bahrein | 9h | 6h | 11h |
| Arábia Saudita, Catar | 14h, 13h | 11h, 10h | 13h, 12h |
| Baku | 8h | 5h | 7h |
| Europa (15h local, verão) | 10h | 7h ou 8h | 9h |
| Singapura | 9h | 6h | 8h |
| Las Vegas (20h local sáb) | 1h dom | 22h sáb | 23h sáb |
| Américas (Miami, Canadá, Austin, México, São Paulo) | 13h a 17h | 11h a 14h | 12h a 16h |

## 12. MMA (`mma`)

Não há "temporada" de MMA como no futebol: a organização principal roda o ano inteiro, quase todo sábado, e a temporada do torcedor é o ano civil.

| Competição | Jogos por time na temporada regular | Mata-mata ou playoff típico | Degraus de fidelidade resultantes |
| --- | --- | --- | --- |
| Organização principal (42 eventos por ano em 2024 e 2025; 517 lutas em 2024 e 520 em 2025; 12,3 a 12,4 lutas por card; 21 lutas de cinturão e cerca de 50 lutas de 5 rounds por ano; 10 países sede em 2024; eventos aos sábados) | 150 a 180 lutas por ano para o torcedor assíduo (card principal de uns 30 eventos mais algumas preliminares) | não há | `loyalty.fights_watched` 1 / 10 / 40 / 150 / 400; `loyalty.saturday_nights` 1 / 8 / 25 / 80 / 200 |
| Demais organizações cobertas pela plataforma | 12 a 20 eventos por ano cada | não há | entram na mesma contagem |

**Base adotada no pacote:** Platina **150** lutas em `mma.loyalty.fights_watched` (cards principais de 30 eventos) e Lendário 400 (2,5 temporadas); `saturday_nights` Platina 80 (metade dos sábados do ano com 5 lutas). A frequência dos momentos usa 180 lutas por ano como base: nocaute Platina 50, finalização 30, decisão 90, nocaute no 1º round 25, finalização no 1º round 15. Como cada luta é um `event` e não há chave de card na linguagem, a fidelidade é toda por luta; "eventos assistidos" espera a próxima rodada da linguagem. Palpite de vencedor: Platina 40, calibrada para quem palpita só nas lutas principais (quem palpita no card inteiro acerta 80 a 100 por ano).

**Mercados que divergem:** os percentuais são da organização principal, que Brasil e América hispânica assistem igualmente, então não há divergência de raridade; o único ajuste é o fuso. Para Brasil e Argentina (UTC-3), os cards principais dos EUA começam às 23h ou 0h e as lutas principais entram depois da meia-noite (30 a 40 lutas por ano na janela 0h a 6h; `night_owl` Platina 20); para México e Colômbia (UTC-6 e UTC-5) quase nenhuma luta cai nessa janela, e o torcedor de lá alcança mais fácil `early_bird` (eventos na Ásia e no Oriente Médio, Platina 12) e `saturday_nights`.

## Resumo

| Esporte | Platina de fidelidade (`loyalty.favorite_games` ou equivalente) | Lendário | Observação |
| --- | --- | --- | --- |
| Futebol | 38 | 100 | a liga de 38 rodadas; a temporada do torcedor brasileiro chega a 60 a 75 jogos com estadual, copa e continental, deixados como folga |
| Basquete | 38 | 100 | o NBB; Argentina a 2 jogos; seleções 5 a 8 por torneio, vitalício |
| NBA | 82 | 200 | temporada regular inteira; Degraus 1 / 6 / 25 / 82 / 200 fora do 2,5x (Bronze no primeiro dia); alternativa em aberto: 60 |
| Futebol americano | 17 | 45 | temporada curta: quase todo momento vira único; universitário 12 a 13 jogos; meses Platina 7 |
| Beisebol | 81 | 200 | metade da MLB (jogos em casa) = temporada inteira com pós-temporada de uma liga de inverno; Degraus 1 / 8 / 27 / 81 / 200 |
| Hóquei | 41 | 100 | metade da NHL, pelo ritmo e pelo fuso do torcedor das Américas; `knockout_watched` Platina 16 |
| Vôlei | 22 | 60 | fase classificatória da Superliga; ano do torcedor de clube 35 a 45, mais 12 a 15 de seleção |
| Handebol | 30 (`favorite_games`) e 18 (`tournament_games`) | não informado para `favorite_games` (a linha de 30 jogos da tabela dá 80); `tournament_games` não informado | seleção antes de clube: dois torneios inteiros no ano; se o programa cobrir só uma seleção, 9 seria mais justo |
| Rugby | 20 | não informado | liga regional com mata-mata ou seleção com os testes de um ano; `dawn_games` Platina 15; sevens conta como jogo comum |
| Futebol australiano | 23 | 60 | temporada regular masculina; finais assistidas Platina 9; liga feminina como folga |
| Fórmula 1 | 24 corridas | 60 | a temporada inteira; sprints à parte; madrugada repetível por exceção (4 por temporada) |
| MMA | 150 lutas | 400 | ano civil; cards principais de 30 eventos; sem contagem de cards na linguagem de hoje |
