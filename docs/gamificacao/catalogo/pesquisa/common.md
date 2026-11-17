# Pesquisa: Conquistas comuns a todos os esportes

Material de trabalho das Conquistas com `sport: null` ([conquistas/common.json](../conquistas/common.json), [cartas/common.json](../cartas/common.json), [cartas/colecoes.json](../cartas/colecoes.json)). Aqui pode haver nome de liga e caso real para calibrar frequência; nada disso vai ao torcedor.

As 9 Conquistas que já existem no banco (`INITIAL_CATALOG` em `packages/game-rules/src/achievements.ts`) entram com id, nome, descrição, Degraus e bônus iguais aos do código, mais os campos novos (`collection`, `requires_data`, `real_world_frequency`). As 25 novas têm id `common.<familia>.<nome>`.

## 1. Lógica das famílias

| Família | O que mede | Conquistas | Regra base |
| --- | --- | --- | --- |
| `predictions` | palpitar e acertar | `predictions.correct`, `.exact_score`, `.winner`, `.quantity`, `.placed` (existentes); `common.predictions.full_hit`, `.streak`, `.round_streak`, `.competitions` | `input: prediction` com `kind`, `correct`, `fullHit`, `where.competition_type`, `count.streak`/`distinct` |
| `loyalty` | assistir (presença ≥ 2/3 do jogo) | `loyalty.watched` (existente); `common.loyalty.favorite_watched`, `.favorite_streak`, `.derby`, `.finals`, `.day_streak` | `input: participation, action: watched` com `where.favorite_playing`, `derby`, `stage`, `count.streak` |
| `explorer` | variedade | `common.explorer.sports`, `.competitions`, `.countries` | `watched` com `count.distinct` por `sport`, `competition`, `country` |
| `rhythm` | quando o torcedor assiste | `common.rhythm.early_bird`, `.night_owl`, `.weekend` | `watched` com `where.local_hour` ou `weekday` |
| `moments` | "Eu estava lá": o time do coração fez e o torcedor viu | `common.moments.favorite_win`, `.favorite_comeback`, `.derby_win`, `.final_win`, `.overtime_win` | `input: moment` com `game.result` / `game.comeback`, `team: favorite`, `presence: game`, `where.sport` |
| `knowledge` | trivia | `knowledge.trivia` (existente, inativa); `common.knowledge.trivia_streak` (inativa) | `action: trivia` (+ `count.streak unit day`) |
| `community` | enquete e convite | `community.poll` (existente, inativa); `common.community.invite` (inativa) | `action: poll`; convite não cabe na linguagem |
| `consumption` | conteúdo | `consumption.recap` (existente, inativa); `common.consumption.lineup` (inativa) | `action: consumption` (sem subtipo na linguagem) |
| `collector` | completar Coleções | `common.collector.collections`, `.sports` (inativas) | não cabe na linguagem |

Categorias e bônus seguem a [padronização](../padronizacao.md): participação e consumo 0; acerto 20/40/80/150/300; momento repetível 10/20/40/75/150; momento único pela raridade da Carta (especial 25, rara 60).

`seasonal`: `true` nas de contagem ligadas a jogos (Palpites, assistidos, momentos, ritmo); `false` nas de explorador (o conjunto de coisas diferentes é vitalício por natureza), em `common.predictions.competitions` (mesma lógica de conjunto) e nas de trivia, enquete, consumo, convite e colecionador, como já são as existentes.

## 2. Quanto um torcedor assiste e palpita (base de calibragem)

Não há métrica própria ainda (o módulo está nascendo), então a referência é o calendário e a estimativa de produto:

