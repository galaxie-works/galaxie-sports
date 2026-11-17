# Pesquisa: NBA (`nba`)

A pesquisa completa está em [basketball.md](basketball.md): os momentos, as frequências com fonte, o calendário e as decisões valem para os dois pacotes. Este arquivo traz só o que muda no `nba`.

## O que muda em relação ao `basketball`

| Item | `basketball` | `nba` | Por quê |
| --- | --- | --- | --- |
| Base de temporada | 38 jogos (NBB) | 82 jogos + até 30 de play-in e playoffs | calendário da liga ([tabela](basketball.md#calendário)) |
| Fidelidade base (`loyalty.favorite_games`) | 1 / 5 / 15 / 38 / 100 | 1 / 6 / 25 / 82 / 200 | Platina = uma temporada (pergunta 7 da pesquisa) |
| Jogos de playoff assistidos | 1 / 2 / 5 / 12 / 30 | 1 / 3 / 10 / 30 / 75 | até 28 jogos por time, 85 na liga; um torcedor assíduo vê 30 |
| Vitória fora de casa | 1 / 2 / 4 / 8 / 20 | 1 / 3 / 8 / 18 / 45 | 41 jogos fora, visitante vence perto de metade |
| Quarto de muitos pontos | 30+ pontos, 1 / 2 / 4 / 8 / 20 | 40+ pontos, 1 / 2 / 5 / 10 / 25 | média de 28,5 pontos por quarto contra cerca de 20 nas ligas |
| Vitória larga | 15+ de margem, 1 / 2 / 4 / 8 / 20 | 20+ de margem, 1 / 2 / 5 / 10 / 25 | 22% dos jogos da NBA decididos por 20+ |
| Massacre | 25+ de margem, única `rare` | 30+ de margem, única `special` | 89 jogos de 30+ em 2025-26 |
| Jogo de muitos pontos (total somado) | 180+, única `special` | 260+, repetível 1 / 2 / 4 / 8 / 20 | média de 228 pontos somados na NBA contra 160 a 170 |
| Prorrogação (qualquer time) | única `special` | repetível 1 / 2 / 4 / 8 / 20 | 6,3% dos jogos; quem assiste a 100 jogos vê 6 |
| Jogo apertado (até 3, vitória) | única `special` | repetível 1 / 2 / 4 / 8 / 20 | 13 a 14% dos jogos decididos por até 3 |
| Virada de 15+ / 20+ / último quarto | `rare` / `historic` / `rare` | `special` / `rare` / `special` | mais jogos e mais pontos por jogo |
| Acerto do vencedor do seu time | 1 / 3 / 8 / 20 / 50 | 2 / 5 / 15 / 45 / 120 | 82 jogos, acerto em 55% |
| Acerto do vencedor nos playoffs | 1 / 2 / 5 / 12 / 30 | 1 / 3 / 8 / 20 / 50 | 85 jogos de playoff por temporada |
| Explorador | competições, países, meses | times diferentes assistidos (Lendário = 30), meses (Platina 8, Lendário 16) | a NBA tem duas competições; a temporada vai de outubro a julho |
| Fuso | jogo de manhã (6h às 12h), vitalício | coruja (23h às 5h), por temporada | costa oeste joga de madrugada para o Brasil e a Argentina |
| Triple-double (inativa) | única `historic` | repetível 1 / 2 / 5 / 10 / 25 | 149 por temporada, 5 por time |
| 50 pontos, buzzer-beater, 10 bolas de 3 (inativas) | `legendary` / `historic` / `legendary` | `rare` / `rare` / `historic` | 18, 16 e 10 a 15 por temporada na NBA |

## Momentos só do `nba`

| Momento | Frequência | Detecta? |
| --- | --- | --- |
| Jogo de madrugada (23h às 5h no fuso do programa) | um terço do calendário para quem segue um time da costa oeste: 25 a 30 jogos por temporada; 10 a 15 para os demais (estimativa própria sobre os horários de 19h a 22h30 do fuso do Pacífico) | Sim: `where.local_hour` |
| Times diferentes assistidos | 30 franquias; um torcedor assíduo vê 12 a 20 times diferentes numa temporada | Sim: `count.distinct` com `key: team` |
| Summer League | 4 a 6 jogos por franquia em julho ([NBA](https://pr.nba.com/2025-nba-summer-league-schedule)) | Conta nas mesmas Conquistas da franquia; ver pergunta 6 da pesquisa |

## Perguntas específicas

As perguntas 5 (fases dos playoffs em `event.stage.kind`), 6 (Summer League) e 7 (Platina 82) de [basketball.md](basketball.md#perguntas-para-o-dono) são do `nba`.
