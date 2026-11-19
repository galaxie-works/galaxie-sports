# Linguagem de regras das Conquistas

Extensão mínima e declarativa da regra que o motor (`packages/game-rules`, `achievements.ts`) lê hoje. O que já existe continua igual; o resto é proposta, e cada operador novo diz o que o motor precisa guardar a mais. O JSON Schema está em [regra.schema.json](regra.schema.json) e é o que o [validador](../_validar.mjs) aplica.

## 1. O que o motor entende hoje

```json
{ "input": "prediction", "kind": "exact_score|winner|quantity", "correct": true, "fullHit": true }
{ "input": "participation", "action": "watched|poll|trivia|consumption" }
```

Cada entrada aceita soma 1 no progresso da Conquista (vitalício e, se `seasonal`, da temporada), e o Degrau sai quando a contagem chega ao limite.

## 2. A extensão: três partes em toda regra

```json
{
  "input": "prediction | participation | moment",
  "...": "campos da entrada",
  "where": { "...filtros, opcionais" },
  "count": { "mode": "each | distinct | streak", "...": "opcional; padrão each" }
}
```

- **`input`** diz qual fato dispara a regra (seção 3).
- **`where`** restringe a que jogos e a que situações a regra se aplica (seção 4). Vale para as três entradas.
- **`count`** diz como o progresso cresce (seção 5). Sem `count`, é `each`: soma 1 por entrada.

A regra conta **só o definitivo**: o Palpite quando fecha, o momento quando o jogo termina (depois da janela de correção), a participação quando entra. Nada provisório vira Degrau.

## 3. Entradas

### 3.1 `prediction` (existe)

| Campo | Tipo | Significado |
| --- | --- | --- |
| `kind` | `exact_score`, `winner`, `quantity` | tipo do Palpite; ausente = qualquer |
| `correct` | bool | só os certos (`true`) ou só os errados |
| `fullHit` | bool | só Acerto em cheio |

Dados: `fan.prediction`.

### 3.2 `participation` (existe)

| Campo | Tipo | Significado |
| --- | --- | --- |
| `action` | `watched`, `poll`, `trivia`, `consumption` | o sinal real |

Dados: `fan.participation` (hoje só `watched` emite sinal; `fan.presence` por trás).

### 3.3 `moment` (novo)

Um fato do jogo, detectável pelos dados do [contrato](contrato-dados.md), que conta para o torcedor **se ele tinha presença verificada**.

```json
{ "input": "moment", "fact": "football.goal", "params": { "team": "favorite", "in_extra": true },
  "presence": "at_moment" }
```

| Campo | Tipo | Significado |
| --- | --- | --- |
| `fact` | id da tabela abaixo | o fato |
| `params` | objeto | os parâmetros daquele fato (tabela abaixo); todos opcionais |
| `presence` | `at_moment`, `game` | `at_moment`: existe janela de `fan.presence` cobrindo o instante do lance (fatos com minuto); `game`: presença em pelo menos 2/3 do jogo (fatos sem minuto, ou de fim de jogo). Padrão: `game` |

O instante do lance sai do `minute`/`extra` do lance e do `core.event_state_log` (o `live` real e as trocas de período). Fatos de resultado (`*.result`, `score.comeback`, `race.result`, `fight.result`) são sempre de fim de jogo: `presence` é `game`.

O parâmetro **`team`** aparece em quase todo fato e significa:

| Valor | Significado |
| --- | --- |
| `any` | qualquer um dos participantes (padrão) |
| `favorite` | o time do coração do torcedor (`fan.favorite_team_id` igual a um `event.participants[].participant_id`); se o time dele não joga, a regra não conta |
| `opponent` | o adversário do time do coração, no jogo em que o time dele joga |

#### Fatos

