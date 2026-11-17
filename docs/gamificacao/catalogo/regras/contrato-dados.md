# Contrato de dados para as regras de Conquista

Os caminhos exatos do que o motor pode ler hoje. **Só estes nomes valem em `requires_data`.** O que não está aqui não existe para o motor: a Conquista que precisar disso entra `active: false`, com o dado que falta no `inactive_reason`, e o caminho com o prefixo `proposed.`.

Conferido contra o código da `main` em 16/11/2026 (`packages/db/src/schema/core.ts`, `fan.ts`, `game.ts`; `packages/providers/src/api-sports/**/normalize.ts`; `apps/api/src/events/builder.ts`). As duas correções em relação à versão enviada ao Codex estão marcadas com **(correção)**.

> Para basquete, NBA, futebol americano, beisebol, hóquei, vôlei, handebol, rugby e AFL, o que chega ao motor é **só o placar por período** e o status do jogo. Estatística de jogador por partida desses esportes (pontos, rebotes, assistências, jardas, touchdowns, interceptações) **não** chega hoje. Triple-double, 50 pontos de um jogador, pick-six e similares entram `active: false` com `"falta estatística de jogador por partida"` e `proposed.player_game_stats.*`. Só o futebol tem lance a lance e estatística de jogador.

## 1. O jogo (todos os esportes): `event`

| Caminho | Tipo | Observação |
| --- | --- | --- |
| `event.id` | uuid | |
| `event.sport` | texto | `football`, `basketball`, `nba`, `american-football`, `baseball`, `hockey`, `volleyball`, `handball`, `rugby`, `afl`, `formula-1`, `mma` |
| `event.competition.id`, `event.competition.type` | uuid, texto | `type`: `league`, `cup`, `tournament` |
| `event.competition.country` | texto | país da competição (`core.competition.country_code`, ISO 2; nulo em continental e mundial), para `count.distinct` por país |
| `event.stage.kind` | texto | fase canônica (`core.stage.kind`): `regular`, `group`, `round_of_16`, `quarter_final`, `semi_final`, `final`, `race_weekend`… **(correção: era `event.stage.name`, que é o nome traduzido; a regra usa o `kind`)** |
| `event.stage.round` | int ou null | número da rodada, tirado do rótulo do fornecedor da fase (`Regular Season - 12` → 12; `core.stage.provider_label`, `football_fixture.round`), para `count.streak` por rodada |
| `event.season` | texto | temporada do jogo (`2026`, `2025-2026`) |
| `event.starts_at`, `event.ends_at_expected` | timestamptz | |
| `event.status` | enum | `scheduled`, `starting`, `live`, `break`, `finished`, `postponed`, `cancelled`, `suspended`, `abandoned` |
| `event.status_detail` | texto | código do fornecedor: futebol `FT`, `AET` (prorrogação), `PEN` (pênaltis); outros esportes `AOT`/`OT` (prorrogação), `AP` (shootout) etc. |
| `event.clock` | json | `{ "minute": 90, "extra": 4, "period": "2H" }` |
| `event.score` | json | ver abaixo |
| `event.derby_id` | uuid ou null | não nulo = **clássico** detectado |
| `event.participants[]` | lista | `{ "participant_id": uuid, "side": "home"\|"away"\|"grid"\|"corner_red"\|"corner_blue", "position": int\|null }` |
| `event.state_log[]` | lista | `{ "to_status", "occurred_at" }`: o `live` e o `finished` reais, para a duração real e o instante do lance |

`event.score`:

```json
{
  "home": 2, "away": 1,
  "halftime":  { "home": 0, "away": 1 },
  "extratime": { "home": null, "away": null },
  "penalty":   { "home": null, "away": null },
  "aggregate": { "home": 3, "away": 3 },
  "periods": {
    "q1": { "home": 28, "away": 22 },
    "q2": { "home": 25, "away": 30 },
    "q3": { "home": 20, "away": 27 },
    "q4": { "home": 31, "away": 24 },
    "ot": { "home": 10, "away": 8 }
  },
  "breakdown": { "home": { "hits": 9, "errors": 0 }, "away": { "hits": 0, "errors": 1 } }
}
```

- `periods` traz os parciais fora do futebol, com estas chaves (confirmadas no normalizador):
  - basquete, NBA e futebol americano: `q1`, `q2`, `q3`, `q4`, `ot` (e `ot2`, `ot3`… em prorrogações seguidas);
  - hóquei: `p1`, `p2`, `p3`, `ot`, `so` (shootout);
  - vôlei: `s1` a `s5` com os pontos de cada set; `home`/`away` do placar são os **sets vencidos**;
  - handebol: `h1`, `h2`, `ot`; rugby: `h1`, `h2`, `ot`, `ot2`;
  - beisebol: `i1` a `i9` e `extra` (corridas por entrada);
  - AFL: `q1` a `q4` (e `ot`) com os pontos do quarto; o detalhe `afl.detail.quarters` traz gols e behinds por quarto, e o placar final tem `breakdown` com `goals` e `behinds`.
- `breakdown`: beisebol (`hits`, `errors`) e AFL (`goals`, `behinds`).
- Do placar dá para tirar: virada (quem perdia ao fim de algum período e venceu), maior desvantagem revertida, prorrogação/shootout/tie-break, placar elástico, jogo apertado, período varrido, no-hitter (beisebol: `breakdown.<lado>.hits = 0` do adversário). Jogo perfeito não (não temos walks).

## 2. Lance a lance (só futebol): `event.incidents[]`

```json
{ "sequence": 14, "minute": 90, "extra": 3, "type": "goal", "detail": "Normal Goal",
  "participant_id": "<time>", "person_id": "<jogador>", "assist_person_id": "<jogador>|null", "data": {} }
```

