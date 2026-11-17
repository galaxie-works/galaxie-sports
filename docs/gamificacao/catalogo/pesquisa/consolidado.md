# Consolidado dos 13 pacotes de pesquisa

Documento de trabalho interno. Reúne o que os 13 pacotes ([common](common.md), [football](football.md), [basketball](basketball.md), [nba](nba.md), [american-football](american-football.md), [baseball](baseball.md), [hockey](hockey.md), [volleyball](volleyball.md), [handball](handball.md), [rugby](rugby.md), [afl](afl.md), [formula-1](formula-1.md), [mma](mma.md)) deixaram para o dono decidir, em quatro blocos: as perguntas (deduplicadas e agrupadas por tema), as extensões da linguagem de regras pedidas, as exceções declaradas à régua de raridade e o que não coube em pacote nenhum. O calendário consolidado está em [../calendario.md](../calendario.md). Os números e termos vêm só dos pacotes; onde um esporte não trouxe algo, está escrito "não informado".

Legenda dos esportes: FUT futebol, BAS basquete, NBA, FAM futebol americano, BEI beisebol, HOQ hóquei, VOL vôlei, HAN handebol, RUG rugby, AFL futebol australiano, F1, MMA, COM comuns.

## 1. Perguntas para o dono

Cada pergunta traz o texto, os pacotes que a levantaram (entre parênteses, o número da pergunta no pacote) e o que muda conforme a resposta.

### Tema A: clássicos (`event.derby_id`)

1. **Em quais esportes e competições a plataforma marca `event.derby_id`, e com que critério?** Só os grandes clássicos (estaduais e nacionais no futebol; duas franquias da mesma cidade ou estado no beisebol; rivalidades históricas) ou toda rivalidade divisional e regional?
   - Levantada por: FUT (2), BAS/NBA (4), FAM (2), BEI (2), HOQ (4), VOL (4), HAN (5), RUG (4), AFL (4). As comuns usam o filtro sem perguntar.
   - O que muda: no FUT, os Degraus de `derby_watched` (Platina 10 sai cedo demais se marcarmos clássicos regionais em todas as 145 competições), `derby_win` e `derby_exact`; nas comuns, `common.moments.derby_win` e `common.loyalty.derby`; no BEI, `derby_win` (1/2/4/8/20); no FAM, `rivalry_watched` e `rivalry_win` (se todo jogo de divisão for clássico, o Platina sai cedo). Nos outros sete esportes a família de clássico **ficou fora** e só entra se o detector cobrir o esporte: `results.derby_win` e `loyalty.derby_watched` (BAS, NBA, HOQ, RUG), `derby_win`, `derby_watched` e `derby_exact` (VOL), `derby_win` (HAN), `derby_win` única `rare` (AFL).

### Tema B: finais, playoffs e fases

2. **Final em série ou em dois jogos: "vitória em final" conta cada jogo vencido, ou só o jogo que fecha?** `stage.kind = final` vale para os 4 a 9 jogos de uma série (basquete, hóquei, beisebol) e para as duas partidas de uma final em ida e volta (futebol); os fatos olham o placar do jogo, não o agregado, e um time pode "vencer a final" no jogo 1 e perder o título. Aceitar (é "vitória em jogo de final", como diz a descrição) ou esperar `event.series_winner` / agregado?
   - Levantada por: COM (3), FUT (4), HOQ (2), BEI (6); BAS decidiu "final única `historic`" sem perguntar.
   - O que muda: `common.moments.final_win`; FUT `final_win` e `final_winner` (Palpite); HOQ `final_win`, `knockout_winner`, `knockout_watched`; BEI `final_win` (`rare`); BAS/NBA `final_win`.

3. **O que entra em `stage.kind = final`?** (a) As finais de conferência do futebol americano (no profissional é a semifinal do título; no universitário, as 10 finais de conferência são "finais" de competição própria). (b) A final de cada etapa de sevens no rugby (até 6 por série para uma seleção forte).
   - Levantada por: FAM (3), RUG (3).
   - O que muda: FAM `final_win` assume só o jogo do título e é `legendary`; se as finais de conferência entrarem, cai para `historic`. RUG `results.final_win` é `historic` pelo XV; com as finais de sevens, a raridade fica errada para esse público (alternativa: esperar `where.format`).

4. **Como as fases de playoff chegam em `event.stage.kind`?** NBA: primeira rodada como `round_of_16`, semifinal de conferência como `quarter_final`, final de conferência como `semi_final`, final como `final`, play-in como `knockout_round`, e `final` só para a final da liga. Vôlei: quartas e semi da Superliga em melhor de três como `quarter_final` e `semi_final` ou como `playoff`/`regular`? Beisebol: o round robin das ligas de inverno (16 a 18 jogos por time) vem como `group` ou `knockout_round`? AFL: a final qualificatória não elimina quem perde; se vier como `regular` ou `group`, a primeira semana de finais some; vale um apelido `finals` no `where.stage`?
   - Levantada por: BAS/NBA (5), VOL (5), BEI (7), AFL (2).
   - O que muda: todas as Conquistas com `where.stage: ["knockout"]` e `["final"]` do NBA; VOL `playoff_win`, `playoff_winner`, `final_win`; BEI `playoff_winner` (os 16 a 18 jogos de round robin ficam fora do Palpite se vierem como `group`); AFL `finals_win`, `finals_winner`.

5. **A Summer League conta para `nba.loyalty.favorite_games` e para os resultados do seu time?** A regra atual conta (é a mesma franquia em `event.participants`).
   - Levantada por: NBA (6).
   - O que muda: se não, as Conquistas de resultado do NBA ganham `where.competition_type: ["league"]` e a Summer League fica só no Explorador.

6. **Pacote universitário separado (`college-football`)?** O calendário (12 + até 5) e o apelo (rivalidades, playoff de 12) são diferentes do profissional; hoje é um pacote só com Platina 17.
   - Levantada por: FAM (9).
   - O que muda: a existência de um segundo pacote, como `basketball`/`nba`.