| `fact` | Esportes | Parâmetros | Semântica | Dados (`requires_data`) |
| --- | --- | --- | --- | --- |
| `football.goal` | football | `team`; `in_extra` (bool: `minute >= 90 and extra > 0`, ou `minute >= 45 and extra > 0` no 1º tempo); `min_minute`, `max_minute` (int); `period` (`1H`, `2H`, `ET`); `detail` (`normal`, `own_goal`, `penalty`); `decisive` (bool: o gol mudou o resultado final em relação ao placar antes dele: de derrota para empate, de empate para vitória); `equalizer` (bool: empatou); `winner` (bool: colocou o time na frente e assim terminou) | um gol válido (gol anulado pelo VAR não conta) que atende a todos os parâmetros | `event.incidents.type=goal`, `event.incidents.minute`, `event.incidents.extra`, `event.incidents.detail`, `event.incidents.participant_id`, `event.score` |
| `football.hat_trick` | football | `team`; `min_goals` (int, padrão 3) | um jogador marcou `min_goals` gols válidos (`own_goal` não conta) no mesmo jogo | `event.incidents.type=goal`, `event.incidents.person_id`, `event.incidents.detail` |
| `football.penalty_missed` | football | `team` (quem perdeu) | lance `penalty_missed` | `event.incidents.type=penalty_missed` |
| `football.red_card` | football | `team` (quem recebeu) | lance `card` com `detail` `Red Card` ou `Second Yellow card` | `event.incidents.type=card`, `event.incidents.detail` |
| `football.var_goal_disallowed` | football | `team` (de quem era o gol) | lance `var` com `detail` que anula gol (`Goal cancelled`, `Goal Disallowed - *`), incluindo o inferido | `event.incidents.type=var`, `event.incidents.detail` |
| `football.comeback` | football | `team`; `from_behind_by` (int, padrão 2) | reconstruindo o placar pela sequência dos gols, o time esteve `from_behind_by` gols atrás e terminou vencendo (prorrogação inclusa, pênaltis não) | `event.incidents.type=goal`, `event.incidents.sequence`, `event.score` |
| `game.result` | todos os esportes de time (football e os de `score.result`) | `team`; `side` (`home`, `away`); `outcome`; `overtime` (bool: prorrogação, pênaltis ou shootout; no futebol `AET`/`PEN`); `margin_min`, `margin_max` (int); `shutout` (bool: adversário 0; no futebol, sem sofrer gol); `total_min` (int) | resultado final, com a mesma semântica em todo esporte de time: é o fato das Conquistas **comuns** de fim de jogo | `event.status=finished`, `event.status_detail`, `event.score` |
| `game.comeback` | todos os esportes de time | `team`; `trailing_by_min` (int, em gols ou pontos do esporte) | o time esteve atrás por `trailing_by_min` (no futebol pela sequência dos gols; nos outros, ao fim de algum período) e venceu | `event.incidents` (futebol) ou `event.score.periods`, `event.score` |
| `football.result` | football | `team`; `side` (`home`, `away`: o time de `team` jogou nesse lado); `outcome` (`win`, `draw`, `loss`); `extra_time` (bool, `status_detail = AET` ou `PEN`); `penalties` (bool, `PEN`); `clean_sheet` (bool, o adversário não marcou); `margin_min` (int); `total_min` (int, gols somados); `scoreless` (bool, 0 x 0) | resultado final do jogo | `event.status=finished`, `event.status_detail`, `event.score` |
| `score.result` | todos com placar por período (basketball, nba, american-football, baseball, hockey, volleyball, handball, rugby, afl) | `team`; `side` (`home`, `away`); `outcome`; `overtime` (bool: existe `ot`, `ot2`, `so` ou `extra` com valor); `shootout` (bool: `so`); `margin_min`, `margin_max` (int, diferença final; `margin_max` 3 = jogo decidido por até 3); `total_min` (int); `shutout` (bool: adversário 0); `sets` (`3-0`, `3-1`, `3-2`, só vôlei: sets vencidos); `period_sweep` (bool: venceu todos os períodos regulares) | resultado final | `event.status=finished`, `event.score`, `event.score.periods` |
| `score.comeback` | os mesmos de `score.result` | `team`; `trailing_by_min` (int, pontos ou gols); `at` (`any`, `last_regular`: estava atrás ao fim do último período regular) | o placar acumulado ao fim de algum período tinha o time atrás por `trailing_by_min` e ele venceu | `event.score.periods`, `event.score` |
| `score.period` | os mesmos de `score.result` | `team`; `period` (`q4`, `p3`, `h2`, `i9`, `s5`, `last` = último período regular, `any`); `points_min` (int, do time no período); `margin_min` (int, vantagem no período); `shutout` (bool: adversário 0 no período) | um período atende aos parâmetros | `event.score.periods` |
| `baseball.no_hitter` | baseball | `team` (a defesa que não cedeu rebatida) | `breakdown.<adversário>.hits = 0` com jogo `finished` | `event.score.breakdown.hits`, `event.status=finished` |
| `race.result` | formula-1 | `position_max` (int: alguém terminou até essa posição… use `places_gained_min` para "veio de trás"); `places_gained_min` (int: `grid - position`); `pole_to_win` (bool: `grid = 1` e `position = 1`); `winner_from_grid_min` (int: o vencedor largou dessa posição ou pior); `finishers_min` (int: pilotos classificados); `pits_max` (int: o vencedor parou no máximo tantas vezes) | o resultado da corrida atende aos parâmetros | `race.detail.results.position`, `race.detail.results.grid`, `race.detail.results.pits`, `race.detail.startinggrid.grid` |
| `fight.result` | mma | `won_type` (`ko_tko`, `submission`, `decision`); `round_max` (int); `minute_max` (`m:ss`: até esse tempo do round) | o fim da luta atende aos parâmetros | `fight.detail.result.won_type`, `fight.detail.result.round`, `fight.detail.result.minute` |

