# Tags do torcedor (`fan_tags`)

> Arquivo **gerado** a partir de `packages/rules/src/stakes/fan-tags.ts` por
> `pnpm --filter @galaxie/rules docs:labels`. Não edite à mão: altere a tabela e regenere.
> Uso na API: [docs/05 §3.2](../05-api-publica.md#32-eventos).

Rótulos curtos (até ~30 caracteres), do ponto de vista de quem torce para o time, derivados dos
[stakes](README.md#catálogo-de-códigos) por esta tabela fixa — nenhum texto é gerado livremente.

- **Faixas de relevância** (`priority` = base da faixa + ordem dentro dela; menor = mais importante): `title` = 10, `relegation` = 20, `knockout` = 30, `qualification` = 40, `other` = 50.
- Stakes `both` valem para os dois participantes.
- Tags de texto idêntico são fundidas: fica a de menor `priority` (e o `code` dela).
- No máximo 3 tags por participante; empate de `priority` segue a ordem dos stakes.
- Os mercados es-* usam o texto de es-AR, com as variações regionais de prorrogação
  (*tiempos extra* no MX, *tiempo extra* no CO/EC, *suplementario* no PE), "lucha" no lugar de
  "pelea" (MX) e *liguilla* para `playoff` (MX). `en` é a reserva da cadeia de fallback.

Exemplos com `n = 2` (ou `n = 1` para empates específicos).

## Códigos sem zona

| Família | Código (exemplo) | `priority` | pt-BR | es-AR | en |
|---|---|---|---|---|---|
| `first_leg` | `first_leg` | 50 | Jogo de ida | Partido de ida | First leg |
| `advances_with_draw` | `advances_with_draw` | 34 | Avança com empate | Avanza con el empate | A draw is enough |
| `advances_with_loss_by_n` | `advances_with_loss_by_2` | 35 | Pode perder por até 2 gols | Puede perder por hasta 2 goles | Can lose by up to 2 goals |
| `needs_win` | `needs_win` | 31 | Precisa vencer | Necesita ganar | Must win |
| `needs_win_by_n` | `needs_win_by_2` | 31 | Precisa vencer por 2 gols | Necesita ganar por 2 goles | Must win by 2 goals |
| `win_by_n_goes_to_penalties` | `win_by_2_goes_to_penalties` | 36 | Vencer por 2 leva aos pênaltis | Ganar por 2 lleva a penales | Win by 2 means penalties |
| `win_by_n_goes_to_extra_time` | `win_by_2_goes_to_extra_time` | 36 | Vencer por 2 leva à prorrogação | Ganar por 2 lleva al alargue | Win by 2 means extra time |
| `draw_goes_to_penalties` | `draw_goes_to_penalties` | 37 | Empate leva aos pênaltis | El empate lleva a penales | A draw means penalties |
| `draw_goes_to_extra_time` | `draw_goes_to_extra_time` | 37 | Empate leva à prorrogação | El empate lleva al alargue | A draw means extra time |
| `advances_with_draw_up_to_n` | `advances_with_draw_up_to_1` | 34 | Avança com empate até 1 a 1 | Avanza con empate hasta 1 a 1 | A draw up to 1-1 is enough |
| `advances_with_draw_from_n` | `advances_with_draw_from_1` | 34 | Empate com gols classifica | Le sirve el empate con goles | A scoring draw is enough |
| `specific_draw_goes_to_penalties` | `draw_1_1_goes_to_penalties` | 38 | 1 a 1 leva aos pênaltis | El 1 a 1 lleva a penales | 1-1 means penalties |
| `specific_draw_goes_to_extra_time` | `draw_1_1_goes_to_extra_time` | 38 | 1 a 1 leva à prorrogação | El 1 a 1 lleva al alargue | 1-1 means extra time |
| `outcome_depends_on_away_goals` | `win_by_2_depends_on_away_goals` | 39 | Gol fora pesa | Pesa el gol de visitante | Away goals count |
| `away_goals_rule` | `away_goals_rule` | 51 | Gol fora pesa | Pesa el gol de visitante | Away goals count |
| `extra_time_then_penalties` | `extra_time_then_penalties` | — | _sem tag (informativo)_ | | |
| `decides_title` | `decides_title` | 11 | Vale o título | Se juega el título | Title on the line |
| `mathematically_champion` | `mathematically_champion` | 10 | Já é campeão | Ya es campeón | Already champions |
| `clinches_title_with_draw` | `clinches_title_with_draw` | 12 | Empate dá o título | Con un empate es campeón | A draw seals the title |
| `clinches_title_with_win` | `clinches_title_with_win` | 13 | Vitória dá o título | Si gana, es campeón | A win seals the title |
| `can_clinch_title` | `can_clinch_title` | 14 | Pode ser campeão hoje | Puede ser campeón hoy | Could be champions today |
| `in_title_race` | `in_title_race` | 15 | Na briga pelo título | En la pelea por el título | In the title race |
| `mathematically_relegated` | `mathematically_relegated` | 20 | Já rebaixado | Ya descendió | Already relegated |
| `relegated_unless_wins` | `relegated_unless_wins` | 21 | Vencer ou cair | Ganar o descender | Win or go down |
| `relegated_if_loses` | `relegated_if_loses` | 22 | Não pode perder | No puede perder | Can't afford to lose |
| `can_be_relegated` | `can_be_relegated` | 23 | Pode ser rebaixado hoje | Puede descender hoy | Could go down today |
| `at_risk_of_relegation` | `at_risk_of_relegation` | 27 | Luta contra o rebaixamento | Pelea por no descender | Fighting relegation |
| `secures_safety_with_draw` | `secures_safety_with_draw` | 24 | Empate garante a permanência | Con un empate se salva | A draw keeps them up |
| `secures_safety_with_win` | `secures_safety_with_win` | 25 | Vitória garante a permanência | Si gana, se salva | A win keeps them up |
| `can_secure_safety` | `can_secure_safety` | 26 | Pode se salvar hoje | Puede salvarse hoy | Could stay up today |
| `safe_from_relegation` | `safe_from_relegation` | 52 | Livre do rebaixamento | A salvo del descenso | Safe from relegation |
| `mathematically_eliminated` | `mathematically_eliminated` | 30 | Já eliminado | Ya está eliminado | Already out |
| `eliminated_unless_wins` | `eliminated_unless_wins` | 31 | Precisa vencer | Necesita ganar | Must win |
| `eliminated_if_loses` | `eliminated_if_loses` | 32 | Não pode perder | No puede perder | Can't afford to lose |
| `can_be_eliminated` | `can_be_eliminated` | 33 | Pode ser eliminado hoje | Puede quedar afuera hoy | Could be knocked out today |
| `at_risk_of_elimination` | `at_risk_of_elimination` | 39 | Luta pela classificação | Pelea por clasificar | Fighting to go through |

## Códigos com zona

O texto depende do verbo (vaga garantida, pode garantir nesta rodada, ainda em disputa) e do grupo da
zona. Zonas de mata-mata da fase de liga (`round_of_16`, `knockout_playoff`, `playoff`) entram na faixa
`knockout`; vagas continentais e acesso, na faixa `qualification`. Zona fora da tabela usa o grupo
`generic`.

| Família | Código (exemplo) | `priority` | pt-BR | es-AR | en |
|---|---|---|---|---|---|
| **libertadores** | | | | | |
| `qualifies_for_zone` | `qualifies_for_libertadores_group_stage` | 46 | Garantido na Libertadores | Clasificado a la Libertadores | Libertadores spot secured |
| `clinches_zone_with_draw` | `clinches_libertadores_group_stage_with_draw` | 40 | Pode garantir a Libertadores | Puede asegurar la Libertadores | Can seal a Libertadores spot |
| `clinches_zone_with_win` | `clinches_libertadores_group_stage_with_win` | 40 | Pode garantir a Libertadores | Puede asegurar la Libertadores | Can seal a Libertadores spot |
| `can_clinch_zone` | `can_clinch_libertadores_group_stage` | 40 | Pode garantir a Libertadores | Puede asegurar la Libertadores | Can seal a Libertadores spot |
| `can_qualify_for_zone` | `can_qualify_for_libertadores_group_stage` | 43 | De olho na Libertadores | En carrera por la Libertadores | Chasing the Libertadores |
| **libertadores_qualifying** | | | | | |
| `qualifies_for_zone` | `qualifies_for_libertadores_qualifying` | 46 | Garantido na pré-Libertadores | En la previa de la Libertadores | In Libertadores qualifying |
| `clinches_zone_with_draw` | `clinches_libertadores_qualifying_with_draw` | 40 | Pode garantir a pré-Libertadores | Puede asegurar la fase previa | Can seal Libertadores qualifying |
| `clinches_zone_with_win` | `clinches_libertadores_qualifying_with_win` | 40 | Pode garantir a pré-Libertadores | Puede asegurar la fase previa | Can seal Libertadores qualifying |
| `can_clinch_zone` | `can_clinch_libertadores_qualifying` | 40 | Pode garantir a pré-Libertadores | Puede asegurar la fase previa | Can seal Libertadores qualifying |
| `can_qualify_for_zone` | `can_qualify_for_libertadores_qualifying` | 43 | De olho na Libertadores | En carrera por la Libertadores | Chasing the Libertadores |
| **sudamericana** | | | | | |
| `qualifies_for_zone` | `qualifies_for_sudamericana` | 47 | Garantido na Sul-Americana | Clasificado a la Sudamericana | Sudamericana spot secured |
| `clinches_zone_with_draw` | `clinches_sudamericana_with_draw` | 41 | Pode garantir a Sul-Americana | Puede asegurar la Sudamericana | Can seal a Sudamericana spot |
| `clinches_zone_with_win` | `clinches_sudamericana_with_win` | 41 | Pode garantir a Sul-Americana | Puede asegurar la Sudamericana | Can seal a Sudamericana spot |
| `can_clinch_zone` | `can_clinch_sudamericana` | 41 | Pode garantir a Sul-Americana | Puede asegurar la Sudamericana | Can seal a Sudamericana spot |
| `can_qualify_for_zone` | `can_qualify_for_sudamericana` | 44 | De olho na Sul-Americana | En carrera por la Sudamericana | Chasing the Sudamericana |
| **champions_league** | | | | | |
| `qualifies_for_zone` | `qualifies_for_champions_league` | 46 | Garantido na Champions | Clasificado a la Champions | Champions League spot secured |
| `clinches_zone_with_draw` | `clinches_champions_league_with_draw` | 40 | Pode garantir a Champions | Puede asegurar la Champions | Can seal a Champions spot |
| `clinches_zone_with_win` | `clinches_champions_league_with_win` | 40 | Pode garantir a Champions | Puede asegurar la Champions | Can seal a Champions spot |
| `can_clinch_zone` | `can_clinch_champions_league` | 40 | Pode garantir a Champions | Puede asegurar la Champions | Can seal a Champions spot |
| `can_qualify_for_zone` | `can_qualify_for_champions_league` | 43 | De olho na Champions | En carrera por la Champions | Chasing the Champions League |
| **champions_league_qualifying** | | | | | |
| `qualifies_for_zone` | `qualifies_for_champions_league_qualifying` | 46 | Garantido na pré-Champions | En la previa de la Champions | In Champions League qualifying |
| `clinches_zone_with_draw` | `clinches_champions_league_qualifying_with_draw` | 40 | Pode garantir a pré-Champions | Puede asegurar la fase previa | Can seal UCL qualifying |
| `clinches_zone_with_win` | `clinches_champions_league_qualifying_with_win` | 40 | Pode garantir a pré-Champions | Puede asegurar la fase previa | Can seal UCL qualifying |
| `can_clinch_zone` | `can_clinch_champions_league_qualifying` | 40 | Pode garantir a pré-Champions | Puede asegurar la fase previa | Can seal UCL qualifying |
| `can_qualify_for_zone` | `can_qualify_for_champions_league_qualifying` | 43 | De olho na Champions | En carrera por la Champions | Chasing the Champions League |
| **europa_league** | | | | | |
| `qualifies_for_zone` | `qualifies_for_europa_league` | 47 | Garantido na Europa League | Clasificado a la Europa League | Europa League spot secured |
| `clinches_zone_with_draw` | `clinches_europa_league_with_draw` | 41 | Pode garantir a Europa League | Puede asegurar la Europa League | Can seal a Europa League spot |
| `clinches_zone_with_win` | `clinches_europa_league_with_win` | 41 | Pode garantir a Europa League | Puede asegurar la Europa League | Can seal a Europa League spot |
| `can_clinch_zone` | `can_clinch_europa_league` | 41 | Pode garantir a Europa League | Puede asegurar la Europa League | Can seal a Europa League spot |
| `can_qualify_for_zone` | `can_qualify_for_europa_league` | 44 | De olho na Europa League | En carrera por la Europa League | Chasing the Europa League |
| **conference_league** | | | | | |
| `qualifies_for_zone` | `qualifies_for_conference_league` | 48 | Garantido na Conference | Clasificado a la Conference | Conference spot secured |
| `clinches_zone_with_draw` | `clinches_conference_league_with_draw` | 42 | Pode garantir a Conference | Puede asegurar la Conference | Can seal a Conference spot |
| `clinches_zone_with_win` | `clinches_conference_league_with_win` | 42 | Pode garantir a Conference | Puede asegurar la Conference | Can seal a Conference spot |
| `can_clinch_zone` | `can_clinch_conference_league` | 42 | Pode garantir a Conference | Puede asegurar la Conference | Can seal a Conference spot |
| `can_qualify_for_zone` | `can_qualify_for_conference_league` | 45 | De olho na Conference | En carrera por la Conference | Chasing the Conference League |
| **promotion** | | | | | |
| `qualifies_for_zone` | `qualifies_for_promotion` | 46 | Acesso garantido | Ascenso asegurado | Promotion secured |
| `clinches_zone_with_draw` | `clinches_promotion_with_draw` | 40 | Pode garantir o acesso | Puede asegurar el ascenso | Can seal promotion |
| `clinches_zone_with_win` | `clinches_promotion_with_win` | 40 | Pode garantir o acesso | Puede asegurar el ascenso | Can seal promotion |
| `can_clinch_zone` | `can_clinch_promotion` | 40 | Pode garantir o acesso | Puede asegurar el ascenso | Can seal promotion |
| `can_qualify_for_zone` | `can_qualify_for_promotion` | 43 | De olho no acesso | En carrera por el ascenso | Chasing promotion |
| **round_of_16** | | | | | |
| `qualifies_for_zone` | `qualifies_for_round_of_16` | 36 | Garantido nas oitavas | Clasificado a octavos | Through to the last 16 |
| `clinches_zone_with_draw` | `clinches_round_of_16_with_draw` | 30 | Pode garantir as oitavas | Puede asegurar los octavos | Can seal a last-16 spot |
| `clinches_zone_with_win` | `clinches_round_of_16_with_win` | 30 | Pode garantir as oitavas | Puede asegurar los octavos | Can seal a last-16 spot |
| `can_clinch_zone` | `can_clinch_round_of_16` | 30 | Pode garantir as oitavas | Puede asegurar los octavos | Can seal a last-16 spot |
| `can_qualify_for_zone` | `can_qualify_for_round_of_16` | 33 | De olho nas oitavas | En carrera por los octavos | Chasing the last 16 |
| **knockout_playoff** | | | | | |
| `qualifies_for_zone` | `qualifies_for_knockout_playoff` | 37 | Garantido nos playoffs | Clasificado al repechaje | Into the playoffs |
| `clinches_zone_with_draw` | `clinches_knockout_playoff_with_draw` | 31 | Pode garantir os playoffs | Puede asegurar el repechaje | Can seal a playoff spot |
| `clinches_zone_with_win` | `clinches_knockout_playoff_with_win` | 31 | Pode garantir os playoffs | Puede asegurar el repechaje | Can seal a playoff spot |
| `can_clinch_zone` | `can_clinch_knockout_playoff` | 31 | Pode garantir os playoffs | Puede asegurar el repechaje | Can seal a playoff spot |
| `can_qualify_for_zone` | `can_qualify_for_knockout_playoff` | 34 | De olho nos playoffs | En carrera por el repechaje | Chasing a playoff spot |
| **playoff** | | | | | |
| `qualifies_for_zone` | `qualifies_for_playoff` | 37 | Garantido nos playoffs | Clasificado a los playoffs | Into the playoffs |
| `clinches_zone_with_draw` | `clinches_playoff_with_draw` | 31 | Pode garantir os playoffs | Puede asegurar los playoffs | Can seal a playoff spot |
| `clinches_zone_with_win` | `clinches_playoff_with_win` | 31 | Pode garantir os playoffs | Puede asegurar los playoffs | Can seal a playoff spot |
| `can_clinch_zone` | `can_clinch_playoff` | 31 | Pode garantir os playoffs | Puede asegurar los playoffs | Can seal a playoff spot |
| `can_qualify_for_zone` | `can_qualify_for_playoff` | 34 | De olho nos playoffs | En carrera por los playoffs | Chasing a playoff spot |
| **generic** | | | | | |
| `qualifies_for_zone` | `qualifies_for_zona_desconhecida` | 48 | Vaga garantida | Lugar asegurado | Spot secured |
| `clinches_zone_with_draw` | `clinches_zona_desconhecida_with_draw` | 42 | Pode garantir a vaga | Puede asegurar su lugar | Can seal a spot |
| `clinches_zone_with_win` | `clinches_zona_desconhecida_with_win` | 42 | Pode garantir a vaga | Puede asegurar su lugar | Can seal a spot |
| `can_clinch_zone` | `can_clinch_zona_desconhecida` | 42 | Pode garantir a vaga | Puede asegurar su lugar | Can seal a spot |
| `can_qualify_for_zone` | `can_qualify_for_zona_desconhecida` | 45 | Briga por vaga | Pelea por un lugar | Chasing a spot |