### Tema C: semântica dos fatos de placar

7. **Virada medida só ao fim de período: aceitar?** O motor só vê o placar acumulado ao fim de cada período (quarto, tempo, entrada, set). Uma desvantagem aberta e revertida dentro do mesmo período não conta, e a frequência real fica abaixo da das manchetes (que contam a desvantagem em qualquer instante).
   - Levantada por: HOQ (3), AFL (5); BAS, FAM, BEI, HAN e RUG assumem o mesmo por construção.
   - O que muda: todas as viradas de `score.comeback` (HOQ 2 e 3 gols; AFL 30+ é `historic` e 42+ `legendary` por isso; BAS 15+, 20+ e último quarto; FAM 14+ e 21+; BEI 3 e 5 corridas; HAN 1 e 5 gols no intervalo; RUG 7+ e 14+ no intervalo). A alternativa é esperar o lance a lance do fornecedor.

8. **Parâmetro `at` de `score.comeback`:** (a) acrescentar `at: "before_last"` (estava atrás ao fim da penúltima entrada e venceu) para a "virada na nona" do beisebol, que hoje não cabe; (b) `at: any` inclui o fim da prorrogação? No rugby e no handebol nada muda (quem está atrás ao fim do `ot` perdeu), mas confirmar.
   - Levantada por: BEI (4), RUG (2); HAN declarou que `at: last_regular` não serve para o esporte (decisão 2) e BEI idem (decisão 5).
   - O que muda: BEI ganha a Conquista "virada na nona" (hoje inexistente); RUG viradas de 7+ e 14+.

9. **Vôlei: `score.comeback` em sets e `sets` lido do lado do `team`.** (a) No vôlei o "placar acumulado ao fim de cada período" precisa ser o placar de sets derivado de `s1`..`s5` (vencedor do set = lado com mais pontos), não a soma de pontos; o worker precisa dessa derivação por esporte. (b) `sets: "3-0"` é "o `team` venceu por 3 a 0", ou o motor normaliza como mandante x visitante?
   - Levantada por: VOL (1, 2).
   - O que muda: `reverse_sweep` e `set_comeback` (a); `sweep`, `tie_break_win` e as aproximações das inativas (b).

10. **Como o motor define `outcome` quando o tempo normal termina empatado?** Pênaltis no futebol (`status_detail = PEN`, vencedor em `score.penalty`), shootout no hóquei (`status_detail = AP`, vencedor em `so`), empate após prorrogação no futebol americano (`outcome: draw` com `ot` preenchido). As regras assumem que `outcome: win` com `penalties: true` / `shootout: true` olha o desempate.
    - Levantada por: FUT (3), HOQ (6), FAM (4).
    - O que muda: FUT `penalties` com `outcome: win`; HOQ `shootout_win`; FAM `tie` (`legendary`, o erro só apareceria anos depois).

11. **Chaves de prorrogação e desempate no placar por período.** (a) AFL: a prorrogação das finais vem como `ot` em `periods` ou somada ao `q4`? Se somar, `overtime: true` nunca dispara e `extra_time_final` precisa de `status_detail`. (b) FAM: `overtime: true` pega qualquer chave `ot*` com valor (`ot2`, `ot3` no universitário)? (c) HAN: duas prorrogações vêm como um `ot` somado ou como `ot` e `ot2`; e o desempate por 7 metros chega do fornecedor? Hoje o normalizador grava só `h1`, `h2`, `ot`, sem `so`. (d) BAS/NBA: aceitar `score.period` com `period: "ot2"` e `points_min: 1` como "existiu segunda prorrogação", ou criar `overtimes_min` em `score.result`?
    - Levantada por: AFL (1), FAM (5), HAN (1, 2), BAS/NBA (1).
    - O que muda: AFL `extra_time_final`; FAM prorrogação; HAN `shootout_win` (inativa, `legendary`) liga só gravando `so`; BAS/NBA dupla prorrogação (`historic`).

12. **Detalhes de `score.period` e `period_sweep`.** (a) `period: any` avalia só os períodos regulares (os quatro quartos), e não a prorrogação? (b) `shutout: true` em `score.period` com `team: favorite` compara os pontos do adversário no período com zero? (c) `period_sweep` exige vitória estrita nos três períodos, ou um período empatado no meio quebra a varrida? A regra assume "estritamente maior em todos".
    - Levantada por: FAM (6), AFL (6), HOQ (7).
    - O que muda: FAM `big_quarter`; AFL quarto sem pontos do adversário; HOQ três períodos vencidos (e todo `period_sweep` de BAS, NBA, FAM, HAN, AFL).

13. **Gol contra: de quem é o lance no fornecedor?** O `own_goal` vem com o time que se beneficiou ou com o time do jogador que marcou contra?
    - Levantada por: FUT (1).
    - O que muda: "gol contra a favor do seu time" (`detail: own_goal`, `team: ?`) ficou fora do pacote e entra assim que o normalizador confirmar.

14. **Instante do lance para `at_moment`.** (a) O `at_moment` do hat-trick é o terceiro gol; o do VAR é o minuto do lance `var` (que pode vir depois do gol anulado): confirmar que `minuteToInstant` recebe o lance certo. (b) Quando o `event_state_log` registrar o início de cada set, trocar `tie_break` do vôlei para `presence: at_moment`?
    - Levantada por: FUT (7), VOL (9).
    - O que muda: FUT `hat_trick` e `var_goal_disallowed`; VOL `tie_break` (hoje 2/3 do jogo inteiro).

15. **No-hitter em jogo encurtado conta?** Um jogo interrompido por chuva na 6ª com `breakdown.hits = 0` e status `finished` não é no-hitter oficial (precisa de 9 entradas). A regra assume que o motor só avalia jogo completo; `status_detail` distingue jogo encurtado?
    - Levantada por: BEI (3).
    - O que muda: `baseball.no_hitter`.

16. **`minute_max` é inclusivo?** Uma luta terminada exatamente em 1:00 conta em `minute_max: "1:00"`?
    - Levantada por: MMA (7).
    - O que muda: `lightning_finish` e `flash_finish`.