`game.result` e `game.comeback` existem para as Conquistas comuns (uma regra, vários esportes, com `where.sport` quando quiser limitar). Nos pacotes de esporte, prefira o fato do esporte, que tem mais parâmetros.

`race.result` e `fight.result` não têm `team`: não há time do coração em F1 e MMA no Perfil de hoje. Conquista "do seu piloto" ou "do seu lutador" fica `active: false` com `proposed.fan.favorite_person_id`.

## 4. Filtros: `where`

Todos opcionais; combinam por **e**.

| Chave | Tipo | Significado | Dados |
| --- | --- | --- | --- |
| `sport` | lista de slugs | o jogo é de um desses esportes (redundante na Conquista de esporte, útil nas comuns) | `event.sport` |
| `competition_type` | lista de `league`, `cup`, `tournament` | | `event.competition.type` |
| `stage` | lista de `core.stage.kind` (`regular`, `group`, `round_of_16`, `quarter_final`, `semi_final`, `final`, `race_weekend`…) ou o apelido `knockout` (= `knockout_round`, `round_of_128`, `round_of_64`, `round_of_32`, `round_of_16`, `quarter_final`, `semi_final`, `final`) | a fase do jogo | `event.stage.kind` |
| `derby` | `true` | clássico detectado | `event.derby_id` |
| `favorite_playing` | `true` | o time do coração do torcedor está no jogo | `fan.favorite_team_id`, `event.participants` |
| `local_hour` | `{ "from": "HH:MM", "to": "HH:MM" }` | hora local de `event.starts_at` no fuso do programa (`program.time_zone`, o fuso do país do torcedor no cliente); a janela pode cruzar a meia-noite (`from` 23:00, `to` 05:00) | `event.starts_at`, `program.time_zone` |
| `weekday` | lista de `mon`…`sun` | dia da semana local do jogo | `event.starts_at`, `program.time_zone` |

Não existe `fan.time_zone` no Perfil (o [contrato](contrato-dados.md) corrige isso): a hora local vem do fuso do programa, que é o do país. Para o torcedor de um país com vários fusos, isso é uma aproximação declarada.

## 5. Contagem: `count`