- **Jogos do time por temporada:** um clube brasileiro grande joga 55 a 75 jogos oficiais por ano (estadual 12 a 16, série A 38, copa 2 a 10, continental 6 a 13); um clube europeu de liga de 38 rodadas, 45 a 60; uma equipe de NBA ou NHL, 82 na temporada regular mais até 28 de playoff; MLB, 162; NFL, 17 mais playoff ([calendario.md](../calendario.md)).
- **Torcedor assíduo:** assiste inteiro (2/3 do jogo, pela presença verificada) 30 a 50 jogos do time por temporada; a maioria dos torcedores fica entre 10 e 25. É a definição de "Platina = uma temporada" usada em todas as comuns: 38 a 40 jogos.
- **Competições acompanhadas:** o torcedor médio segue 3 a 5 (a liga, a copa, a continental e a seleção do seu time, às vezes uma liga estrangeira). A plataforma cobre cerca de 400 competições em 12 esportes (145 só de futebol), de cerca de 30 países mais as continentais e mundiais.
- **Palpites:** 3 a 6 por jogo do time (vencedor, placar exato, uma ou duas quantidades), em 40 a 60 jogos: 150 a 300 Palpites por temporada para o assíduo. É a base dos Degraus de `predictions.placed` (5/15/40/100/250) e dos acertos (3/10/30/75/200).
- **Taxa de acerto por tipo (estimativa a partir da distribuição de resultados):**
  - *Vencedor:* no futebol europeu o mandante vence 45 a 50%, empata 16 a 25% e o visitante vence 30 a 34% (Champions League e Europa League 2024-25 e 2025-26: 47,6 a 49,8% mandante, 16,1 a 20,5% empate, 29,7 a 34,1% visitante, [futbol24](https://www.futbol24.com/international/UEFA/Europa-League/2025-2026/statistics); estudo de 10.785 jogos das cinco grandes ligas: 47,6% mandante e 33,7% visitante em 2018-19, [AWF Poznań](https://tss.awf.poznan.pl/SuppFile/204043/11612/4e5c2e0d4b5d810b0b67a6558a3501ce/)). Quem segue o favorito acerta 45 a 55% dos Palpites de vencedor; nos esportes sem empate, 55 a 65%.
  - *Placar exato:* o placar mais comum do futebol (1 x 1 ou 1 x 0) aparece em 10 a 12% dos jogos; o palpiteiro acerta o exato em 8 a 12% das vezes. Nos esportes de muitos pontos o exato é bem mais raro, por isso o pacote de cada esporte recalibra.
  - *Quantidade ("pelo menos N"):* com média de 2,6 a 2,8 gols por jogo nas ligas principais, "pelo menos 2" sai em ~75% dos jogos e "pelo menos 4" em ~20%; na prática o palpiteiro acerta 50 a 60%. O **Acerto em cheio** de quantidade (total igual ao N pedido, `fullHit`) sai em ~25% dos Palpites de quantidade; somado ao placar exato dá 40 a 60 Acertos em cheio por temporada para o assíduo, daí `common.predictions.full_hit` = 2/5/15/40/100.

## 3. Sequências (streak): escala de dificuldade, não de contagem

- **Acertos seguidos** (`common.predictions.streak`, `unit: prediction`): com 50 a 55% de acerto por Palpite, a maior sequência esperada em 200 Palpites por temporada é 8 a 9 (log(200)/log(1/0,55) ≈ 8,9). Sequência de 10 tem ~0,25% de chance por tentativa e sai para o assíduo mais ou menos uma vez por temporada (Platina); 15 tem ~0,013% por tentativa, cerca de 1% por temporada para o assíduo e bem menos para o resto (Lendário, < 1% dos ativos). Degraus 2/4/7/10/15: a regra de 2,5 a 3x não vale para sequência, porque a dificuldade cresce de forma exponencial com o tamanho; o validador avisa e o aviso fica.
- **Rodadas seguidas palpitando** (`common.predictions.round_streak`, `unit: round`, só `competition_type: league`): 3/8/19/38/100. Platina 38 = uma liga inteira de 38 rodadas sem pular nenhuma; 19 = metade; 100 atravessa duas temporadas e meia. Em ligas de 17 (NFL) ou 34 rodadas, o Platina só sai na temporada seguinte; a sequência é por competição e continua da última rodada de uma temporada para a primeira da seguinte (decisão abaixo).
- **Jogos seguidos do time** (`common.loyalty.favorite_streak`, `unit: game`, `favorite_playing`): 2/5/12/30/70. 30 seguidos = meia temporada cheia sem perder um jogo inteiro; 70 passa de uma temporada e deve ficar abaixo de 1%.
- **Dias seguidos** (`common.loyalty.day_streak`, `unit: day`): 2/5/12/30/75. Um torneio de seleções tem jogo todo dia por 25 a 30 dias (30 = o torneio inteiro); fora disso, só com vários esportes (basquete e beisebol jogam quase todo dia). 75 fica abaixo de 1%.
- **Dias seguidos com trivia certa** (`common.knowledge.trivia_streak`, `unit: day`): 3/7/15/30/75, inativa; a linguagem não tem unidade de sequência "por resposta", então a sequência é por dia.

## 4. Explorador (distinct)

- **Esportes** (`common.explorer.sports`): 12 esportes é teto absoluto; o médio acompanha 1 a 2, o multiesporte 3 a 5. Escada 2/3/5/8/12: não dá para crescer 2,5x com teto 12; o validador avisa e o aviso fica. Mesma escada em `common.collector.sports`.
- **Competições** (`common.explorer.competitions`, assistidas; `common.predictions.competitions`, palpitadas): 2/5/12/30/75 e 2/5/12/25/60. Platina = o que um torcedor curioso cobre numa temporada (12 competições assistidas; 25 palpitadas é mais fácil porque palpitar custa um toque); Lendário leva anos e menos de 1%.
- **Países** (`common.explorer.countries`, `event.competition.country`): cerca de 30 países cobertos mais continentais e mundiais. 2/4/8/15/30; o 15 → 30 é 2x (um aviso de 1,875x no 8 → 15, aceito para o Lendário cair no teto real).

## 5. Ritmo (hora local pelo fuso do programa)

A hora local sai de `event.starts_at` convertido pelo `program.time_zone` (o fuso do país do torcedor no cliente; não existe `fan.time_zone`). Para país com vários fusos é aproximação declarada na [linguagem](../regras/linguagem.md).

- **Madrugador** (00:00 a 06:00): para Brasil e América hispânica, corridas e ligas da Ásia e da Oceania, torneios sediados lá (Olimpíadas e mundiais na Ásia) e o futebol australiano: 10 a 30 oportunidades por ano. Para a Europa, os jogos noturnos das Américas (dezenas por semana). 1/3/8/20/50.
- **Coruja** (23:00 a 03:00): no Brasil, basquete, hóquei e beisebol norte-americanos começam entre 22h30 e 0h30 quase toda noite; na Europa, os jogos noturnos sul-americanos. 1/4/12/30/80 (mais comum que a madrugada).
- **Fim de semana** (`weekday: sat, sun`): a maioria das rodadas de liga cai no fim de semana; 50 fins de semana por ano, 1 a 2 jogos assistidos em cada: 40 a 60 por temporada. 1/5/15/40/100.

## 6. "Eu estava lá": momentos comuns (`game.result`, `game.comeback`)

Todos com `team: favorite`, `presence: game` (presença ≥ 2/3) e `where.sport` com os 10 esportes de time (o fato não vale para F1 e MMA, que não têm time do coração).

| Conquista | Frequência real | Fonte | Para o time do torcedor assíduo | Decisão |
| --- | --- | --- | --- | --- |
| `favorite_win` (vitória assistida) | futebol: 75% dos jogos têm vencedor, o time médio vence 37%; esportes sem empate: 50% | §2 | 12 a 25 vitórias vistas por temporada | repetível 1/3/8/20/50 (bônus 10/20/40/75/150) |
| `favorite_comeback` (virada saindo de 2 atrás) | 1 a 4% dos jogos: na Premier League, 62 viradas de 2 gols atrás em 31 temporadas, ~2 por ano ([Premier League](https://premierleague.com/news/3533924)); 4% dos jogos das cinco grandes ligas têm quem abriu 2 gols perdendo ([The Analyst](https://theanalyst.com/articles/why-are-two-goal-leads-still-feared-an-investigation)); 2 gols atrás no intervalo vira vitória em ~1% ([Swiss Football Data](https://swissfootballdata.com/2023/02/22/2-0-is-a-dangerous-lead-data-says-no/)) | | menos de 1 por temporada | única, **rara** (60), só `football` e `hockey`, onde "2" é unidade que pesa; nos esportes de pontos e no beisebol 2 atrás ao fim de um período é corriqueiro e fica para o pacote do esporte com margem própria |
| `derby_win` (vitória em clássico) | o time joga 2 a 10 clássicos por temporada (6 a 10 no Brasil, com estadual; 2 a 4 na Europa e nas ligas das Américas) e vence 35 a 45% | §2 e `event.derby_id` | 1 a 4 por temporada (< 5) | única, **especial** (25): acontece em parte dos jogos do time |
| `final_win` (vitória em jogo de final) | cada competição tem uma final e um vencedor; a maioria dos times não vence nenhuma em anos, os grandes 1 a 2 por ano | calendário | 0 a 2 por temporada | única, **rara** (60). Nas séries finais (basquete, hóquei, beisebol) cada jogo com `stage.kind = final` conta como "vitória em final"; o vencedor da série não está no contrato |
| `overtime_win` (vitória além do tempo) | hóquei: 25 a 27% dos jogos passam do tempo normal ([ESPN, 2025-26](https://africa.espn.com/nhl/story/_/id/47210375/nhl-2025-26-games-shootout-theories-trends-stats-standings), [Deconstruction](https://deconstruction.netlify.app/post/what-percentage-of-nhl-games-go-to-overtime)); beisebol: 8 a 10% em extra innings ([CBS](https://www.cbssports.com/mlb/news/mlb-makes-extra-innings-ghost-runner-rule-permanent-for-regular-season-games-per-report), [Wikipedia](https://Www.Wikipedia.org/wiki/Extra_inning)); basquete: 5 a 6% ([Rotogrinders](https://rotogrinders.com/articles/banking-on-overtime-1710010)); futebol americano: 5,5 a 6,5% ([The Ringer](https://www.theringer.com/2017/02/02/nfl/its-time-for-an-overtime-super-bowl-56f3ffad39e5)); futebol: só mata-mata, 1 a 2% dos jogos de um clube | | hóquei 8 a 12 vitórias; beisebol 6 a 8; basquete 2 a 3; futebol 0 a 2 | repetível 1/2/5/10/25: Platina = temporada do torcedor de hóquei ou beisebol, que são quem vive a prorrogação; o torcedor de futebol leva anos e tem o pacote do esporte |

A regra "momento repetível com menos de 5 por temporada vira única" ([padronização §3](../padronizacao.md)) decidiu `favorite_comeback`, `derby_win` e `final_win`.

## 7. Conhecedor, Comunidade e Consumo (sem sinal hoje)

Nenhum dos sinais existe no motor (`fan.participation` só emite `watched`): trivia, enquete e consumo seguem inativos como no código, e as novas também nascem inativas. A frequência é estimativa de produto: uma trivia e 1 a 3 enquetes por jogo acompanhado (40 a 150 por temporada); um resumo e uma escalação por jogo do time (40 a 70); 0 a 3 amigos convidados que chegam a usar. Os Degraus das novas espelham os das existentes (trivia 3/10/30/75/200; resumo e escalação 10/25/50/100/250; convite 1/3/8/20/50).

`common.community.invite` conta só convite que vira Perfil ativo (nunca envio de link), e nada de recompensa em Pontos: bônus 0. Não há entrada na linguagem para convite nem para "Coleção completada"; a regra gravada nessas Conquistas é um lugar reservado (`participation` com `poll` ou `consumption`), explicitado no `inactive_reason`, e `proposed.*` impede importar ativa.

## 8. Colecionador

Completar a Coleção hoje destrava o cosmético direto (regra da [padronização §7](../padronizacao.md)); não existe fato "Coleção completada" na linguagem. As duas Conquistas (`collections` 1/3/8/20/50 e `sports` 2/3/5/8/12) ficam inativas com `proposed.collection.completed` e viram candidatas da próxima rodada da linguagem, se o dono quiser que a Coleção também conte como Conquista.

## 9. Tabela de Degraus

| Conquista | Categoria | Degraus | Platina = | Lendário = |
| --- | --- | --- | --- | --- |
| `predictions.correct` | hit | 3/10/30/75/200 | temporada de 150 Palpites com ~50% de acerto | 2,5 temporadas |
| `predictions.exact_score` | hit | 1/3/10/25/60 | temporada com 10% de exato em 250 Palpites | 2,5 temporadas |
| `predictions.winner` | hit | 3/10/30/75/200 | idem `correct` | idem |
| `predictions.quantity` | hit | 3/10/30/75/200 | idem | idem |
| `predictions.placed` | participation | 5/15/40/100/250 | 100 Palpites numa temporada | 2,5 temporadas |
| `common.predictions.full_hit` | hit | 2/5/15/40/100 | 40 Acertos em cheio por temporada | 2,5 temporadas |
| `common.predictions.streak` | hit | 2/4/7/10/15 | a melhor sequência de uma temporada | ~1% por temporada (§3) |
| `common.predictions.round_streak` | participation | 3/8/19/38/100 | uma liga inteira | 2,6 temporadas |
| `common.predictions.competitions` | participation | 2/5/12/25/60 | 25 competições numa temporada curiosa | anos |
| `loyalty.watched` | participation | 1/5/15/38/100 | 38 jogos inteiros | 2,6 temporadas |
| `common.loyalty.favorite_watched` | participation | 1/4/12/40/100 | 40 jogos do time | 2,5 temporadas |
| `common.loyalty.favorite_streak` | participation | 2/5/12/30/70 | meia temporada sem perder um | mais de uma temporada |
| `common.loyalty.derby` | participation | 1/3/8/20/50 | 2 a 3 temporadas de clássicos (de todos os times) | 5+ temporadas de um time, ou 2 de vários |
| `common.loyalty.finals` | participation | 1/3/8/20/50 | 2 a 3 anos de finais | 6+ anos, ou multiesporte |
| `common.loyalty.day_streak` | participation | 2/5/12/30/75 | um torneio inteiro, todo dia | 2,5 meses seguidos |
| `common.explorer.sports` | participation | 2/3/5/8/12 | multiesporte de verdade | todos os 12 (teto) |
| `common.explorer.competitions` | participation | 2/5/12/30/75 | 12 competições numa temporada (Ouro); 30 em 2 a 3 | anos |
| `common.explorer.countries` | participation | 2/4/8/15/30 | 15 países | o teto real |
| `common.rhythm.early_bird` | participation | 1/3/8/20/50 | um ano de madrugadas (Brasil) | 2,5 anos |
| `common.rhythm.night_owl` | participation | 1/4/12/30/80 | uma temporada de liga norte-americana vista do Brasil | 2,5 temporadas |
| `common.rhythm.weekend` | participation | 1/5/15/40/100 | 40 fins de semana | 2,5 temporadas |
| `common.moments.favorite_win` | moment | 1/3/8/20/50 | 20 vitórias vistas | 2,5 temporadas |
| `common.moments.favorite_comeback` | moment único | 1 | — | — |
| `common.moments.derby_win` | moment único | 1 | — | — |
| `common.moments.final_win` | moment único | 1 | — | — |
| `common.moments.overtime_win` | moment | 1/2/5/10/25 | temporada do torcedor de hóquei/beisebol | 2,5 temporadas |
| `knowledge.trivia` | participation | 3/10/30/75/200 | 75 trivias certas | 2,5 temporadas |
| `common.knowledge.trivia_streak` | participation | 3/7/15/30/75 | um mês seguido | 2,5 meses |
| `community.poll` | participation | 3/10/30/75/200 | 75 votos | 2,5 temporadas |
| `common.community.invite` | participation | 1/3/8/20/50 | comunidade organizada | < 1% |
| `consumption.recap` | consumption | 10/25/50/100/250 | 100 resumos | 2,5 temporadas |
| `common.consumption.lineup` | consumption | 10/25/50/100/250 | 100 escalações | 2,5 temporadas |
| `common.collector.collections` | participation | 1/3/8/20/50 | 20 Coleções | 50 |
| `common.collector.sports` | participation | 2/3/5/8/12 | 8 esportes | todos (teto) |

Raridade das Cartas pela regra mecânica (Bronze comum, Prata e Ouro especial, Platina rara, Lendário histórica em participação e consumo, lendária em acerto e momento). Total: 158 Cartas (31 comuns, 63 especiais, 33 raras, 23 históricas, 8 lendárias).

## 10. Decisões tomadas

1. **34 Conquistas, não 25.** A lista de famílias do brief enumera 25 novas; entreguei todas e deixo o corte para o dono (candidatas a sair, se quiser 25: `common.explorer.countries`, `common.loyalty.finals`, `common.rhythm.weekend`, `common.knowledge.trivia_streak` e uma das duas de colecionador).
2. **`loyalty.watched` entra ativa.** O código ainda tem `active: false` ("falta a regra de tempo mínimo de presença"), mas o anexo A da missão a lista ativa e o contrato diz que `watched` já emite sinal com a regra de 2/3. Conferir antes do seed.
3. **Sequências e dimensões com teto não seguem 2,5x** (`predictions.streak`, `explorer.sports`, `collector.sports`, um Degrau de `explorer.countries`): 12 avisos do validador, todos explicados em §3 e §4.
4. **`favorite_comeback` só em futebol e hóquei.** "2 atrás" só é fato raro onde 2 é gol; nos esportes de pontos e no beisebol fica para o pacote do esporte com `score.comeback` e margem própria.
5. **Três momentos únicos** (`favorite_comeback` rara, `derby_win` especial, `final_win` rara) pela regra "menos de 5 por temporada vira única"; `overtime_win` repetível calibrado pelo torcedor de hóquei e beisebol.
6. **`seasonal: false` nas de conjunto** (`distinct`): explorador e `common.predictions.competitions`.
7. **`round_streak` só em liga** (`competition_type: league`), por competição, sem zerar na virada de temporada.
8. **Dia de clássico e dia de final contam jogo de qualquer time**, não só do time do coração (as versões "do seu time" estão nos momentos).
9. **Regras reservadas nas inativas sem entrada na linguagem** (convite, colecionador), com o motivo no `inactive_reason` e `proposed.*` impedindo ativação.
10. **Oito Coleções transversais**, uma por família (Conhecedor, Comunidade e Consumo juntas em "Por dentro"): três destravam moldura, duas plano de fundo, três título. Os cosméticos referenciados (`frame.collector`, `frame.i_was_there`, `frame.sharp_eye`, `background.common.explorer`, `background.common.loyalty`, `title.insider`, `title.always_in`, `title.all_hours`) precisam existir em `cosmeticos/*.json`.

## 11. Perguntas para o dono

1. `loyalty.watched`: ativar no seed (anexo A) ou manter inativa como no código até a regra de presença entrar?
2. `seasonal` nas comuns: qual é a temporada de uma Conquista multiesporte (ano civil? a temporada do esporte do jogo?). O motor já tem `predictions.correct` sazonal com `sport: null`; a mesma convenção serve.
3. `common.moments.derby_win` e `final_win` como únicas (regra dos < 5) ou com 5 Degraus (1/3/8/20/50) para o torcedor de clube grande? Nas séries finais, "vitória em final" conta cada jogo; aceitar ou esperar `event.series_winner`?
4. `common.predictions.streak` 2/4/7/10/15 (dificuldade) é aceitável como exceção documentada ao 2,5x?
5. `common.community.invite`: entra no produto (crescimento viral) ou sai do Catálogo? Se entra, o convite aceito precisa de sinal próprio e de regra anti-abuso (só Perfil que chega a assistir um jogo).
6. Colecionador: completar Coleção deve virar também Conquista (duas inativas aqui) ou fica só o cosmético direto?
7. `round_streak`: a sequência continua da última rodada de uma temporada para a primeira da seguinte (como está) ou zera na virada?
8. Cortar para ~25? Ver candidatas na decisão 1.

## 12. O que não coube na linguagem ou no contrato

- **Convite de amigo:** sem `action` nem fato; `proposed.fan.invite`.
- **Coleção completada:** sem entrada; `proposed.collection.completed`.
- **Sequência por resposta de trivia:** `count.streak` só tem `round`, `game`, `day`, `prediction`; usei `day`.
- **Subtipo de consumo:** `action: consumption` não distingue resumo de escalação; `proposed.fan.participation.consumption.recap|lineup`.
- **Vencedor da série** nos playoffs de basquete, hóquei e beisebol: não está no contrato; "final vencida" conta por jogo.
- **Fuso individual do torcedor** (`proposed.fan.time_zone`): Madrugador e Coruja usam o fuso do programa.
- Nada da padronização ou do validador precisou mudar; o validador passou a conferir `cartas/colecoes.json` (8 Coleções), o que não está descrito no cabeçalho dele.