17. **Posição de largada real ou de classificação?** `race.detail.results.grid` traz a posição depois das punições ou a da classificação? Largada dos boxes é grid 0 ou nulo? A regra assume a posição real.
    - Levantada por: F1 (1).
    - O que muda: `places_gained_min` e `winner_from_grid_min`, ou seja, as quatro Conquistas de largada do vencedor, o pódio de recuperação e as posições ganhas.

18. **`finishers_min: 18` com 22 carros em 2026:** manter o absoluto (passa a ~70% das corridas) ou criar `retirements_max` relativo ao grid?
    - Levantada por: F1 (5).
    - O que muda: a Conquista de 18+ classificados (Platina 12).

### Tema D: Perfil e torcedor

19. **`fan.favorite_team_id` aceita uma seleção?** Se não, toda Conquista com `team: favorite` ignora Liga das Nações, Jogos Olímpicos, Pan, Mundiais e Europeus.
    - Levantada por: VOL (8). HAN (decisão 8) e RUG (decisão 1) calibraram a fidelidade supondo que o torcedor de seleção tem time do coração.
    - O que muda: no vôlei, a metade mais vista do esporte no Brasil; no handebol, `favorite_games` (Platina 30) e `tournament_games` (Platina 18) para o torcedor só de seleção; no rugby, a fidelidade do torcedor só de seleção (caso típico do Brasil e da Argentina).

20. **Piloto e lutador do coração (`fan.favorite_person_id`) entram no roadmap do Perfil?** É o mesmo campo para os dois esportes sem time.
    - Levantada por: F1 (6), MMA (5).
    - O que muda: F1 "pódio do seu piloto" (inativa, Platina 10); MMA `favorite_fighter_win` (inativa, `rare`) e a família `results` inteira, que o pacote não tem.

21. **Aceitar o fuso do programa (`program.time_zone`) como aproximação até existir `fan.time_zone`?** Para o Brasil (4 fusos), o México (3) e os EUA é uma aproximação declarada da linguagem: um cliente dos EUA com torcedor em Los Angeles vê o jogo das 3h de Nova York como 0h. Variante: variar a janela pelo país do programa numa rodada futura (a corrida de madrugada é 4 por temporada no Brasil e 1 no México, janela 0h–6h). Também: a Conquista comum de madrugador cobre os jogos da costa oeste do hóquei, ou vale uma "noite no gelo" própria?
    - Levantada por: AFL (10), RUG (6), F1 (10), HOQ (9); COM (§5) e MMA (decisão 8) declaram a aproximação.
    - O que muda: COM `early_bird`, `night_owl`, `weekend`; AFL `dawn_games`; RUG `dawn_games`; F1 madrugada e manhã cedo; NBA `night_owl`; BAS `morning_game`; MMA `night_owl`, `early_bird`, `night_winner`, `saturday_nights`.

22. **`event.starts_at` de cada luta é a hora da luta ou a do card?** Se for a do card, a luta principal de um card que começa às 23h fica fora da janela da madrugada mesmo começando à 1h.
    - Levantada por: MMA (6).
    - O que muda: `night_owl`, `early_bird`, `night_winner`, `saturday_nights`.

### Tema E: contagem (`count`) e temporada

23. **Semântica das sequências (`count.streak`).** (a) Com `unit: game` sobre um `moment`, um jogo do time que o torcedor **não** assistiu zera a sequência ou é ignorado? A linguagem diz "falhar a unidade zera", mas não diz o que é falhar quando o fato nem foi avaliado para aquele torcedor. (b) O `where` filtra antes do streak? `hit_streak` do futebol usa `where.sport: ["football"]`: um Palpite errado de basquete zera a sequência do futebol ou é ignorado? Assumido: filtra. (c) `round_streak` continua da última rodada de uma temporada para a primeira da seguinte (como está) ou zera na virada?
    - Levantada por: BAS/NBA (3), FUT (8), COM (7).
    - O que muda: (a) "sequência de vitórias assistidas" ficou fora dos dois pacotes de basquete; (b) `hit_streak` de todo esporte; (c) `common.predictions.round_streak` e `rugby.predictions.round_streak`.

24. **Qual é a temporada de uma Conquista comum (`seasonal`) multiesporte?** Ano civil ou a temporada do esporte do jogo? O motor já tem `predictions.correct` sazonal com `sport: null`; a mesma convenção serve.
    - Levantada por: COM (2).
    - O que muda: o progresso sazonal de todas as comuns ligadas a jogos.

25. **`side` em sede neutra: aceitar o nominal?** Em Mundial, Europeu e Olimpíada (handebol) e nas rodadas temáticas num mesmo estado (AFL), `side` é só a ordem de listagem do fornecedor.
    - Levantada por: HAN (3), AFL (7).
    - O que muda: HAN `away_win` (se não, limita a `competition_type: ["league"]`); AFL `away_win`.

### Tema F: régua de raridade, Degraus e Platinas

26. **Aprovar em bloco as exceções declaradas à régua de raridade** (lista na seção 3: fatos de 2 a 5 por temporada que ficaram repetíveis com Platina 8 para dar progressão)? A alternativa, em cada caso, é Conquista única `special`.
    - Levantada por: FUT (5), FAM (1), HOQ (1), VOL (3), F1 (3); BAS/NBA (decisão 6) e AFL (decisão 3) declararam sem perguntar.
    - O que muda: FUT `derby_win`; FAM `rivalry_win`; HOQ virada no 3º período; VOL `tie_break`; F1 corrida de madrugada; BAS/NBA vitória nos playoffs; AFL `away_win`.

27. **Aceitar que sequências e dimensões com teto não sigam 2,5x?** `common.predictions.streak` 2/4/7/10/15 (a dificuldade cresce de forma exponencial com o tamanho); `common.explorer.sports` e `common.collector.sports` 2/3/5/8/12 (teto 12); um Degrau de `common.explorer.countries`; BAS países 1/2/4/6/10; BEI competições 2/4/7/10/18 e países 1/2/4/6/9; AFL clubes (Lendário 18 = todos); FAM meses 7/14. O validador avisa e os avisos ficam.
    - Levantada por: COM (4); os demais declararam nas decisões.
    - O que muda: só a aceitação dos avisos do validador.