| `mode` | Campos | Semântica | O que o motor precisa guardar a mais |
| --- | --- | --- | --- |
| `each` | — | soma 1 por entrada que casa (padrão; é o que existe) | nada |
| `distinct` | `key`: `competition`, `country`, `sport`, `team`, `stage`, `season`, `month`, `weekday` | o progresso é o número de valores diferentes de `key` entre as entradas que casaram ("palpite em 5 competições diferentes") | o conjunto de chaves já vistas por Perfil e Conquista (tabela nova `game.achievement_progress_key`, uma linha por chave; o `count` do progresso vira o tamanho do conjunto) |
| `streak` | `unit`: `round` (rodadas seguidas de uma competição), `game` (jogos seguidos do time do coração), `day` (dias seguidos), `prediction` (Palpites seguidos certos, na ordem de fechamento) | o progresso é o tamanho da sequência atual; falhar a unidade zera a sequência; os Degraus são tamanhos de sequência | a sequência atual e a última unidade contada (`streak_len`, `streak_last`) no progresso; o Degrau concedido não se perde quando a sequência zera |

`key` de `distinct` usa: `competition` = `event.competition.id`; `country` = país da competição; `sport` = `event.sport`; `team` = o participante do jogo (os dois); `stage` = `event.stage.kind`; `season` = temporada do jogo; `month` = `AAAA-MM` local; `weekday` = dia local.

`unit` de `streak`: `round` só faz sentido em `competition_type` `league` (a rodada vem de `event.stage` com o número); `game` só com `favorite_playing`; `prediction` ignora jogos sem Palpite.

## 6. Exemplos

1. **Gol nos acréscimos do seu time, estando lá** (momento, repetível):

   ```json
   { "input": "moment", "fact": "football.goal", "params": { "team": "favorite", "in_extra": true, "period": "2H" },
     "presence": "at_moment" }
   ```

2. **Virada no último quarto, qualquer time, assistiu o jogo** (basquete):

   ```json
   { "input": "moment", "fact": "score.comeback", "params": { "team": "any", "trailing_by_min": 10, "at": "last_regular" },
     "presence": "game" }
   ```

3. **Placar exato num clássico** (acerto com filtro):

   ```json
   { "input": "prediction", "kind": "exact_score", "correct": true, "where": { "derby": true } }
   ```

4. **Explorador: Palpite em competições diferentes** (distinct):

   ```json
   { "input": "prediction", "count": { "mode": "distinct", "key": "competition" } }
   ```

5. **Na madrugada (antes "Madrugador"): assistiu jogo que começou entre 0h e 6h** (janela local):

   ```json
   { "input": "participation", "action": "watched", "where": { "local_hour": { "from": "00:00", "to": "06:00" } } }
   ```

6. **Rodadas seguidas palpitando** (streak):

   ```json
   { "input": "prediction", "where": { "competition_type": ["league"] }, "count": { "mode": "streak", "unit": "round" } }
   ```

7. **Nocaute no 1º round, assistiu a luta**:

   ```json
   { "input": "moment", "fact": "fight.result", "params": { "won_type": "ko_tko", "round_max": 1 }, "presence": "game" }
   ```

8. **Vitória saindo do fundo do grid**:

   ```json
   { "input": "moment", "fact": "race.result", "params": { "winner_from_grid_min": 10 }, "presence": "game" }
   ```

## 7. O que o motor precisa para rodar tudo isso

| Peça | Hoje | Para a linguagem inteira |
| --- | --- | --- |
| Entrada `moment` | não existe | o worker avalia os fatos no fim do jogo (depois da janela de correção) contra os Perfis com presença no jogo, e manda uma entrada por fato e Perfil |
| `where` | não existe | resolvido na montagem da entrada (o worker já tem o jogo, a fase, o clássico, o fuso do programa e o Perfil) |
| `count.distinct` | não existe | tabela de chaves vistas |
| `count.streak` | não existe | dois campos no progresso |
| Presença no instante | `fan.presence_window` existe; o instante do lance ainda não é calculado | função `minuteToInstant(event, minute, extra)` a partir do `event_state_log` |

Nada disso muda o que já foi concedido: a regra é versionada, e o Degrau e a Carta guardam a versão da época.