**(correção)** O `type` guardado no core é minúsculo e já separa os gols: o normalizador (`incidentType`) grava `goal`, `own_goal`, `penalty_missed`, `card`, `subst`, `var` (e `other`). O `detail` mantém o texto do fornecedor.

| `type` | `detail` (valores reais) |
| --- | --- |
| `goal` | `Normal Goal`, `Penalty` |
| `own_goal` | `Own Goal` (no fornecedor, `participant_id` é o time **beneficiado**, que recebe o gol no placar, e `person_id` é o jogador do adversário que marcou contra; a importação confere isso contra um jogo real antes de ligar a Conquista) |
| `penalty_missed` | `Missed Penalty` |
| `card` | `Yellow Card`, `Second Yellow card`, `Red Card` |
| `subst` | `Substitution 1`, `Substitution 2`, … |
| `var` | `Goal cancelled`, `Goal Disallowed - offside`, `Goal Disallowed - handball`, `Goal Disallowed - Foul`, `Penalty confirmed`, `Card upgrade` |

Também temos a inferência de **gol anulado** (gol que sumiu do placar com VAR): vira lance `var` com `detail` `Goal cancelled`, com minuto, time e jogador do gol. Com isso dá: gol nos acréscimos (`minute >= 90 and extra > 0`, ou `>= 45` com `extra` no 1º tempo), gol no último minuto que decide, hat-trick (3 `goal` do mesmo `person_id`), gol contra, pênalti perdido/defendido, expulsão, VAR anulou gol, virada saindo de 2 abaixo (reconstruindo o placar pela sequência).

## 3. Detalhe do futebol: `football.detail`

Por jogo, o espelho do fornecedor em JSON: `lineups[]` (formação, titulares, reservas), `statistics[]` por time (`Shots on Goal`, `Total Shots`, `Ball Possession`, `Corner Kicks`, `Fouls`, `Offsides`, `Goalkeeper Saves`, `Yellow Cards`, `Red Cards`, `expected_goals`) e `players[]` com estatística por jogador (`games.rating`, `games.minutes`, `goals.total`, `goals.assists`, `goals.saves`, `shots`, `passes`, `tackles`, `penalty.saved`, `penalty.missed`). Em `requires_data`: `football.detail.statistics.<nome>` e `football.detail.players.<campo>`.

A linguagem de regras de hoje ([linguagem.md](linguagem.md)) **não** tem fato sobre `football.detail`: Conquista que dependa dele (posse, defesas do goleiro, nota do jogador) fica `active: false` com motivo `"sem fato na linguagem para football.detail"`, mesmo com o dado existindo. É a candidata mais fácil para a próxima rodada da linguagem.

## 4. Fórmula 1: `race.detail`

```json
{
  "results": [ { "driver_id": "<pessoa>", "team": "<equipe>", "position": 1, "grid": 14, "laps": 57, "pits": 2, "time": "1:32:10.123" } ],
  "startinggrid": [ { "driver_id": "<pessoa>", "grid": 1, "qualifying_time": "1:29.708", "team": "<equipe>" } ]
}
```

Dá: vitória, pódio, pole, vitória saindo de trás no grid (`grid - position`), corrida com muitos classificados, número de pit stops do vencedor. **Volta mais rápida não chega ao motor** (`proposed.race.detail.fastest_lap`). Não há piloto do coração no Perfil (`proposed.fan.favorite_person_id`).

## 5. MMA: `fight.detail.result`

```json
{ "won_type": "KO/TKO", "round": 1, "minute": "2:31", "winner_participant_id": "<lutador>" }
```

`won_type`: `KO/TKO`, `Submission`, `Decision` (unânime/dividida conforme o fornecedor). Na regra: `ko_tko`, `submission`, `decision`. Dá: nocaute ou finalização no 1º round, luta que foi para a decisão, fim até o minuto X do round Y. Não há lutador do coração no Perfil (`proposed.fan.favorite_person_id`).

## 6. O que vem do torcedor e do programa

| Caminho | Observação |
| --- | --- |
| `fan.presence` | presença verificada: janelas `started_at..last_seen_at` por jogo (`fan.presence_window`). "Estava lá no momento X" = existe janela cobrindo o instante do lance; "assistiu" = presença ≥ 2/3 da duração real do jogo |
| `fan.prediction` | `kind` (`exact_score`, `winner`, `quantity`), `correct`, `full_hit`, no fechamento definitivo |
| `fan.favorite_team_id` | time do coração (`event.participants[].participant_id` igual a ele = "do seu time") |
| `fan.country` | país do Perfil (ISO 2) |
| `fan.participation` | `watched`, `poll`, `trivia`, `consumption` (os três últimos ainda sem sinal) |
| `program.time_zone` | **(correção)** fuso do programa, o do país do torcedor no cliente. Não existe `fan.time_zone` no Perfil: a hora local do jogo sai daqui (`proposed.fan.time_zone` para o fuso individual) |

## 7. Como escrever `requires_data`

Use exatamente os caminhos acima, por exemplo:

```json
"requires_data": ["event.incidents.type=goal", "event.incidents.minute", "event.incidents.extra", "fan.presence", "fan.favorite_team_id"]
```

Prefixos aceitos pelo validador: `event.`, `football.detail.`, `race.detail.`, `fight.detail.`, `fan.`, `program.time_zone`, `proposed.`. Qualquer `proposed.` obriga `active: false`. Antes de importar em produção, cada caminho é mapeado para a base e conferido contra jogos reais; o que não bater volta para ajuste.