28. **Confirmar as Platinas de fidelidade que fogem da "temporada inteira".** NBA 82 (Degraus 1/6/25/82/200, saltos de 6x e 3,3x) ou 60 (temporada de quem perde os jogos de madrugada)? BEI 81 (metade da MLB = temporada inteira de liga de inverno) ou 162? HOQ 41 (calibrada para o torcedor das Américas; no Canadá seria 60 ou mais)? HAN `tournament_games` 18 (seleção masculina e feminina) ou 9 (se o programa cobrir só uma)? MMA `predictions.winner` 40 (quem palpita só nas lutas principais) ou 60 com Lendário 150 (quem palpita no card inteiro acerta 80 a 100 por ano)?
    - Levantada por: NBA (7), BEI (10), HOQ (8), HAN (8), MMA (9).
    - O que muda: `nba.loyalty.favorite_games`, `baseball.loyalty.favorite_games`, `hockey.loyalty.favorite_games`, `handball.loyalty.tournament_games`, `mma.predictions.winner`.

29. **Raridade por mercado ou uma raridade só?** O hat-trick é `rare` na Inglaterra e `historic` no Brasil (1 em 2024, 7 em 2025); a expulsão é `special` na Inglaterra e quase repetível na Espanha; shutout, massacre e 40 pontos são muito mais comuns no universitário que no profissional; os limiares das ligas FIBA (30 no quarto, 15 e 25 de margem, 180 somados) não valem para as seleções. O Catálogo tem uma raridade só e prevalece o mercado principal (Brasil e América hispânica; profissional). Fica assim, ou a raridade e os limiares podem variar pelo país do programa ou pelo tipo de competição numa rodada futura?
    - Levantada por: FUT (6), FAM (8), HOQ (8), BAS (8), F1 (10).
    - O que muda: FUT `hat_trick`, `red_card`; FAM shutout, massacre, 40 pontos; BAS limiares de pontos; F1 janela de madrugada.

30. **No-hitter: `historic` (pela régua, 0,12 por time e temporada) ou `legendary` (pelo peso cultural; em 2025 não houve nenhum)?**
    - Levantada por: BEI (1).
    - O que muda: a raridade e o bônus (120 ou 200) de `baseball.no_hitter`.

31. **Goleada de 50+ no rugby ganha Carta própria `historic`**, como o futebol faz com a virada de 2 e a de 3? Ficou fora para não duplicar a goleada de 30+.
    - Levantada por: RUG (8).

32. **Handebol: segunda Conquista "esteve num jogo de 1 gol" (vitória ou derrota, 5 a 6 por temporada, repetível)?** O pacote conta só a vitória (`one_goal_win`).
    - Levantada por: HAN (7).

33. **Gol nos acréscimos do 1º tempo vira uma segunda Conquista, ou é ruído?** `stoppage_time_goal` ficou só com `period: 2H`.
    - Levantada por: FUT (9).

34. **"Entradas extras" ganha nota sobre o corredor automático ("ghost runner") na descrição?** A Conquista não distingue.
    - Levantada por: BEI (9).

35. **`common.moments.derby_win` e `final_win` como únicas (regra dos < 5) ou com 5 Degraus (1/3/8/20/50) para o torcedor de clube grande?**
    - Levantada por: COM (3).
    - O que muda: forma e raridade das duas comuns.

36. **Vermelho de 20 minutos (substituível) conta como "expulsão do adversário" quando os cartões do rugby chegarem?** A pesquisa assume que sim.
    - Levantada por: RUG (7).

### Tema G: Palpites

37. **Tipos novos de Palpite:** (a) método no MMA (nocaute, finalização ou decisão), o Palpite mais natural do esporte, como `kind: method`; (b) faixa de diferença no handebol ("vence por 1 a 3"), em vez de manter o placar exato ativo com acerto abaixo de 1%; (c) filtro pelo placar previsto (`predicted_score`) na entrada `prediction`, que o futebol pediu para o "pacote 0 x 0".
    - Levantada por: MMA (4), HAN (4), FUT (decisão 9).
    - O que muda: MMA ganha uma Conquista de acerto nova; HAN ganha uma Conquista de acerto (sem faixa, fica como está); FUT liga a inativa do 0 x 0 palpitado.

### Tema H: escopo das Conquistas comuns

38. **`loyalty.watched` entra ativa no seed (anexo A) ou fica inativa como no código até a regra de presença entrar?**
    - Levantada por: COM (1).

39. **`common.community.invite` entra no produto (crescimento viral) ou sai do Catálogo?** Se entra, o convite aceito precisa de sinal próprio e de regra anti-abuso (só Perfil que chega a assistir um jogo).
    - Levantada por: COM (5).

40. **Completar Coleção deve virar também Conquista (`common.collector.collections` e `.sports`, inativas), ou fica só o cosmético direto?**
    - Levantada por: COM (6).

41. **Cortar as comuns para ~25?** Candidatas a sair: `common.explorer.countries`, `common.loyalty.finals`, `common.rhythm.weekend`, `common.knowledge.trivia_streak` e uma das duas de colecionador.
    - Levantada por: COM (8).

### Tema I: dados do fornecedor e do normalizador a confirmar

42. **Qual é a "competição" e o "país" de uma luta no modelo?** `explorer.countries` usa `event.competition.country`; se a competição de MMA for a organização (país fixo ou nulo), a Conquista nunca sai e passa a inativa com `proposed.event.venue_country`. E se a plataforma cobrir várias organizações com `competition` distinta, vale um Explorador por organização?
    - Levantada por: MMA (1, 10).
    - O que muda: `mma.explorer.countries` (Platina 8, Lendário 16); uma Conquista `distinct competition` que ficou fora.

