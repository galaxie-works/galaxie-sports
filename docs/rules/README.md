# Motor de regras: tabelas calculadas e stakes

Pacote **`@galaxie/rules`** (`packages/rules`). Funções **puras e determinísticas** — mesma entrada, mesma saída, sem I/O e sem IA:

1. **Tabelas calculadas localmente** ([#24](https://github.com/galaxie-works/galaxie-sports/issues/24)): classificação a partir dos resultados, com os critérios de desempate de cada regulamento, grupos, punições e aplicação incremental sobre a tabela do provedor.
2. **Contexto competitivo — stakes** ([#28](https://github.com/galaxie-works/galaxie-sports/issues/28)): o que está em jogo em cada partida, como **códigos estruturados** (`advances_with_draw`, `needs_win_by_2`, `can_clinch_title`…). O motor **calcula**; o agente de Cenário apenas **redige** (ver [docs/07 §2.3](../07-ia-tempo-real-e-enriquecimento.md#23-agente-cenário-pré-jogo-e-resumo-pós-jogo)). Nenhum texto livre é gerado aqui: os textos vêm de um mapa fixo de rótulos para os 8 mercados ([rotulos.md](rotulos.md)).

| Entrada | O quê |
|---|---|
| `@galaxie/rules` | Funções puras: `computeStandings`, `computeTable`, `knockoutStakes`, `tieOutcome`, `analyzeLeague`, `leagueMatchStakes`, `finishedLeagueMatchStakes`, `leagueResultStakes`, `salientStakes`, `localizeStake`… |
| `@galaxie/rules/config` | `loadCompetitionRules(slug, { season })`, `loadAllCompetitionRules()` — lê `config/rules/*.yaml` |
| `@galaxie/rules/db` | `loadSeasonResults`, `loadProviderBaseline`, `writeComputedStandings` (grava `core.standing` com `source = 'computed'`) |

## 1. Regulamentos — `config/rules/<slug>.yaml`

O nome do arquivo é o `slug` de [`config/competitions/football.yaml`](../../config/competitions/football.yaml). Sem arquivo próprio, `loadCompetitionRules(slug, { fallbackToDefault: true })` usa [`default.yaml`](../../config/rules/default.yaml).

```yaml
slug: conmebol-libertadores
name: CONMEBOL Libertadores
format: groups_and_knockout          # league | cup | league_phase | groups_and_knockout

standings:                           # tabela (liga, grupo ou fase de liga)
  points: { win: 3, draw: 1, loss: 0 }
  h2h_reapply: true                  # reaplica o confronto direto ao subconjunto ainda empatado (UEFA)
  fair_play: { yellow: 1, red: 3 }   # pesos do critério fair_play
  tie_breakers:                      # depois dos pontos, nesta ordem
    - goal_difference
    - { criterion: h2h_points, max_teams: 2, require_complete: true }
    - drawing_of_lots

league:                              # matemática de pontos corridos (null em copas puras)
  teams: 4                           # por tabela/grupo
  matches_per_team: 6
  meetings_per_pair: 2               # turno e returno
  title: false                       # a tabela define campeão?
  zones:
    - { id: round_of_16, kind: qualification, from: 1, to: 2 }
    - { id: elimination, kind: elimination, from: 4, to: 4 }

knockout:                            # mata-mata (null em ligas)
  default: { legs: 2, away_goals: false, extra_time: false, penalties: true }
  stages:                            # chave = core.stage.kind
    final: { legs: 1, extra_time: true, penalties: true, neutral_venue: true, decides_title: true }

overrides:                           # exceções históricas, aplicadas em ordem (merge profundo; listas substituem)
  - seasons: { to: 2021 }            # from/to inclusivos, ano de início da temporada (rótulo da api-sports)
    knockout: { default: { away_goals: true } }
```

### 1.1 Critérios de desempate

Os pontos são sempre o primeiro critério. Os demais, na ordem do YAML (maior é melhor, salvo indicação):

| Critério | Significado |
|---|---|
| `wins` | Vitórias |
| `goal_difference` | Saldo de gols |
| `goals_for` | Gols marcados |
| `fewest_goals_against` | Menos gols sofridos |
| `away_goals_for` | Gols marcados como visitante (campo neutro não conta) |
| `away_wins` | Vitórias como visitante |
| `h2h_points` · `h2h_goal_difference` · `h2h_goals_for` · `h2h_away_goals` | Mini-tabela dos jogos **entre os empatados** (confronto direto). `max_teams: 2` limita a empates entre dois clubes (CBF); `require_complete: true` só aplica se todos os jogos entre eles já ocorreram (LaLiga) |
| `fewest_red_cards` · `fewest_yellow_cards` | Menos cartões vermelhos / amarelos (segundo amarelo conta como vermelho) |
| `fair_play` | Menos pontos disciplinares (`fair_play.yellow` × amarelos + `fair_play.red` × vermelhos) |
| `opponents_points` · `opponents_goal_difference` · `opponents_goals_for` | Soma dos pontos / saldo / gols dos adversários enfrentados (fase de liga da Champions) |
| `drawing_of_lots` | Sorteio, partida extra ou coeficiente externo: o motor usa a ordem do ID (determinística) e marca `unresolvedTieWith` |

**Reaplicação** (`h2h_reapply`, padrão `true`): se um critério separa parte dos empatados e já houve critério de confronto direto, o subconjunto que continua empatado recomeça do primeiro critério com a mini-tabela restrita a ele (regra UEFA). Com `false`, segue para o próximo critério na mini-tabela original.

### 1.2 Zonas

| `kind` | Exemplos | Semântica nos stakes |
|---|---|---|
| `qualification` · `promotion` · `playoff` | G4, Sul-Americana, oitavas | Zona "boa": garantir **ao menos** esta posição |
| `relegation` | Z4 | Rebaixamento (posição `from` ou pior) |
| `elimination` | 25º–36º da Champions, 4º do grupo | Eliminação (posição `from` ou pior) |
| `relegation_playoff` | 16º da Bundesliga/Ligue 1 | Só descreve a tabela (`description`) |

O `id` da zona vira parte do código (`qualifies_for_sudamericana`) e tem rótulo localizado ([rotulos.md](rotulos.md); id desconhecido aparece legível, sem `_`).

### 1.3 Competições configuradas

| Arquivo | Desempate (após pontos) | Observações |
|---|---|---|
| `brasileirao-serie-a` | vitórias, saldo, gols pró, confronto direto (2 clubes), vermelhos, amarelos, sorteio | G4 / pré-Libertadores 5º–6º / Sul-Americana 7º–12º / Z4 (nominais; redistribuição de vagas fora do escopo) |
| `premier-league` | saldo, gols pró, confronto direto (pontos, gols fora) | Play-off em empate decisivo → empate não resolvido |
| `laliga` | **confronto direto primeiro** (pontos, saldo; só com todos os jogos disputados), saldo, gols pró, fair play | |
| `serie-a-italia` | confronto direto (pontos, saldo), saldo, gols pró | *Spareggio* por título/rebaixamento → empate não resolvido |
| `bundesliga` | saldo, gols pró, confronto direto (pontos, gols fora), gols fora | 16º = playoff de rebaixamento |
| `ligue-1` | saldo, confronto direto (pontos, saldo, gols), gols pró, gols fora, fair play | 18 clubes |
| `argentina-liga-profesional` | saldo, gols pró, confronto direto, gols fora | Tabela anual; *promedios* e formatos Apertura/Clausura **não** calculados |
| `conmebol-libertadores` | saldo, gols pró, gols fora, vermelhos, amarelos | Grupos de 4; mata-mata sem gol fora desde 2022 e sem prorrogação; final única (2019+) |
| `conmebol-sudamericana` | idem Libertadores | 2º do grupo vai aos playoffs |
| `uefa-champions-league` | saldo, gols pró, gols fora, vitórias, vitórias fora, adversários (pontos, saldo, gols), fair play | Fase de liga de 36 (2024+); até 2023 grupos com confronto direto; até 2020 gol fora (inclusive na prorrogação) |
| `copa-do-brasil` | — | 1ª fase: visitante avança com empate; 2ª fase: jogo único com pênaltis; depois ida e volta sem prorrogação |
| `default` | saldo, gols pró, vitórias | Genérico |

> Regulamentos mudam a cada temporada. Antes de usar um arquivo para uma temporada nova, confira o regulamento oficial (fontes em `sources`) e acrescente um `overrides` quando algo mudar.

## 2. Tabelas calculadas (#24)

No plano gratuito, `standings` da temporada corrente é bloqueado; calculamos a partir dos resultados.

```ts
import { computeStandings } from '@galaxie/rules';
import { loadCompetitionRules } from '@galaxie/rules/config';
import { loadProviderBaseline, loadSeasonResults, writeComputedStandings } from '@galaxie/rules/db';

const rules = await loadCompetitionRules('brasileirao-serie-a', { season: 2026 });
const tables = computeStandings({
  rules,
  baseline: await loadProviderBaseline(db, seasonId),   // tabela completa do bootstrap Pro (opcional)
  matches: novosResultados,                              // só os jogos posteriores à baseline
  priorMatches: jogosJaContidosNaBaseline,               // apenas para confronto direto / adversários
  adjustments: [{ teamId, points: -3, reason: 'punição' }],
});
await writeComputedStandings(db, seasonId, tables);     // core.standing, source = 'computed'
```

- **Incremental**: a tabela do provedor entra como `baseline`; se o `points` dela divergir de V/E/D × pontuação, a diferença vira ajuste de pontos (punições já aplicadas pelo provedor são preservadas). Os novos resultados são somados por cima. Critérios de confronto direto precisam dos jogos (`priorMatches`); sem eles, o critério não separa ninguém e o próximo decide.
- **Grupos**: o campo `group` da partida separa as tabelas (`computeStandings` devolve uma por grupo; `computeTable` exige tabela única).
- **Saída** por linha: posição, pontos, J/V/E/D, gols, saldo, gols fora, cartões, forma (últimos 5, do mais antigo ao mais recente), `zone`, `decidedBy` (critério que separou o time do vizinho de cima) e `unresolvedTieWith`.
- **Gravação**: `writeComputedStandings` faz upsert por `(season_id, group, participant_id)` com `source = 'computed'` e `description = zona`. `mode: 'keep_provider'` não sobrescreve linhas do provedor.
- **Validação**: os 380 jogos reais do Brasileirão 2024 (recorte do raw em `packages/rules/fixtures`) reproduzem a classificação oficial — campeão Botafogo (79), três empates em pontos decididos por vitórias (Vitória × Atlético-MG, Grêmio × Juventude, Atlético-GO × Cuiabá) e Z4 Athletico, Criciúma, Atlético-GO e Cuiabá.

## 3. Stakes (#28)

Saída de `knockoutStakes` e `leagueMatchStakes` — lista de:

```json
{ "team": "away", "code": "needs_win_by_2", "family": "needs_win_by_n", "params": { "n": 2 } }
```

- `team`: `home`, `away` (mando **da partida analisada**) ou `both` (vale para o confronto).
- `code`: estável, `snake_case`, é o que a API expõe. `family` + `params` permitem localizar: `localizeStake(stake)` produz o formato da API (`{ team, code, text: { "pt-BR": … } }`, [docs/05 §3.2](../05-api-publica.md#32-eventos)).

### 3.1 Mata-mata

`knockoutStakes({ rules, leg, firstLeg })` usa as regras da fase (`knockoutStageRules(rules, stage.kind)`). O motor varre todos os placares possíveis do jogo (diferença até 10, até 8 gols do perdedor) e deriva, para cada lado, a **menor margem que garante a vaga no tempo normal** e o que acontece na margem imediatamente abaixo. `tieOutcome(input, golsMandante, golsVisitante)` responde "quem passa com este placar" (útil ao vivo).

Exemplo de [docs/07 §2.3](../07-ia-tempo-real-e-enriquecimento.md#23-agente-cenário-pré-jogo-e-resumo-pós-jogo) — ida 2 × 1 para o mandante da volta, Libertadores (sem gol fora, pênaltis direto):

```json
[
  { "team": "home", "code": "advances_with_draw" },
  { "team": "away", "code": "needs_win_by_2" },
  { "team": "away", "code": "win_by_1_goes_to_penalties" }
]
```

### 3.2 Pontos corridos, grupos e fase de liga

`analyzeLeague({ table, league })` devolve, por time, `maxPoints`, `remaining`, **`bestRank`/`worstRank`** (posições ainda alcançáveis), `champion` e o status de cada zona. `leagueMatchStakes({ table, league, homeId, awayId, nextRound })` traduz isso em códigos para os dois lados da partida.

- **Limites seguros**: só se afirma certeza (campeão, rebaixado, classificado) quando nenhuma combinação de resultados muda o desfecho. Empate em pontos conta como ameaça (desempates futuros são desconhecidos), salvo entre times que já encerraram a campanha, quando vale a ordem atual. "Possível" é condição necessária (pode haver combinações incompatíveis entre si). Com 3/1/0 pontos, decidir exatamente se um time ainda pode ser campeão é NP-difícil; por isso o motor usa esses limites.
- **Rodada atual**: com `nextRound` (os jogos da rodada), os códigos "nesta rodada" são exatos para a rodada: cada jogo é uma unidade independente e o motor escolhe o pior/melhor resultado de cada um. Sem `nextRound`, cada outro time é tratado como se pudesse vencer, empatar ou perder (certezas continuam seguras; possibilidades ficam mais otimistas).
- **Relevância**: códigos de mera possibilidade (`in_title_race`, `can_qualify_for_zone`, `at_risk_of_relegation`, `at_risk_of_elimination`, `safe_from_relegation`) só aparecem na reta final — jogos restantes ≤ max(3, ¼ da fase) — ou com `includePossibilities: true`. `safe_from_relegation` ainda exige o time na metade de baixo da tabela.
- Validado com o Brasileirão 2024 antes da 38ª rodada: Botafogo `clinches_title_with_draw`, Bragantino `relegated_if_loses`, Athletico `can_be_relegated` (foi rebaixado), Criciúma/Atlético-GO/Cuiabá `mathematically_relegated`.

### Catálogo de códigos

Mata-mata (`knockoutStakes`):

| Família | Código (exemplo) | Lado | Significado | Rótulo pt-BR |
|---|---|---|---|---|
| `first_leg` | `first_leg` | both | Jogo de ida; nada se decide | Jogo de ida do confronto |
| `advances_with_draw` | `advances_with_draw` | time | Vitória ou empate classificam | Avança com empate |
| `advances_with_loss_by_n` | `advances_with_loss_by_2` | time | Classifica mesmo perdendo por até N | Avança mesmo perdendo por até 2 gols de diferença |
| `needs_win` | `needs_win` | time | Precisa vencer (qualquer placar) para avançar sem prorrogação/pênaltis | Precisa vencer para avançar direto |
| `needs_win_by_n` | `needs_win_by_2` | time | Precisa vencer por N gols para avançar direto | Precisa vencer por 2 gols para avançar direto |
| `win_by_n_goes_to_penalties` | `win_by_1_goes_to_penalties` | time | Vencer por N empata o agregado → pênaltis | Vitória por 1 gol leva a decisão aos pênaltis |
| `win_by_n_goes_to_extra_time` | `win_by_1_goes_to_extra_time` | time | Vencer por N empata o agregado → prorrogação | Vitória por 1 gol leva o jogo à prorrogação |
| `draw_goes_to_penalties` | `draw_goes_to_penalties` | both | Empate neste jogo → pênaltis | Empate leva a decisão aos pênaltis |
| `draw_goes_to_extra_time` | `draw_goes_to_extra_time` | both | Empate neste jogo → prorrogação | Empate leva o jogo à prorrogação |
| `advances_with_draw_up_to_n` | `advances_with_draw_up_to_0` | time | Gol fora: avança com empates até N × N | Avança com empate sem gols |
| `advances_with_draw_from_n` | `advances_with_draw_from_2` | time | Gol fora: avança com empates a partir de N × N | Avança com empate de 2 a 2 ou com mais gols |
| `specific_draw_goes_to_penalties` | `draw_1_1_goes_to_penalties` | both | Gol fora: o empate N × N leva aos pênaltis | Empate por 1 a 1 leva a decisão aos pênaltis |
| `specific_draw_goes_to_extra_time` | `draw_0_0_goes_to_extra_time` | both | Gol fora: o empate N × N leva à prorrogação | Empate sem gols leva o jogo à prorrogação |
| `outcome_depends_on_away_goals` | `win_by_1_depends_on_away_goals` | time | Gol fora: vencer por N pode classificar ou não, conforme o placar | Com vitória por 1 gol, a vaga depende dos gols fora |
| `away_goals_rule` | `away_goals_rule` | both | Gol fora vale como desempate (edições históricas) | Gol fora de casa é critério de desempate |
| `extra_time_then_penalties` | `extra_time_then_penalties` | both | Igualdade → prorrogação e, persistindo, pênaltis | Em caso de igualdade, prorrogação e depois pênaltis |
| `decides_title` | `decides_title` | both | O vencedor do confronto é campeão | Vale o título |
| `wins_title_with_draw` | `wins_title_with_draw` | time | Final: vitória ou empate dão o título (variante de `advances_with_draw`) | Empate dá o título |
| `wins_title_with_loss_by_n` | `wins_title_with_loss_by_2` | time | Final: é campeão mesmo perdendo por até N (variante de `advances_with_loss_by_n`) | É campeão mesmo perdendo por até 2 gols de diferença |
| `needs_win_for_title` | `needs_win_for_title` | time | Final: vencer no tempo normal dá o título (variante de `needs_win`) | Vitória no tempo normal dá o título |
| `needs_win_by_n_for_title` | `needs_win_by_2_for_title` | time | Final: vencer por N ou mais no tempo normal dá o título (variante de `needs_win_by_n`) | Vitória por 2 gols ou mais no tempo normal dá o título |
| `wins_title_with_draw_up_to_n` | `wins_title_with_draw_up_to_0` | time | Final com gol fora: empates até N × N dão o título | Empate sem gols dá o título |
| `wins_title_with_draw_from_n` | `wins_title_with_draw_from_2` | time | Final com gol fora: empates a partir de N × N dão o título | Empate de 2 a 2 ou com mais gols dá o título |
| `title_depends_on_away_goals` | `win_by_1_title_depends_on_away_goals` | time | Final com gol fora: vencer por N pode dar o título ou não | Com vitória por 1 gol, o título depende dos gols fora |

**Final (`decides_title`)**: numa final ninguém avança, quem vence é campeão. Quando o confronto decide o título (`decides_title: true` na fase, no jogo decisivo: jogo único ou volta), as famílias que falam em avançar ou em vaga saem nas **variantes de título** acima (`TITLE_VARIANT_OF` em `codes.ts`): mesma condição, outro código e outro rótulo. Os demais códigos (prorrogação, pênaltis, gol fora, `extra_time_then_penalties`) valem como estão. Por que famílias novas e não um rótulo diferente por contexto: o `code` é contrato público (docs/05 §3.2) e diz o que está em jogo; `needs_win` numa semifinal e numa final são situações diferentes, e o cliente que traduz ou filtra pelo código precisa saber disso sem olhar a fase. Os códigos antigos não mudam fora da final. Na ida de uma final em ida e volta sai só `first_leg`. As tags do torcedor ficam curtas e coerentes ("Precisa vencer", "Empate dá o título").

Pontos corridos, grupos e fase de liga (`leagueMatchStakes`; todos com lado = time):

| Família | Código (exemplo) | Significado | Rótulo pt-BR |
|---|---|---|---|
| `mathematically_champion` | `mathematically_champion` | Campeão com qualquer combinação de resultados | Já é campeão matematicamente |
| `clinches_title_with_draw` | `clinches_title_with_draw` | Empate (ou vitória) garante o título, independentemente dos outros jogos | Empate garante o título |
| `clinches_title_with_win` | `clinches_title_with_win` | Vitória garante o título | Vitória garante o título |
| `can_clinch_title` | `can_clinch_title` | Pode garantir o título nesta rodada, dependendo de outros resultados | Pode ser campeão nesta rodada, dependendo de outros resultados |
| `in_title_race` | `in_title_race` | Ainda pode ser campeão | Ainda briga pelo título |
| `qualifies_for_zone` | `qualifies_for_sudamericana` | Já garantiu ao menos esta zona (a melhor garantida) | Garante ao menos a Sul-Americana |
| `clinches_zone_with_draw` | `clinches_libertadores_group_stage_with_draw` | Empate garante a zona | Empate garante a fase de grupos da Libertadores |
| `clinches_zone_with_win` | `clinches_round_of_16_with_win` | Vitória garante a zona | Vitória garante as oitavas de final |
| `can_clinch_zone` | `can_clinch_knockout_playoff` | Pode garantir a zona nesta rodada, dependendo de outros resultados | Pode garantir os playoffs do mata-mata nesta rodada… |
| `can_qualify_for_zone` | `can_qualify_for_libertadores_group_stage` | Ainda alcança a zona (melhor zona possível acima da garantida) | Ainda pode garantir a fase de grupos da Libertadores |
| `mathematically_relegated` | `mathematically_relegated` | Rebaixado com qualquer combinação | Já está rebaixado matematicamente |
| `relegated_unless_wins` | `relegated_unless_wins` | Empate ou derrota rebaixam, independentemente dos outros | É rebaixado se não vencer |
| `relegated_if_loses` | `relegated_if_loses` | Derrota rebaixa, independentemente dos outros | É rebaixado em caso de derrota |
| `can_be_relegated` | `can_be_relegated` | Pode ser rebaixado nesta rodada, dependendo de outros resultados | Pode ser rebaixado nesta rodada… |
| `at_risk_of_relegation` | `at_risk_of_relegation` | Ainda pode terminar na zona | Ainda corre risco de rebaixamento |
| `secures_safety_with_draw` | `secures_safety_with_draw` | Empate garante a permanência | Empate garante a permanência |
| `secures_safety_with_win` | `secures_safety_with_win` | Vitória garante a permanência | Vitória garante a permanência |
| `can_secure_safety` | `can_secure_safety` | Pode garantir a permanência nesta rodada, dependendo de outros resultados | Pode garantir a permanência nesta rodada… |
| `safe_from_relegation` | `safe_from_relegation` | Já não pode ser rebaixado | Já está livre do rebaixamento |
| `mathematically_eliminated` | `mathematically_eliminated` | Eliminado com qualquer combinação (zona `elimination`) | Já está eliminado matematicamente |
| `eliminated_unless_wins` | `eliminated_unless_wins` | Empate ou derrota eliminam | É eliminado se não vencer |
| `eliminated_if_loses` | `eliminated_if_loses` | Derrota elimina | É eliminado em caso de derrota |
| `can_be_eliminated` | `can_be_eliminated` | Pode ser eliminado nesta rodada, dependendo de outros resultados | Pode ser eliminado nesta rodada… |
| `at_risk_of_elimination` | `at_risk_of_elimination` | Ainda pode terminar na zona de eliminação | Ainda corre risco de eliminação |

Histórico (`titleChaseStakes`; lado = time):

| Família | Código (exemplo) | Significado | Rótulo pt-BR |
|---|---|---|---|
| `seeks_title_n` | `seeks_title_4` | O time já tem N − 1 títulos desta competição (antes da partida) e busca o N-ésimo | Busca o tetracampeonato |

Resultado (`leagueResultStakes`, jogo encerrado de pontos corridos; lado = time; [§3.4](#34-jogo-encerrado-o-que-o-resultado-mudou)):

| Família | Código (exemplo) | Significado | Rótulo pt-BR |
|---|---|---|---|
| `moved_up_to_n` | `moved_up_to_13` | Subiu na tabela; N = posição depois do jogo | Subiu para o 13º lugar |
| `moved_down_to_n` | `moved_down_to_17` | Caiu na tabela; N = posição depois do jogo | Caiu para o 17º lugar |
| `stayed_at_n` | `stayed_at_17` | Manteve a posição N | Segue em 17º lugar |
| `took_the_lead` | `took_the_lead` | Passou a ser o 1º (tabela com título) | Assumiu a liderança |
| `lost_the_lead` | `lost_the_lead` | Deixou de ser o 1º | Perdeu a liderança |
| `entered_zone` | `entered_sudamericana` | Subiu para dentro de uma zona boa (só a nova) | Passou a ocupar vaga para a Sul-Americana |
| `left_zone` | `left_libertadores_group_stage` | Caiu para fora de uma zona boa (só a perdida) | Deixou de ocupar vaga para a fase de grupos da Libertadores |
| `dropped_into_relegation` | `dropped_into_relegation` | Entrou na zona de rebaixamento | Entrou na zona de rebaixamento |
| `climbed_out_of_relegation` | `climbed_out_of_relegation` | Saiu da zona de rebaixamento | Saiu da zona de rebaixamento |
| `dropped_into_elimination` | `dropped_into_elimination` | Entrou na zona de eliminação (grupos, fase de liga) | Entrou na zona de eliminação |
| `climbed_out_of_elimination` | `climbed_out_of_elimination` | Saiu da zona de eliminação | Saiu da zona de eliminação |
| `clinched_title` | `clinched_title` | Com este resultado, campeão com qualquer combinação | Garantiu o título matematicamente |
| `clinched_zone` | `clinched_libertadores_group_stage` | Passou a garantir uma zona boa melhor que a de antes | Garantiu ao menos a fase de grupos da Libertadores matematicamente |
| `clinched_safety` | `clinched_safety` | Não pode mais ser rebaixado (antes podia) | Garantiu a permanência matematicamente |
| `relegation_confirmed` | `relegation_confirmed` | Rebaixado com qualquer combinação (antes não estava) | Teve o rebaixamento confirmado |
| `elimination_confirmed` | `elimination_confirmed` | Eliminado com qualquer combinação | Teve a eliminação confirmada |
| `lost_title_chance` | `lost_title_chance` | Antes podia ser campeão; agora não | Não pode mais ser campeão |
| `lost_zone_chance` | `lost_libertadores_group_stage_chance` | A pior zona boa que deixou de ser alcançável (implica as melhores) | Não alcança mais a fase de grupos da Libertadores |
| `points_behind_leader_n` | `points_behind_leader_2` | Pontos atrás do líder (só para quem já está na melhor zona) | Fica a 2 pontos do líder |
| `points_ahead_at_top_n` | `points_ahead_at_top_3` | Líder: pontos de vantagem sobre o 2º | Lidera com 3 pontos de vantagem |
| `points_behind_zone_n` | `points_behind_sudamericana_1` | Pontos atrás do último dentro da zona boa logo acima | Fica a 1 ponto da vaga para a Sul-Americana |
| `points_above_relegation_n` | `points_above_relegation_5` | Fora do Z4: pontos acima do primeiro time dentro dele | Fica 5 pontos acima da zona de rebaixamento |
| `points_below_safety_n` | `points_below_safety_2` | No Z4: pontos atrás do primeiro time fora dele | Fica a 2 pontos de sair da zona de rebaixamento |

As famílias de pontos usam as variantes n = 0 ("Fica empatado em pontos com o líder") e n = 1 (singular). As de resultado não geram tag do torcedor (o card de chamada fala do que está em jogo).

### 3.3 Histórico: "busca o tetra"

`seeks_title_{n}` sai para cada time de uma **final** (fase com `decides_title`, ida inclusive) ou de um jogo de pontos corridos que **pode dar o título** a ele (`can_clinch_title`, `clinches_title_with_*`). `n` é o título buscado: o Palmeiras, com 3 Libertadores (1999, 2020, 2021), busca o 4º → `seeks_title_4`, "Busca o tetracampeonato" / "Va por el tetracampeonato". Prefixos de bi (2) a deca (10); n = 1 é "Busca o primeiro título" / "Va por su primer título"; acima de 10, "Busca o 11º título" / "Va por el título número 11". As tags do torcedor usam a forma curta ("Busca o tetra", "Va por el tetra").

A contagem vem de `core.competition_title` (campeões por edição importados do Wikidata pelo CLI `titulos:wikidata` do ingestor) e é estrita: só conta título decidido **antes** da partida; o time precisa ter QID do Wikidata em `core.provider_map` (sem ele, "0 títulos" seria palpite); e a competição precisa estar **em dia** (a última edição importada não pode ser anterior à temporada anterior do core). Faltando qualquer um, o código não sai. O motor só decide quando emitir (`titleChaseSides`) e monta o código (`titleChaseStakes`); a leitura do banco é `loadTitleRecords` de `@galaxie/db`.

**Importação** (`services/ingestor/src/titles/wikidata-titles.ts`; não usa a cota da api-sports):

```bash
pnpm --filter @galaxie/ingestor titulos:wikidata --plan                 # consulta, confere e relata, sem gravar
pnpm --filter @galaxie/ingestor titulos:wikidata --corrigir-ligacoes    # grava títulos, cobertura e ligações
```

- **Fonte vazia não apaga**: competição cuja consulta veio sem edições aceitas, ou com menos da metade dos títulos gravados, fica como estava (títulos e cobertura) e o motivo é relatado (o `--plan` já mostra quais seriam mantidas); `--aceitar-queda` grava assim mesmo.

- Competições (`TITLE_COMPETITIONS`): Libertadores, Sul-Americana, Recopa, Copa do Brasil, Brasileirão, Champions League, Mundial de Clubes e as ligas tier 1 da LatAm (Argentina, Uruguai, Chile, Colômbia, Peru, Equador, Paraguai, México, Bolívia, Venezuela). O Paraguai tem um QID só para os dois torneios: viram dois feeds (Apertura e Clausura), cada um só com as edições cujo rótulo cita o torneio; edição sem o torneio no rótulo fica de fora (o log lista as descartadas). Carga única depois da troca (out/2026), porque a carga anterior gravou o mesmo conjunto de campeões nos dois slugs e a proteção contra a queda seguraria as duplicatas: confira com `titulos:wikidata --competicao paraguay-primera-apertura --plan` (as edições aceitas e as descartadas pelo filtro) e grave com `titulos:wikidata --competicao paraguay-primera-apertura --aceitar-queda`; o mesmo para `paraguay-primera-clausura`. Se o rótulo em inglês das edições não citar o torneio, os dois feeds vêm vazios: com `--aceitar-queda` os títulos errados saem e o Paraguai fica sem contagem (melhor faltar do que errar) até o filtro ser ajustado ao rótulo da fonte. As competições não têm QID na base semântica; o mapa slug → QID fica no código.
- Edições: `?edição wdt:P3450 <competição>` com `P1346` (vencedor) sem qualificador "de" (`P642`, prêmios individuais), sem posição ≠ 1 e sem rank depreciado. Recusa edição com mais de um vencedor, sem data, com rótulo e datas divergentes ou com vencedor fora dos participantes (`P1923`) que ela mesma lista; e a que tem final no core com outro campeão (o core manda; a data da final do core também vale no lugar do fim da edição).
- **Correções curadas** (`EDITION_CORRECTIONS`): edições com erro na fonte que as checagens não resolvem sozinhas, com a URL da lista oficial de campeões em `source_ref` (`source = 'curated'`). Hoje, cinco edições da Libertadores (1991 Colo-Colo, 1993 São Paulo, 1997 Cruzeiro, 1998 Vasco, 2018 River Plate), em que o Wikidata aponta outro time. Corrigidas na fonte, as entradas podem sair.
- **Casamento estrito** do vencedor com o nosso time: ligação existente em `core.provider_map` (`wikidata`/`football`/`participant`) só vale se o time é adulto masculino e se o nome do vencedor não bate exatamente com outro time nosso; sem ligação, o nome inteiro (rótulos e apelidos em en/es/pt; siglas juntadas: "Estudiantes L.P." = "Estudiantes LP") e, sem par exato, o nome sem tokens genéricos ("Club", "FC"…), mesmo país, time adulto masculino sem outro QID e um só candidato (par único dos dois lados). Ligação em conflito (ex.: o QID do Estudiantes de La Plata ligado ao CA Estudiantes; o do Chelsea ligado ao Chelsea W) não conta e é relatada; `--corrigir-ligacoes` move o QID para o time que o nome indica.
- **Cobertura** (`core.competition_title_coverage`): até que ano a lista está completa (sem ano faltando nem edição recusada desde a primeira; anos sem edição declarados em `noEditionYears`). Na importação de out/2026: Libertadores completa até 2025; Copa do Brasil até 2020 (o Wikidata parou em 2020); Brasileirão até 1963 (faltam 1964, 2005, 2020, 2023 e 2024); Champions até 1984; demais ligas com lacunas. Só a Libertadores tem contagem nos jogos de 2026.

### 3.4 Jogo encerrado: o que o resultado mudou

Num jogo encerrado de pontos corridos, a API e os agentes mostram **o que estava em jogo** (os mesmos códigos do pré-jogo, calculados com a tabela de antes do jogo) **e o que o resultado mudou** (as famílias de resultado acima). Funções puras em `stakes/result.ts`:

- `prepareFinishedLeagueMatch({ rules, current, results, matchId, nextRound })`: a tabela atual (`core.standing`, o grupo dos dois times) e os jogos encerrados da temporada nas fases de pontos corridos. Recusa (`LeagueInputError`) quando a tabela não bate com os resultados (jogos somados na tabela ≠ jogos encerrados entre os times dela): desfazer jogos de uma tabela desatualizada daria uma tabela de antes errada.
- `tablesAroundMatch`: **antes** = tabela atual menos este jogo e os encerrados que começaram no mesmo instante ou depois (simultâneos e rodadas seguintes); punições já aplicadas são preservadas. **Depois** = antes + este jogo, e só ele: os simultâneos ficam de fora, para o código dizer o que ESTE resultado mudou. As duas tabelas são reordenadas com os critérios do regulamento (confronto direto com os jogos anteriores).
- `finishedLeagueMatchStakes`: `pre` = `leagueMatchStakes` com a tabela de antes (e a rodada como estava no início do jogo); `result` = `leagueResultStakes(antes, depois)`:
  1. posição (`moved_up_to_n`, `moved_down_to_n`, `stayed_at_n`);
  2. zona pela posição: liderança, zona boa (subindo, só a nova; descendo, só a perdida), rebaixamento e eliminação;
  3. garantias e perdas matemáticas, comparando `analyzeLeague` antes e depois (mesmos limites seguros do pré-jogo);
  4. distância depois do jogo: o alvo logo acima (no Z4, sair dele; fora de zona, a zona boa logo acima; na melhor zona, o líder ou a vantagem do líder) e, fora do Z4, a folga sobre ele.
- A lista de resultado é completa; a [saliência](#35-saliência-o-que-mostrar-para-cada-time) escolhe o que mostrar.

Validado com o Brasileirão 2026, rodada 32 (`packages/rules/fixtures/brasileirao-serie-a-2026-r32.json`, tabela e jogos da produção): Vasco 3 × 2 Corinthians começou com o Vasco em 15º (35 pontos) e o Corinthians em 17º (33, no Z4), os dois com `at_risk_of_relegation`; depois do jogo, Vasco `moved_up_to_13`, `points_behind_sudamericana_1`, `points_above_relegation_5`; Corinthians `stayed_at_17`, `points_below_safety_2` (e `lost_libertadores_group_stage_chance`, cortado pela saliência). Internacional 3 × 0 Botafogo, no mesmo sábado: Inter `moved_up_to_16`, `climbed_out_of_relegation`.

### 3.5 Saliência: o que mostrar para cada time

Os códigos são matemáticos, todos verdadeiros, mas nem todos relevantes: com sete rodadas por jogar, o Flamengo (2º, a 34 pontos do Z4) "ainda corre risco de rebaixamento" e o Coritiba (12º) "ainda pode garantir a Libertadores" a 15 pontos do G4. `salientStakes(stakes, { home, away })` (`stakes/salience.ts`) escolhe, para cada time, os mais relevantes, sem mudar nenhum código:

1. **Briga** de cada código: título, rebaixamento, eliminação, uma zona boa ou a tabela (posição). Mata-mata, `both` e demais passam direto, sem corte nem limite.
2. **Corte do improvável**: o código só fica se a distância do time para a briga cabe na janela **`max(3, ⅓ × pontos em disputa)`**, com pontos em disputa = jogos restantes do time × pontos da vitória (`SALIENCE_MIN_GAP = 3`, `SALIENCE_FRACTION = 1/3`). Distância: título = pontos atrás do líder; rebaixamento e eliminação = pontos acima do primeiro time dentro da zona (0 se já está nela); zona boa = pontos atrás do último time dentro dela (0 se já está nela). Com 7 jogos restantes, a janela é de 7 pontos; na última rodada, 3.
3. **Piso superado**: `qualifies_for_zone` ("Garante ao menos a Sul-Americana") e `safe_from_relegation` saem quando o time tem outro código saliente de título ou de zona melhor.
4. **Ordem e limite**: decididos (matematicamente) > decisivos (desta rodada, ou o que o resultado mudou: zona, posição) > disputas (possibilidades e distâncias; a mais perto, até metade da janela, primeiro) > situação (pisos garantidos, posição mantida); dentro da faixa, título > rebaixamento/eliminação > zonas (a melhor primeiro) > tabela. No máximo **3 por time** (`MAX_SALIENT_STAKES`), separadamente no retrato de antes e no resultado.

`salienceStanding(tabela, league, teamId, pontos)` monta a situação do time (posição, pontos, jogos restantes, líder, linhas das zonas). Na rodada 32 de 2026: Flamengo × Atlético-MG → Flamengo `clinches_libertadores_group_stage_with_win` e `in_title_race` (sai `qualifies_for_sudamericana`, piso superado); Atlético-MG `can_qualify_for_libertadores_group_stage` (saem `in_title_race`, a 19 pontos, `at_risk_of_relegation` e `secures_safety_with_win`, a 17 do Z4). Coritiba × Grêmio → os dois só com `at_risk_of_relegation` (a Libertadores, a 15 e 23 pontos, sai).

A API devolve a lista saliente em `stakes` e a completa com `?stakes=all` ([docs/05 §3.2](../05-api-publica.md#32-eventos)); os agentes de Cenário e Resumo recebem só a saliente. As tags do torcedor e os sinais de jogo decisivo da importância seguem com o corte próprio (`isRelevantForFans`).

Os rótulos dos **8 mercados** (pt-BR, es-AR, es-MX, es-CO, es-CL, es-PE, es-UY, es-EC) estão em [rotulos.md](rotulos.md), gerado a partir de `packages/rules/src/stakes/labels.ts`. As **tags do torcedor** (`fan_tags` da API: rótulos curtos por participante, ordenados por relevância, para cards personalizados pelo clube) estão em [tags-torcedor.md](tags-torcedor.md), gerado a partir de `packages/rules/src/stakes/fan-tags.ts` pelo mesmo comando (`pnpm --filter @galaxie/rules docs:labels`). Diferenças regionais: prorrogação = *alargue* (AR, UY, CL), *tiempos extra* (MX), *tiempo extra* (CO, EC), *tiempo suplementario* (PE); rodada = *jornada* (MX) e *fecha* (demais).

## 4. Fora do escopo (por ora)

- Redistribuição de vagas continentais (campeão da Copa do Brasil/Libertadores já classificado etc.).
- Rebaixamento por *promedios* (Argentina) e formatos com playoffs (Apertura/Clausura, liguilla).
- Coeficiente UEFA como último critério; partidas extras de desempate (marcadas como empate não resolvido).
- Gol qualificado na prorrogação com gol fora (UEFA até 2020/21): o motor indica a prorrogação, sem detalhar o que acontece nela.