43. **O fornecedor separa decisão unânime de dividida de forma confiável?** O contrato diz "conforme o fornecedor".
    - Levantada por: MMA (3).
    - O que muda: "Decisão dividida" (19 por ano, repetível) e "Decisão unânime" entram com um parâmetro `decision_type`.

44. **Ids e tipos das competições:** (a) Superliga feminina e masculina são competições separadas em `event.competition.id`? (b) Liga das Nações é `league` ou `tournament`? (c) Six Nations, Rugby Championship e as séries de sevens chegam como `tournament`, `league` ou `cup`?
    - Levantada por: VOL (6, 7), RUG (5).
    - O que muda: VOL `competitions` (Platina 10 fica mais longe se o gênero for outro campo); `count.streak` por rodada na Liga das Nações e `rugby.predictions.round_streak` (filtra `league`).

45. **Chaves de período no sevens:** o fornecedor usa `h1`/`h2` ou `p1`/`p2`? Se `p1`/`p2`, `score.period` com `period: h2` não casa com sevens.
    - Levantada por: RUG (1).

46. **Sprints e classificação como eventos próprios na F1?** Se o sprint for espelhado como evento, conta em `races_watched` e `every_race` (24 viraria 30) e precisa de um `stage.kind` próprio; hoje o contrato só tem `race_weekend`. A classificação é evento próprio? `race.detail.startinggrid.qualifying_time` existe, mas a presença é por evento de corrida.
    - Levantada por: F1 (2, 9).
    - O que muda: `races_watched`, `every_race`, a futura `formula_1.loyalty.sprints` (1/2/3/6/15) e uma Conquista de "assistir à classificação" que não existe.

47. **Volta mais rápida e neutralizações entram no `race.detail`?** O fornecedor tem `fastest_lap` por corrida e, em alguns planos, os períodos de safety car.
    - Levantada por: F1 (8).
    - O que muda: "Fim de semana perfeito" e "Corrida neutralizada" (inativas).

48. **País da sede da corrida sobe ao `event` (`event.venue.country`)?** O espelho do fornecedor traz circuito e país; `event.competition.country` é nulo num campeonato global.
    - Levantada por: F1 (7); MMA depende da resposta da pergunta 42.
    - O que muda: F1 países (inativa; a Conquista de Explorador mais natural da modalidade); MMA `explorer.countries`.

49. **Calibrar com dado real antes de ligar:** (a) o total oficial de shutouts da NHL em 2024-25 (a frequência de 9 a 10% é estimativa própria; `shutout_win` pode subir para repetível ou cair para `rare`); (b) uma temporada de `s1`..`s5` da Superliga no banco para recalcular 26+, 30+ e 18+ no tie-break.
    - Levantada por: HOQ (10), VOL (10).
    - O que muda: HOQ `shutout_win`; VOL `deuce_set_win`, `marathon_set`, `tie_break_marathon`.

50. **Quais extensões da linguagem entram na próxima rodada?** A lista completa está na seção 2; as que os pacotes trataram como pergunta direta: `side` em `football.result` (FUT 10), `team_points_min`/`opponent_points_max` ou `points_min` em `score.result` (BAS 2, FAM 7), `total_max` (AFL 8), fato para `breakdown` (BEI 5, AFL 9), `walk_off` (BEI 8), `round_min` em `fight.result` (MMA 8), `where.competition` e `where.gender` (HOQ 5, AFL 3, HAN 6), `count.streak unit: event` (F1 4), chave de card em `count.distinct` (MMA 2).

Resolvida e registrada, sem decisão pendente: o hífen no id (FAM 10): prefixo com sublinhado (`american_football.`, `formula_1.`) em todo id derivado, `sport` com o slug.

## 2. Extensões da linguagem de regras pedidas pelos pacotes

Custo: **parâmetro** (campo novo num fato ou filtro que já existe, sem dado novo), **fato ou modo novo** (operador novo sobre dado que já chega), **dado novo** (o fornecedor ou o normalizador precisa mandar algo a mais), **Perfil** (campo novo no Perfil do torcedor), **sinal** (ação do produto que o motor ainda não emite). Os ids das Conquistas aparecem quando o pacote os escreveu; senão, o nome.

| Extensão | O que destrava (Conquistas inativas que passariam a ativas, ou fatos que ficaram fora) | Custo estimado |
| --- | --- | --- |
| `side` (`home` ou `away`) em `football.result` | FUT: vitória fora de casa (momento 25, 5 a 7 por temporada, repetível; ficou fora). `score.result` já tem `side`, e BAS, NBA, FAM, VOL, HAN, RUG, AFL e BEI o usam | parâmetro |
| `team_points_min` / `opponent_points_max` (ou `points_min`) em `score.result` | FAM: 40 pontos do time (inativa, `proposed.rule.params.score.result.points_min`); BAS/NBA: "130 pontos do seu time" e "100 pontos nas ligas FIBA" viram diretas em vez do total somado; HOQ: "6 gols" | parâmetro (o dado está em `event.score`) |
| `total_max` em `score.result` | AFL: jogo de placar baixo (inativa); FAM: placar baixo (fora); serve a BAS e HAN | parâmetro |
| `overtimes_min` em `score.result` | BAS/NBA: dupla prorrogação (hoje por interpretação de `score.period` com `ot2`); HAN: "duas prorrogações" futura; FAM: `ot2`/`ot3` do universitário | parâmetro |
| `walk_off` em `score.result` (derivação: mandante vence, marcou na última entrada jogada e não estava na frente antes dela) | BEI: `baseball.moments.walk_off` (inativa, `proposed.rule.param.score.result.walk_off`); liga sem mudar o contrato | parâmetro (derivado do placar por entrada) |
| `at: "before_last"` em `score.comeback` | BEI: "virada na nona" (não existe hoje) | parâmetro |
| Fato `score.breakdown` genérico (`stat`, `min`, `max`, `team`) ou `errors_max`/`hits_min` em `score.result` (`afl.breakdown`, `baseball.team_stat`) | AFL: 20+ goals e pontaria (2 inativas; `breakdown.goals/behinds` existe sem fato); BEI: jogo sem erros e 20+ rebatidas (fora; `breakdown.hits/errors` existe sem fato), e substitui `baseball.no_hitter` sem perder nada | fato novo sobre dado que já chega |
| Fato `football.team_stat` / `football.player_stat` (`stat`, `min`) sobre `football.detail` | FUT: goleiro com 5+ defesas e gol zerado, nota 9+ de um jogador (2 inativas); posse de bola de 70%+ com vitória (fora). VOL pede o mesmo (`volleyball.team_stat`/`player_stat`), mas lá o dado não existe | fato novo sobre dado que já chega (`Goalkeeper Saves`, `rating`, `Ball Possession`) |
| `round_min` (ou `last_round: true`) em `fight.result` + `proposed.fight.detail.scheduled_rounds` | MMA: `final_round_finish` (14 por ano, 1/2/5/14/35) e `fifth_round_finish` (única `rare`), 2 inativas; nocaute no 3º round (fora) | parâmetro + dado novo (número de rounds programados) |
| `predicted_score` na entrada `prediction` | FUT: 0 x 0 palpitado (inativa, `proposed.fan.prediction.predicted_score`) | parâmetro |
| `where.fight_result` (`won_type`) na entrada `prediction` | MMA: `finish_pick` (vencedor certo em luta que acabou antes do limite, inativa, 1/3/8/20/50) | filtro novo |
| `kind: method` no Palpite | MMA: acertar o método (nocaute, finalização, decisão); Conquista de acerto nova | tipo novo de Palpite (produto) |
| Palpite de faixa de diferença | HAN: "vence por 1 a 3"; Conquista de acerto nova | tipo novo de Palpite (produto) |
| `decision_type` em `fight.result` + `proposed.fight.detail.result.decision_type` | MMA: decisão dividida (19 por ano, repetível) e unânime | parâmetro + dado novo (ou confirmação do fornecedor) |
| `retirements_max` em `race.result` (relativo ao grid) | F1: alternativa a `finishers_min: 18` com 22 carros | parâmetro |
| `where.competition` (lista de ids) | HOQ: liga feminina, Mundial, olímpico como Conquistas sazonais; AFL: temporada feminina inteira (12 jogos); FUT: Conquistas sazonais por competição da tabela de calendário | filtro novo |
| `where.gender` + `proposed.event.competition.gender` | HAN: "acompanhe o torneio feminino inteiro" (a seleção feminina é a mais forte do país); AFL: temporada feminina | filtro + dado novo |
| `where.format` + `proposed.event.competition.format` | RUG: `rugby.loyalty.sevens_weekend` (inativa) e tudo que precisa saber que o jogo é de sevens (etapa inteira, medalha, etapa sem derrota); limiares de XV sem contaminação de sevens | filtro + dado novo |
| Apelido `finals` em `where.stage` | AFL: `finals_win` e `finals_winner` incluindo a final qualificatória (que não elimina) | apelido |
| `count.streak` com `unit: event` (eventos seguidos do `where`) | F1: corridas seguidas assistidas (hoje substituída por `each` com Platina 24); MMA: lutas seguidas | modo novo |
| `count.streak` com `unit: result` (resultado do time, não presença) | VOL: invencibilidade / sequência de vitórias do time (fora); BAS/NBA: sequência de vitórias assistidas (fora, também pela semântica da pergunta 23) | modo novo |
| Chave `card` em `count.distinct` (ou `event.stage` representando o card) + `proposed.event.card_id` + limiar por chave | MMA: `card_night` (noite com 3+ fins no 1º round, inativa, 1/3/8/18/45) e "eventos assistidos" (não existe) | dado novo + modo novo |
| `proposed.player_game_stats.*` (estatística de jogador por partida) | **O maior destrave: 16 inativas dependem só dele** e mais 2 que pedem também lance a lance. BAS: triple-double, 50 pontos, 10+ bolas de 3 (3); NBA: as mesmas 3; FAM: pick-six (`interception_touchdowns`), 300 jardas de passe (2); BEI: ciclo (1); HOQ: hat-trick (`goals`), 40+ defesas (`saves`) (2); VOL: atleta com 30+ pontos (`points`) (1); HAN: jogador com 10+ gols, goleiro com 15+ defesas (2); RUG: hat-trick de tries (`tries`) (1); AFL: "bag" de 5+ goals (1). Com lance a lance também: buzzer-beater (BAS e NBA). Ficaram fora pelo mesmo motivo: 5+ sacks, corredor com 100+ jardas (FAM), 10+ strikeouts (BEI), bônus ofensivo de 4 tries (RUG), nocaute no 3º round (MMA) | dado novo do fornecedor |
| `proposed.event.play_by_play` / `event.incidents.*` fora do futebol (lance a lance) | Cerca de 19 inativas ou fora: BAS/NBA buzzer-beater (2, também estatística); FAM safety, field goal decisivo no último lance (`last_scoring_play`) (2); BEI grand slam (1); HOQ gol em desvantagem numérica (`goal.strength`), penalty shot, empate com goleiro fora (`goal.minute`, `goal.empty_net`) (3; fato `hockey.goal` proposto com `strength`, `min_minute`, `extra_attacker`, `penalty_shot`); HAN gol no último segundo (`goal.second`), três 7 metros defendidos (`seven_metre`) (2); RUG drop decisivo, try depois da sirene (2) e vermelho do adversário (`incidents.type=card`) (1); AFL pegada espetacular (`incidents.mark`) (1); VOL três aces (`incidents.type=ace`), rally de 30 s (`rally_duration`), match point salvo (`point_sequence`) (3); FUT bicicleta (`shot_type`), gol do meio de campo (`shot_distance`) (2). Fora: HOQ gol de rede vazia e natural hat-trick; HAN expulsão e desqualificação; RUG virada dentro do 2º tempo; BEI home run | dado novo do fornecedor |
| `proposed.team_game_stats.blocks` | VOL: 15+ pontos de bloqueio (inativa) | dado novo |
| `proposed.event.score.breakdown.walks` (e hit by pitch) | BEI: jogo perfeito (inativa, aproximada pelo no-hitter) | dado novo |
| Chave `so` no placar do handebol (normalizador) | HAN: `shootout_win` (vitória nos 7 metros, inativa, `legendary`) | normalizador (`proposed.event.score.periods.so`) |
| `proposed.fan.favorite_person_id` | F1: pódio do seu piloto (inativa, Platina 10); MMA: `favorite_fighter_win` (inativa, `rare`) e a família `results` | Perfil |
| `proposed.fan.time_zone` | COM `early_bird`, `night_owl`, `weekend`; AFL `dawn_games`; RUG `dawn_games`; F1 madrugada e manhã; NBA `night_owl`; BAS `morning_game`; MMA `night_owl`, `early_bird`, `night_winner`, `saturday_nights` (todas ativas com a aproximação do fuso do programa) | Perfil |
| `proposed.event.venue.country` (país da sede) | F1: países (inativa; 21 países em 24 corridas); MMA: `explorer.countries` se `competition.country` for nulo | dado novo (o espelho do fornecedor já traz circuito e país) |
| `race.detail.results.team`, `fastest_lap`, `safety_car`, `red_flag`, `weather`, `results.career_wins`, `laps_led` | F1: pódio com três equipes, fim de semana perfeito (pole + vitória + volta mais rápida), safety car, primeira vitória de um piloto (4 inativas); bandeira vermelha, chuva, grande chelem (fora) | dado novo |
| `proposed.fight.detail.is_title_fight`, `card_position`, `weight_class`, `stats.knockdowns` | MMA: `title_fights` (inativa, 1/3/8/20/50); luta principal, luta feminina ou de peso-pesado terminando antes do limite, knockdown e virada (fora) | dado novo |
| Sprint como evento próprio com `stage.kind` próprio | F1: `formula_1.loyalty.sprints` (1/2/3/6/15) | normalizador |
| `event.series_winner` (vencedor da série) | COM, HOQ, BEI, BAS/NBA: "venceu a série" em vez de "vitória em jogo de final" | dado novo |
| Sinais de participação: trivia, enquete, consumo com subtipo (`recap`/`lineup`), convite aceito (`proposed.fan.invite`), Coleção completada (`proposed.collection.completed`), sequência por resposta de trivia | COM: `knowledge.trivia`, `common.knowledge.trivia_streak`, `community.poll`, `common.community.invite`, `consumption.recap`, `common.consumption.lineup`, `common.collector.collections`, `common.collector.sports` (8 inativas) | sinal do produto |

## 3. Exceções declaradas à régua de raridade

A régua ([padronização, seção 4](../padronizacao.md)): um fato que acontece **menos de 5 vezes por temporada** para o time do torcedor vira Conquista única (um Degrau, raridade pela frequência); acima de 5, repetível com 5 Degraus. A padronização admite uma exceção declarada para o fato de 3 a 5 por temporada muito reconhecido, para a Coleção ter progressão. Os pacotes declararam estas; o dono pode aprovar em bloco ou devolver cada uma a única `special`:

1. **Futebol: vitória no clássico** (`derby_win`), 3 a 4 por temporada no Brasil, 1 a 2 na Europa, repetível com 1/2/4/8/20; o Platina (8) vale por 2 temporadas no Brasil e 4 na Europa. É o fato que o torcedor mais reconhece (decisão 2, pergunta 5).
2. **Futebol americano: vitória no clássico de divisão** (`rivalry_win`), 3 por temporada (6 jogos de divisão, metade vencida), repetível com 1/2/4/8/20; Platina em 2 ou 3 temporadas. A vitória fora de casa (4 por temporada) **não** usou a exceção, para não usá-la duas vezes (decisão 2, pergunta 1).
3. **Hóquei: virada no 3º período** (entrou atrás, venceu), 4 a 5 por temporada, repetível com 1/2/4/8/20; Platina em 2 temporadas. "O jogo só acaba no terceiro" (decisão 2, pergunta 1).
4. **Vôlei: jogo de cinco sets** (`tie_break`), 3 a 5 por temporada, repetível com 1/2/4/8/20; Platina em 2 temporadas. `deuce_set_win` (4 a 5) encosta na régua e também é repetível (decisão 4, pergunta 3).
5. **Basquete e NBA: vitória nos playoffs**, a maioria dos times vence 0 a 4 por temporada, repetível com 1/2/4/8/16 nos dois pacotes; 16 é um título na NBA, 12 no NBB (decisão 6; não virou pergunta).
6. **Futebol australiano: vitória fora de casa** (`away_win`), 4 a 5 por temporada, repetível com Platina 8; um clube forte fecha numa temporada, um médio em duas (decisão 3; não virou pergunta).
7. **Fórmula 1: corrida de madrugada** (22h às 5h59 no fuso do programa), 4 por temporada no Brasil, na Argentina e nos EUA (5 no México), repetível com 1/2/4/8/20; Platina = 2 temporadas. É o fato mais reconhecido pelo torcedor das Américas: acordar para a corrida (decisão 5, pergunta 3).

Casos no limite da régua, declarados mas não tratados como exceção: handebol virada no 2º tempo (4,5 na liga, 6 a 7 com copa e Europa; Platina 8) e vitória em mata-mata (4 a 7; Platina 8); beisebol vitória no clássico (5 a 6; repetível). Exceção pedida no sentido contrário: beisebol no-hitter promovido de `historic` a `legendary` pelo peso cultural (pergunta 30).

Outras exceções declaradas, à regra dos **2,5 a 3x entre Degraus** (não à raridade), que o validador avisa e os pacotes mantêm: `common.predictions.streak` 2/4/7/10/15 e todas as sequências (dificuldade exponencial); `common.explorer.sports` e `common.collector.sports` 2/3/5/8/12 (teto 12); `common.explorer.countries` 8 → 15 (1,875x); basquete países 1/2/4/6/10 e beisebol competições 2/4/7/10/18 e países 1/2/4/6/9 (universo pequeno); AFL clubes diferentes com Lendário 18 (conjunto fechado); futebol americano meses 7/14 (o ano tem 7 meses de jogo); NBA fidelidade 1/6/25/82/200 (6x e 3,3x); beisebol fidelidade 1/8/27/81/200 (8x no primeiro salto, jogo todo dia).

## 4. O que não coube em nenhum pacote

Momentos que o torcedor reconhece e ficaram fora por falta de dado, de operador ou de sinal (uma linha por esporte; o detalhe está na tabela de momentos de cada pesquisa):

- **Comuns:** convite de amigo (sem `action` nem fato), Coleção completada (sem entrada), sequência por resposta de trivia (só `day`), subtipo de consumo (resumo e escalação não se distinguem), vencedor da série nos playoffs, fuso individual do torcedor.
- **Futebol:** gol ou jogo do título (sem dado de "jogo que decidiu o título"; `final` cobre só copas), gol de bicicleta (sem tipo de finalização), gol do meio de campo (sem distância), goleiro com 5+ defesas e nota 9+ de um jogador (dado em `football.detail`, sem fato), posse de 70%+ com vitória, gol contra a favor (atribuição do time ambígua), vitória fora de casa (sem `side` em `football.result`), 0 x 0 palpitado (sem filtro de placar previsto), empate aos 90+ (não virou Conquista para não repetir a Carta do gol da vitória).
- **Basquete e NBA:** triple-double, 50 pontos de um jogador, 10+ bolas de 3 (sem estatística de jogador), buzzer-beater que decide (sem lance a lance), sequência de vitórias assistidas (semântica do streak indefinida), 130 ou 100 pontos do time (só pelo total somado), clássico (cobertura do `derby_id` não confirmada), placar exato palpitado (quase impossível no esporte).
- **Futebol americano:** pick-six, safety, field goal decisivo no último lance, 300 jardas de passe, 5+ sacks, corredor com 100+ jardas (sem estatística de jogador nem lance a lance), 40 pontos do time (sem parâmetro), placar baixo (sem `total_max`), jogos de segunda e quinta à noite (o nome popular é marca registrada da liga e da emissora).
- **Beisebol:** walk-off fora das entradas extras (sem parâmetro), grand slam, home run, 10+ strikeouts, ciclo, jogo perfeito (sem lance a lance, estatística de jogador ou `walks`), jogo sem erros e 20+ rebatidas (dado em `breakdown` sem fato), virada na nona (sem `at: before_last`), dia de dois jogos (sem `count` por dia com mínimo 2), jogo encurtado por chuva ou regra de misericórdia (sem fato).
- **Hóquei:** hat-trick, goleiro com 40+ defesas (sem estatística de jogador), gol em desvantagem numérica, empate no último minuto com o goleiro fora, gol de penalty shot, gol de rede vazia, natural hat-trick e gol nos primeiros segundos (sem lance a lance nem minuto do gol), shootout de 10+ rodadas (o `so` não traz as rodadas), clássico (cobertura do `derby_id`), liga feminina, Mundial e olímpico como Conquistas próprias (sem `where.competition`).
- **Vôlei:** três aces seguidos, rally de 30+ segundos, match point salvo (sem lance a lance), 15+ pontos de bloqueio (sem estatística de time), atleta com 30+ pontos (sem estatística de jogador), invencibilidade da temporada (sem `streak` por resultado), clássico (cobertura do `derby_id`), final decidida no tie-break (repetiria duas Cartas), "estava lá no tie-break" com presença no instante (sem instante do set).
- **Handebol:** gol da vitória no último segundo, três 7 metros defendidos, expulsão e desqualificação do adversário (sem lance a lance), jogador com 10+ gols, goleiro com 15+ defesas (sem estatística de jogador), vitória nos 7 metros (sem chave `so`), virada de 9 gols (o motor só vê o intervalo), torneio feminino inteiro (sem gênero da competição), clássico (cobertura do `derby_id`), vitória sem sofrer gol (não existe no esporte).
- **Rugby:** hat-trick de tries, bônus ofensivo de 4+ tries (sem estatística de jogador), drop goal decisivo, try depois da sirene, virada dentro do 2º tempo (sem lance a lance), cartão vermelho do adversário (sem cartões fora do futebol), fim de semana inteiro de etapa de sevens, medalha, etapa sem derrota (sem marca de formato), clássico (cobertura do `derby_id`), goleada de 50+ (para não repetir a de 30+).
- **Futebol australiano:** 20+ goals de um time e mais goals que behinds (dado em `breakdown` sem fato), jogo de placar baixo (sem `total_max`), "bag" de 5+ goals de um jogador (sem estatística de jogador), pegada espetacular (sem lance a lance), clássico regional (cobertura do `derby_id`), temporada feminina inteira (sem `where.competition` ou `where.gender`), jogo decidido por até 10 pontos (repetiria a Carta do "até um goal").
- **Fórmula 1:** pódio com três equipes diferentes (sem parâmetro de equipe), pole + vitória + volta mais rápida e grande chelem (sem volta mais rápida nem voltas lideradas), safety car e bandeira vermelha (sem neutralizações), corrida na chuva (sem clima), primeira vitória de um piloto (sem histórico), pódio do seu piloto (sem piloto do coração), abandono do líder (sem volta a volta; e não é orgulho), países diferentes (sem país da sede), corridas seguidas assistidas (sem `unit: event`), sprints (sem evento próprio), assistir à classificação (sem evento próprio).
- **MMA:** fim no último round e no 5º round, nocaute no 3º round (sem `round_min`), noite com várias lutas acabando no 1º round e eventos assistidos (sem chave de card), luta de cinturão e luta principal (sem `is_title_fight` nem posição no card), decisão dividida (fornecedor não garante), knockdown e virada depois de knockdown (sem estatística de luta), vitória do seu lutador (sem lutador do coração), luta feminina ou de peso-pesado terminando antes do limite (sem categoria), vencedor certo em luta terminada antes do limite (sem filtro em `prediction`), Palpite de método (tipo que não existe).
