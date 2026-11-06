# 2026-10-31: jogos do plano do ao vivo de 10 a 40 min sem atualização

> Postmortem sem culpados: descreve o sistema e as decisões que ele permitiu, não quem apertou o botão.
> Toda afirmação aponta para a fonte (commit, PR, release, issue, consulta ao Prometheus ou ao banco). O que é
> inferência ou hipótese diz que é.

| Campo | Valor |
|---|---|
| Estado | **mitigado**: o SLI voltou ao normal em 02/11 com um plano menor, mas o mecanismo (jogo que o fornecedor ainda dá como não iniciado tratado como "saiu do ao vivo") segue no código, e o `ErrorBudgetExhausted` ([#482](https://github.com/galaxie-works/galaxie-sports/issues/482)) segue disparando até os dias ruins saírem da janela |
| Severidade | SEV2: o ao vivo ficou degradado em parte dos jogos; a API e os outros jogos seguiram respondendo |
| Início / fim (UTC) | 2026-10-31 15:11 → 2026-11-02 18:55 (o grosso em 31/10 e 01/11; um ensaio menor em 30/10, 15:18 a 16:55) |
| Duração do impacto | 7 h 52 min de minutos ruins no SLI (944 amostras de 30 s): 3 h 40 min em 31/10, 4 h 06 min em 01/11, 5 min em 02/11 |
| SLO afetado | `ao-vivo` ([docs/14](../14-slos-e-error-budget.md)): erro de 28 dias chegou a 14,15% contra 1% permitido |
| Detectado por | alerta `LiveEventStale` (push crítico, sinal `ao-vivo`), 46 min depois do primeiro minuto ruim |
| PRs ligados | ajuste do painel (01/11, sem PR), [#514](https://github.com/galaxie-works/galaxie-sports/pull/514), [#524](https://github.com/galaxie-works/galaxie-sports/pull/524), [#570](https://github.com/galaxie-works/galaxie-sports/pull/570), [#583](https://github.com/galaxie-works/galaxie-sports/pull/583), [#589](https://github.com/galaxie-works/galaxie-sports/pull/589), [#590](https://github.com/galaxie-works/galaxie-sports/pull/590), [#646](https://github.com/galaxie-works/galaxie-sports/pull/646) |

## Resumo

No fim de semana de 31/10 e 01/11, o SLI do `ao-vivo` marcou 7 h 52 min de minutos ruins, cerca de duas vezes o
orçamento de 28 dias inteiro (estimativa abaixo). O SLI marca o minuto como ruim quando **algum** jogo do plano do ao
vivo passa de 10 min sem atualização válida. O orçamento medido pela regra chegou a −13,15 (gasto de 14 vezes o
permitido), porque a janela ainda tinha só 3 dias de dados.

O processo do ao vivo não parou: o `live-run` rodou o dia inteiro com um tick a cada ~15 s, e os jogos que estavam em
campo voltaram em todo tick, com duas exceções. Os jogos que pararam eram jogos que o fornecedor **nunca trouxe** no
`fixtures?live=`: na consulta de detalhe ele os dava como não iniciados (`NS`). O relógio do nosso lado os tinha posto
em andamento no horário do apito. O poller tratou cada um como jogo que saiu do ao vivo e buscou o detalhe com a espera
da confirmação de resultado (0, 1, 2, 5, 10, 20 e 30 min, até 7 vezes). Os intervalos de 20 e 30 min entre essas buscas
passam do limite de 10 min e viraram os trechos ruins. Ver [Causa raiz](#causa-raiz). A hipótese levantada durante a
operação, de o ao vivo ficar sem vez para rodar atrás dos jobs de pós-jogo, está descartada pelos dados.

A mitigação foi um ajuste no painel em 01/11 às 23:36 UTC: `LIVE_MIN_PRIORITY` foi de `low` (o valor do `.env`) para
`medium`, o que tira do plano do ao vivo as ligas de prioridade baixa, onde estavam 8 dos 13 jogos que responderam
`NS`. O futebol dessas ligas passou para o pós-jogo em `tempo-real` a cada 2 min. Desde então o plano teve de 10 a 22
jogos no pico do dia, contra 47 e 35 no fim de semana, e o SLI ficou entre 0 e 10 amostras ruins por dia. Em seguida, o
ao vivo saiu do ingestor para um serviço próprio com líder e reserva (#555: #570, #589, #590), e a regra do
`ErrorBudgetExhausted` deixou de fechar e reabrir a issue a cada deploy (#583). Nenhuma dessas mudanças tira o
mecanismo do poller, e as ligas `medium` também tiveram jogos assim.

## Impacto

- **Quem sentiu:** quem abriu, pela API, pelos widgets ou pela demo, um dos 13 jogos do plano (7 em 31/10, 6 em
  01/11) que o fornecedor ainda dava como não iniciados: ele aparecia em andamento pelo relógio, sem placar do
  fornecedor. Hoje 12 deles estão como `finished` (os 3 conferidos, pelo relógio: `status_source = temporal`) e 1 como
  adiado (consulta ao `raw.api_response` e ao `core.event`, só leitura). Os jogos que estavam em campo tiveram o placar em dia, com duas
  exceções em 31/10: um sumiu da lista por 101 min (15:43 a 17:25) e outro por 19 min (21:53 a 22:12). Não há medida de
  quantas requisições serviram esses jogos.
- **Quanto:** o pior jogo do plano ficou até 2.376 s (39,6 min) sem atualização, entre 31/10 23:00 e 01/11 01:00 UTC. Os
  trechos ruins duraram 10, 20 ou 30 min (múltiplos de 10 min), com picos de atraso de ~1.775 s nas noites de 31/10 e
  01/11 (consulta `max_over_time(max(galaxie_live_event_max_staleness_seconds{coverage="poller"})[1h:30s])`).
- **Fora do impacto:** os jogos fora do plano (cobertura `clock`, fechados pelo pós-jogo e pela agenda) não entram no
  SLI. A API e o SLO `api-*` não registraram falha ligada a este incidente.

### Amostras ruins de `slo:ao_vivo:ok` por dia UTC

Cada amostra vale 30 s, e só existe amostra em minuto com jogo do plano em andamento. Consulta:
`count_over_time(slo:ao_vivo:ok[1d]) - sum_over_time(slo:ao_vivo:ok[1d])` no fim de cada dia.

| Dia | Ruins | Total | Tempo ruim | Fração ruim |
|---|---:|---:|---:|---:|
| 29/10 (regras no ar às 17:20 UTC) | 0 | 803 | 0 | 0% |
| 30/10 | 16 | 1.729 | 8 min | 0,9% |
| 31/10 | 441 | 2.209 | 3 h 40 min | 20,0% |
| 01/11 | 493 | 2.223 | 4 h 06 min | 22,2% |
| 02/11 | 10 | 1.565 | 5 min | 0,6% |
| 03/11 | 1 | 1.140 | 30 s | 0,1% |
| 04/11 | 6 | 1.361 | 3 min | 0,4% |
| 05/11 | 0 | 1.192 | 0 | 0% |

### Quanto do orçamento foi gasto

- **Medido pela regra:** `slo:error_budget_remaining:ratio{slo="ao-vivo"}` caiu para −13,15 em 01/11 às 22:00 UTC
  (erro de 28 dias de 14,15%). Em 06/11 às 04:20 UTC estava em −6,6 (erro de 7,6%). A regra lê a média do que existe na
  janela, e as séries do SLO só começaram em 29/10 às 17:20 UTC: com 3 dias de dados, o gasto parece 14 vezes o
  orçamento.
- **Estimado para uma janela cheia de 28 dias** (inferência): a média de 30/10 a 05/11 foi de 1.631 amostras por dia, o
  que dá ~45.700 amostras em 28 dias e um orçamento de ~457 amostras (~3 h 48 min). As 944 amostras ruins de 31/10 a
  02/11 são **~2 vezes o orçamento inteiro**. A política pede postmortem a partir de 20%.

## Linha do tempo

UTC e horário de Brasília (UTC−3). O README pede UTC; a coluna de Brasília está aqui porque as issues automáticas dos
alertas escrevem a hora de Brasília.

| UTC | Brasília | Evento | Fonte |
|---|---|---|---|
| 28/10 20:14 | 28/10 17:14 | A faixa do ao vivo passa a não esperar o teto de jobs simultâneos do scheduler (`SCHEDULER_MAX_JOBS`) | [#400](https://github.com/galaxie-works/galaxie-sports/pull/400), commit `9d080b3d` |
| 29/10 17:20 | 29/10 14:20 | Primeira amostra de `slo:ao_vivo:ok`: começa a janela do SLO | Prometheus, `min_over_time(timestamp(slo:ao_vivo:ok)[30d:5m])` |
| 30/10 03:49 | 30/10 00:49 | Job `postgame-close` (a cada minuto) entra para fechar os jogos fora do ao vivo | [#458](https://github.com/galaxie-works/galaxie-sports/pull/458) |
| 30/10 13:26 | 30/10 10:26 | Pós-jogo com uma execução por esporte | [#465](https://github.com/galaxie-works/galaxie-sports/pull/465) |
| 30/10 15:28 | 30/10 12:28 | Último deploy publicado antes do incidente (`83e493c1`). A espera por jogo ao vivo no deploy segura todos os seguintes até 02/11 | release `deploy-2026-10-30.9`, [#524](https://github.com/galaxie-works/galaxie-sports/pull/524) |
| 30/10 15:18–16:55 | 30/10 12:18–13:55 | Ensaio menor: 16 amostras ruins, de 2 em 2, a cada 11 a 15 min | Prometheus, `slo:ao_vivo:ok` |
| 31/10 15:11 | 31/10 12:11 | Primeira amostra ruim do incidente; até 15:45, blocos de 1 min a cada ~11 min | Prometheus |
| 31/10 15:55 | 31/10 12:55 | Primeiro trecho longo (10 min) | Prometheus |
| 31/10 15:57 | 31/10 12:57 | `LiveEventStale` abre a [#476](https://github.com/galaxie-works/galaxie-sports/issues/476) (push crítico) | issue |
| 31/10 16:02 | 31/10 13:02 | `SloBurnRateFast` dispara (issue [#477](https://github.com/galaxie-works/galaxie-sports/issues/477) às 16:03) | `ALERTS{slo="ao-vivo"}`, issue |
| 31/10 16:06 | 31/10 13:06 | `ErrorBudgetExhausted` fica pendente (`for: 1h` na regra de então) | `ALERTS{alertstate="pending"}` |
| 31/10 16:17 | 31/10 13:17 | `SloBurnRateSlow` dispara (issue [#479](https://github.com/galaxie-works/galaxie-sports/issues/479)) | `ALERTS`, issue |
| 31/10 17:06 | 31/10 14:06 | `ErrorBudgetExhausted` dispara; issue [#482](https://github.com/galaxie-works/galaxie-sports/issues/482) às 17:07 | `ALERTS{alertstate="firing"}`, issue |
| 31/10 17:38 | 31/10 14:38 | `JobFailingRepeatedly job=recap-run` ([#483](https://github.com/galaxie-works/galaxie-sports/issues/483)): o resumo pós-jogo (IA) estoura o tempo limite de 15 min seis vezes entre 14:55 e 18:05 | issue, `ops.job_run` |
| 31/10 18:54 → 01/11 01:55 | 31/10 15:54 → 31/10 22:55 | Trechos de 10, 20 e 30 min seguidos; o dia chega a 47 jogos no plano | Prometheus |
| 31/10 23:00 → 01/11 01:00 | 31/10 20:00 → 22:00 | Pior atraso: 2.376 s (39,6 min) | Prometheus |
| 01/11 02:51 | 31/10 23:51 | Última amostra ruim da noite | Prometheus |
| 01/11 11:10 → 12:55 | 01/11 08:10 → 09:55 | Segunda onda | Prometheus |
| 01/11 17:41 → 21:55 | 01/11 14:41 → 18:55 | Terceira onda | Prometheus |
| 01/11 21:57 | 01/11 18:57 | Fecha a [#513](https://github.com/galaxie-works/galaxie-sports/issues/513), a 26ª issue do `LiveEventStale` desde 31/10 | issue |
| 01/11 22:00 | 01/11 19:00 | Pior ponto do orçamento: −13,15 (erro de 28 dias de 14,15%) | `slo:error_budget_remaining:ratio` |
| 01/11 23:36:40 | 01/11 20:36:40 | **Mitigação no painel:** `LIVE_MIN_PRIORITY` `medium` (o `.env` tem `low`), `POSTGAME_FOOTBALL` `tempo-real`, `POSTGAME_FOOTBALL_MIN` 2, `POSTGAME_MAX_CALLS_DAY` 400 | `ops.runtime_setting_log` |
| 02/11 00:50 | 01/11 21:50 | Alerta repetido passa a reabrir a mesma issue, com diagnóstico só leitura no comentário | [#514](https://github.com/galaxie-works/galaxie-sports/pull/514) |
| 02/11 ~05:11 | 02/11 ~02:11 | Primeiro deploy desde 30/10 (`ec8a902f`, com `force=1`) | inferido: contêineres "Up 16 minutes" no diagnóstico de 05:27 na #482; [#524](https://github.com/galaxie-works/galaxie-sports/pull/524) |
| 02/11 05:18 | 02/11 02:18 | #482 fecha pela primeira vez; reabre às 05:27. Até 03/11 08:57 ela dispara 20 vezes e fecha 19 | comentários da #482 |
| 02/11 12:09 | 02/11 09:09 | Deploy deixa de esperar jogo ao vivo | [#524](https://github.com/galaxie-works/galaxie-sports/pull/524) |
| 02/11 18:11–18:55 | 02/11 15:11–15:55 | Últimas 10 amostras ruins do incidente, de 2 em 2 | Prometheus |
| 02/11 18:26 | 02/11 15:26 | Épico do ao vivo separado aberto | [#555](https://github.com/galaxie-works/galaxie-sports/issues/555) |
| 02/11 22:02 | 02/11 19:02 | Líder e reserva no `live-run` (desligado até o serviço `live`) | [#570](https://github.com/galaxie-works/galaxie-sports/pull/570) |
| 03/11 05:01 | 03/11 02:01 | Métricas do ritmo, `LiveTickGap` e revisão da regra do #482 (grupo de 30 s, sem `for`) | [#583](https://github.com/galaxie-works/galaxie-sports/pull/583) |
| 03/11 07:55 / 08:16 | 03/11 04:55 / 05:16 | Serviço `live` fora do ingestor; duas cópias com troca cópia a cópia | [#589](https://github.com/galaxie-works/galaxie-sports/pull/589), [#590](https://github.com/galaxie-works/galaxie-sports/pull/590) |
| 03/11 ~08:40 | 03/11 ~05:40 | Serviço `live` no ar com duas cópias; deploy do projeto obs para o Prometheus achar as cópias | release `deploy-2026-11-03.6`, nota de handover da operação |
| 03/11 08:57 | 03/11 05:57 | Última reabertura da #482 (20ª); ela segue aberta e o alerta segue disparando | comentários da #482 |
| 05/11 14:59 | 05/11 11:59 | Teto do pós-jogo aumentado e intervalo de 15 min para data sem jogo em campo: o teto de 01/11 acabava de madrugada | `ops.runtime_setting_log`, [#646](https://github.com/galaxie-works/galaxie-sports/pull/646) |

## Causa raiz

### O que os dados mostram (fato)

1. **O processo do ao vivo rodou o tempo todo.** Em `ops.job_run`, o `live:run` de 31/10 foi de 10:40 a 05:21 do dia
   seguinte com 4.412 ticks, e o de 01/11, de 10:40 a 04:55 com 4.280 ticks: ~15,2 s e ~15,4 s por tick, o intervalo
   planejado (`galaxie_live_scheduler_interval_seconds` = 15). Um erro de tick em cada um.
2. **Os jobs de pós-jogo não seguravam o ao vivo.** Desde o [#400](https://github.com/galaxie-works/galaxie-sports/pull/400)
   (28/10), a faixa do ao vivo não espera o teto de jobs simultâneos (`live: true` em `schedule.ts`, conferido no
   commit `83e493c1`, a versão que rodava). O `postgame-close` rodou 60 vezes por hora, com 4 a 6 s cada.
3. **Os jogos em campo voltavam no tick.** Dos 132 jogos que apareceram no `fixtures?live=` entre 31/10 14:00 e 01/11
   03:00, só 2 tiveram buraco de mais de 2 min na lista (os dois citados em Impacto).
4. **Os jogos que pararam nunca entraram na lista e respondiam `NS`.** No detalhe (`fixtures?id=`) pedido pelo
   `live:run`, 13 jogos do plano das duas datas responderam `NS`, a primeira vez no minuto do apito e, em 12 deles, 7
   vezes até ~94 min depois. A última resposta de cada um bate com o fim de um trecho ruim: 16:35:15 (trecho até 16:35),
   19:34:12 (até 19:34), 21:49:10 (até 21:49) e 01:28:14 (até 01:28) na noite de 31/10; 12:34:20 (até 12:34), 19:03:08
   (até 19:04), 19:34:11 (até 19:34) e 21:34:23 (até 21:34:30) em 01/11.
5. **Ligas de prioridade baixa e média.** Dos 13 jogos, 8 eram de ligas `low` e 5 de ligas `medium`.
6. **O incidente acompanhou o tamanho do plano.** Pico de jogos no plano por dia: 47 (31/10), 35 (01/11), 12 (02/11),
   11 (03/11), 10 (04/11), 22 (05/11). O `.env` da VPS tem hoje `LIVE_MIN_PRIORITY=low`, e o log do painel mostra que
   não havia sobrescrita antes de 01/11 23:36 (`old_value` vazio): o ao vivo seguia o `low` do `.env` (supondo que essa
   chave do `.env` não mudou desde então). O ajuste para `medium` tirou do plano as ligas de prioridade baixa.

### O mecanismo (código em `83e493c1`, igual na `main` hoje)

- O `events-clock` põe o jogo em andamento pelo horário (`status_source = temporal`), e o Live Scheduler o mantém no
  plano.
- No tick, o `LivePoller` chama de `vanished` todo jogo em andamento do plano, de liga pedida no tick, que não veio no
  `fixtures?live=`, e busca o detalhe dele na hora, dentro do orçamento reservado para confirmar resultados
  ([`live/poller.ts`](../../services/ingestor/src/live/poller.ts), `const vanished`). O espaçamento entre essas buscas
  é o da confirmação de resultado, `FINALIZE_BACKOFF_MS` = 0, 1, 2, 5, 10, 20 e 30 min, com até 7 tentativas. Foi feito
  para o jogo que acabou e demora a virar FT, não para o que ainda não começou.
- Cada resposta `NS` conta como atualização: os trechos ruins terminam no instante da última resposta (fato 4). Isso é
  inferência pelo encaixe dos horários; o caminho exato no `core-writer` não foi relido. Entre a 5ª e a 6ª busca (20
  min) e entre a 6ª e a 7ª (30 min), o jogo passa do limite de 10 min, e o minuto conta como ruim: daí os trechos de 10
  e 20 min. Depois da 7ª, só sobram o `live-reconcile`, que só busca jogo parado há 30 min ou mais
  ([`live/reconcile.ts`](../../services/ingestor/src/live/reconcile.ts), `DEFAULT_STALE_MINUTES`), e o relógio, que
  fecha o jogo.
- Não foi reconstruída a sequência exata das buscas de cada jogo: o `raw` guarda uma linha por resposta diferente (com
  `seen_count` e `last_seen_at`), e as respostas `NS` de um jogo eram idênticas. A soma das esperas dá ~68 min, e a
  última resposta veio ~94 min depois da primeira; a diferença não foi explicada (a reconciliação pode ter feito uma
  das chamadas). Também ficam sem dono alguns trechos de 10 min que não batem com nenhum jogo da lista do fato 4.
- Os blocos de 1 min a cada ~11 min (31/10 18:11, 19:10 e 21:11; 01/11 20:41 e 21:40) batem com jogos de ligas
  `medium` que só entraram no `fixtures?live=` 10 a 11 min depois do apito.

### Hipóteses descartadas

- **"O ao vivo ficava sem vez para rodar atrás dos jobs de pós-jogo."** Foi a leitura durante a operação, e o ajuste do
  painel mexeu nas duas coisas juntas (prioridade do ao vivo e pós-jogo do futebol). Nenhum PR descreve esse mecanismo,
  e os fatos 1 a 4 mostram o processo no ritmo, o pós-jogo leve, os jogos em campo em dia e os jogos parados fora da
  lista do fornecedor. O ajuste deu certo, pelo que os dados indicam, porque tirou do plano as ligas de 8 dos 13 jogos.
- **"Jogo omitido do `fixtures?live=` só atualiza pela reconciliação, em blocos de 10 min"** (versão anterior deste
  documento). Errada nos dois pontos: o poller busca o detalhe do jogo omitido na hora, e a reconciliação só pega jogo
  parado há 30 min ou mais. Apontado na revisão do PR.

### Fatores que contribuíram (fato)

- **O plano conta jogo que o fornecedor não começou.** O relógio põe o jogo em andamento no apito, e o SLI e o
  `LiveEventStale` contam esse jogo como parado mesmo com o fornecedor dando `NS`. O `raw` não diz por que a fonte não
  o começou: atraso, adiamento ou liga sem ao vivo na fonte são as possibilidades.
- **Configuração em dois lugares.** `LIVE_MIN_PRIORITY=low` no `.env` contra `medium` no painel e no padrão do registro
  (`packages/runtime-config/src/registry.ts`). Se a sobrescrita do painel for apagada, o plano grande volta.
- **Deploys travados de 30/10 a 02/11.** A espera por jogo ao vivo reiniciava a cada merge; a produção ficou em
  `83e493c1` e nenhuma correção de código podia chegar durante o fim de semana ([#524](https://github.com/galaxie-works/galaxie-sports/pull/524)).
- **Ruído de alerta.** Antes do #514, cada oscilação do `LiveEventStale` abria uma issue nova: 26 issues entre 31/10
  15:57 e 01/11 21:57, mais 8 do `SloBurnRateFast` e 2 do `SloBurnRateSlow`. Todas só com comentários do robô.
- **O runbook não cobria o caso.** Para o sinal `ao-vivo`, o [on-call](../runbooks/on-call.md) manda ver se o
  `live-run` está rodando e se a cota LIVE acabou. As duas respostas eram "sim, tudo certo" neste incidente.

## Detecção

- **O que avisou:** o `LiveEventStale` (push crítico) às 15:57 de 31/10, 46 min depois da primeira amostra ruim e 2 min
  depois do primeiro trecho longo. As queimas (`SloBurnRateFast` às 16:02, `SloBurnRateSlow` às 16:17) e o
  `ErrorBudgetExhausted` (17:06) foram para o resumo diário, como previsto em docs/14.
- **Quanto até alguém agir:** o primeiro registro de ação de pessoa é o ajuste do painel, 01/11 às 23:36, ~32 h depois
  do primeiro push. As issues não têm comentário de pessoa. A entrega do push no celular não foi conferida.
- **A issue do orçamento abriu e fechou 20 vezes.** A [#482](https://github.com/galaxie-works/galaxie-sports/issues/482)
  disparou 20 vezes (a abertura e 19 reaberturas) e fechou 19, de 02/11 05:18 a 03/11 08:57, sempre com 5 a 11 min
  entre "resolvido" e "disparou de novo". No Prometheus, o `ALERTS{alertname="ErrorBudgetExhausted"}` ficou `firing`
  o tempo todo nesses dias, com buracos. A causa provável, descrita no #583 e em docs/14: cada deploy reinicia o
  Prometheus, o alerta com `for: 1h` volta como pendente, o `ALERTS` que o Grafana lê some por mais que a tolerância da
  consulta, e a issue fecha e reabre. É hipótese lida nas regras e nos horários, não conferida na VPS. A última
  reabertura foi em 03/11 08:57; depois dela houve mais 10 deploys no dia e a issue não reabriu, o que é coerente
  com o #583 (o projeto obs, que leva as regras, foi publicado por volta das 08:40, pela nota de handover).
- **O que faltou:** uma métrica por jogo (quantos jogos parados, quais ligas, e se o fornecedor já os começou) e o
  atraso do placar desde a fonte (`galaxie_live_score_lag_seconds`, proposta de docs/14). O SLI diz que algum jogo
  parou, não quantos nem por quê, e não separa o jogo em campo sem atualização do jogo que a fonte ainda não começou.

## Mitigação e correção

- **Mitigação (01/11 23:36 UTC, painel, sem PR):** `LIVE_MIN_PRIORITY=medium`, com o futebol abaixo disso no pós-jogo
  `tempo-real` a cada 2 min. Efeito medido: plano menor e SLI quase limpo desde 02/11 (tabela acima). Funcionou porque 8 dos 13 jogos `NS` eram
  de ligas `low` (fato 5); as `medium` seguem expostas. Efeito
  colateral: o teto diário do pós-jogo passou a acabar de madrugada a partir de 02/11, e as ligas baixas ficavam sem
  placar até a agenda D-1. Corrigido em 05/11 pelo painel e pelo [#646](https://github.com/galaxie-works/galaxie-sports/pull/646).
- **Correção estrutural (03/11):** ao vivo fora do ingestor, num serviço `live` com líder e reserva e troca cópia a
  cópia ([#555](https://github.com/galaxie-works/galaxie-sports/issues/555): [#570](https://github.com/galaxie-works/galaxie-sports/pull/570),
  [#589](https://github.com/galaxie-works/galaxie-sports/pull/589), [#590](https://github.com/galaxie-works/galaxie-sports/pull/590)).
  Os PRs dizem que o objetivo é o deploy não cortar o placar. Eles não mexem no tratamento do jogo `NS` e não
  corrigem este incidente.
- **Correção da causa:** ainda não existe. Está nas ações propostas.
- **Detecção (02 e 03/11):** a mesma issue reabre com diagnóstico ([#514](https://github.com/galaxie-works/galaxie-sports/pull/514));
  `LiveTickGap` e o ritmo do tick no SLI; `ErrorBudgetExhausted` sem `for`, num grupo de 30 s ([#583](https://github.com/galaxie-works/galaxie-sports/pull/583)).
- **Deploy (02/11):** sem espera por jogo ao vivo ([#524](https://github.com/galaxie-works/galaxie-sports/pull/524)).

### Quando o `ErrorBudgetExhausted` deve resolver

O alerta segue disparando enquanto o erro de 28 dias passar de 1%. Os dias ruins pesam demais para a média cair só com
dias bons (seriam ~60 dias de dados limpos), então ele resolve quando 31/10 e 01/11 saírem da janela:

- **Com a retenção de hoje (15 dias):** o Prometheus apaga 31/10 a partir de 15/11 e 01/11 a partir de 16/11, com
  até um dia de atraso porque apaga blocos inteiros. Sobram 17 amostras ruins (02 a 04/11), bem abaixo de 1%. Fim por volta de
  **17/11**.
- **Com a retenção de 35 dias** ([#654](https://github.com/galaxie-works/galaxie-sports/pull/654), aberto): quem manda
  é a janela de 28 dias. A última amostra ruim de 01/11 (21:55 UTC) sai da janela em 29/11 por volta das 22:00 UTC. Fim
  por volta de **30/11**, desde que a retenção nova entre antes de 15/11; se entrar depois, 31/10 já terá sido apagado e
  o fim fica entre as duas datas.

Pela política de docs/14, com o orçamento abaixo de zero ficam congeladas as features do componente `ao-vivo` até o
orçamento voltar a ser positivo **e** a correção da causa principal estar no ar. Como a correção do poller ainda não
existe e o orçamento só volta com a janela, a saída antes de 17/11 ou 30/11 depende de exceção do dono.

## O que deu certo

- O processo do ao vivo seguiu no ritmo planejado o fim de semana inteiro, os jogos em campo ficaram em dia (com duas
  exceções), e o resto da API não foi afetado.
- O `raw.api_response` guardou as respostas do fornecedor e permitiu achar o mecanismo dias depois, só com leitura.
- O `LiveEventStale` disparou 2 min depois do primeiro trecho longo, e o SLI separou bem o minuto ruim do bom.
- O painel permitiu mitigar sem deploy, num momento em que deploy nenhum chegava à produção, e cada mudança ficou
  registrada em `ops.runtime_setting_log` com hora e valor anterior.
- A semana seguinte transformou o incidente em trabalho de confiabilidade: deploy sem espera, ao vivo separado,
  diagnóstico automático na issue e regra do orçamento sem reabrir.

## O que deu errado

- ~32 h entre o primeiro push crítico e a primeira ação registrada, com 26 issues abertas e fechadas sozinhas.
- O runbook do sinal `ao-vivo` não tinha um passo para "processo no ritmo, jogo parado".
- A configuração que decidiu o tamanho do plano estava no `.env` (`low`), diferente do padrão do registro (`medium`), e
  ninguém olhava esse valor.
- Os deploys estavam travados pela espera por jogo ao vivo, e o deploy "verde" não dizia isso.
- A issue do orçamento fechou e reabriu 19 vezes por causa da regra, não do ao vivo, o que tirou crédito do alerta.
- A mitigação levou o pós-jogo a gastar o teto do dia de madrugada, e isso só foi visto em 05/11.
- A causa foi atribuída ao pós-jogo sem olhar o `raw`, e a correção estrutural da semana mira outro problema (o
  deploy cortando o placar). O mecanismo do poller segue no código.
- O SLI e o alerta mediram como "parado" o jogo que a fonte ainda não tinha começado.

## Ações

Nenhuma issue nova foi aberta por este postmortem. As marcadas "proposta" esperam o dono.

| Ação | Tipo | Estado | Onde |
|---|---|---|---|
| Ajuste do painel: `LIVE_MIN_PRIORITY=medium`, futebol baixo no pós-jogo `tempo-real` | mitiga | feito | `ops.runtime_setting_log`, 01/11 23:36 UTC |
| Teto do pós-jogo e intervalo de 15 min sem jogo em campo | corrige (efeito da mitigação) | feito | [#646](https://github.com/galaxie-works/galaxie-sports/pull/646) |
| Deploy sem espera por jogo ao vivo | previne | feito | [#524](https://github.com/galaxie-works/galaxie-sports/pull/524) |
| Ao vivo em serviço próprio, com líder, reserva e troca cópia a cópia | previne | feito | [#555](https://github.com/galaxie-works/galaxie-sports/issues/555), [#570](https://github.com/galaxie-works/galaxie-sports/pull/570), [#589](https://github.com/galaxie-works/galaxie-sports/pull/589), [#590](https://github.com/galaxie-works/galaxie-sports/pull/590) |
| Alerta repetido reabre a mesma issue, com diagnóstico só leitura | detecta | feito | [#514](https://github.com/galaxie-works/galaxie-sports/pull/514) |
| `LiveTickGap`, ritmo do tick no SLI e `ErrorBudgetExhausted` sem `for` | detecta | feito | [#583](https://github.com/galaxie-works/galaxie-sports/pull/583) |
| Retenção do Prometheus em 35 dias, para a janela de 28 dias valer inteira | detecta | aberto | [#654](https://github.com/galaxie-works/galaxie-sports/pull/654) |
| Fechar a #482 quando o alerta resolver (~17/11, ou ~30/11 com o #654) | — | aberto | [#482](https://github.com/galaxie-works/galaxie-sports/issues/482) |
| Poller: jogo do plano que nunca apareceu no `fixtures?live=` e responde `NS` no detalhe não usa a espera da confirmação de resultado; segue conferido num ritmo próprio, curto, até começar, ser adiado ou sair do plano | corrige | proposta | issue a abrir |
| SLI e `LiveEventStale`: separar o jogo que o fornecedor ainda dá como não iniciado do jogo em campo sem atualização, e decidir com o dono qual dos dois gasta orçamento | corrige | proposta (dono) | issue a abrir |
| Conferir no `core-writer` que a resposta `NS` de um jogo posto em andamento pelo relógio grava `last_valid_at` (a inferência do fato 4) e decidir se deve | corrige | proposta | issue a abrir |
| Alinhar o `.env` da VPS (`LIVE_MIN_PRIORITY=low`) com o painel, ou registrar por que o painel manda | previne | proposta | issue a abrir |
| Medir num fim de semana com o plano cheio (o primeiro desde o serviço `live`): amostras ruins, jogos no plano, `live_tick_interval_max_seconds` | detecta | proposta | issue a abrir |
| Métrica por jogo: quantos jogos do plano estão parados e de quais ligas; histograma do atraso do placar (`galaxie_live_score_lag_seconds`, docs/14) | detecta | proposta | issue a abrir |
| Runbook do sinal `ao-vivo`: passo para "`live-run` no ritmo, jogo parado" (diagnóstico da issue, se o jogo está no `fixtures?live=`, reduzir o plano pelo painel) | mitiga | proposta | issue a abrir |
| Rever os outros alertas com `for` longo (`DiskFillingUp`, `DatabaseGrowingFast`, `RestoreDrillStale`), que reabrem do mesmo jeito depois de reiniciar o Prometheus | detecta | proposta | issue a abrir |
| Decidir a exceção da política de orçamento para o componente `ao-vivo` até a janela limpar | — | proposta (dono) | docs/14 |

## Fontes

- Issues dos alertas: `LiveEventStale` [#476](https://github.com/galaxie-works/galaxie-sports/issues/476) a [#513](https://github.com/galaxie-works/galaxie-sports/issues/513) (26 issues), `SloBurnRateFast` [#477](https://github.com/galaxie-works/galaxie-sports/issues/477) a [#506](https://github.com/galaxie-works/galaxie-sports/issues/506) (8), `SloBurnRateSlow` [#479](https://github.com/galaxie-works/galaxie-sports/issues/479) e [#501](https://github.com/galaxie-works/galaxie-sports/issues/501), `ErrorBudgetExhausted` [#482](https://github.com/galaxie-works/galaxie-sports/issues/482), `JobFailingRepeatedly job=recap-run` [#483](https://github.com/galaxie-works/galaxie-sports/issues/483).
- PRs: [#400](https://github.com/galaxie-works/galaxie-sports/pull/400), [#458](https://github.com/galaxie-works/galaxie-sports/pull/458), [#465](https://github.com/galaxie-works/galaxie-sports/pull/465), [#514](https://github.com/galaxie-works/galaxie-sports/pull/514), [#524](https://github.com/galaxie-works/galaxie-sports/pull/524), [#570](https://github.com/galaxie-works/galaxie-sports/pull/570), [#583](https://github.com/galaxie-works/galaxie-sports/pull/583), [#589](https://github.com/galaxie-works/galaxie-sports/pull/589), [#590](https://github.com/galaxie-works/galaxie-sports/pull/590), [#646](https://github.com/galaxie-works/galaxie-sports/pull/646), [#654](https://github.com/galaxie-works/galaxie-sports/pull/654). Épico [#555](https://github.com/galaxie-works/galaxie-sports/issues/555).
- `git log origin/main --since 2026-10-30 --until 2026-11-04` e as releases `deploy-2026-10-30.9` a `deploy-2026-11-03.6`.
- Prometheus de produção, consultado só para leitura em 06/11: `slo:ao_vivo:ok`, `slo:error_budget_remaining:ratio`,
  `slo:sli_error:ratio_28d`, `ALERTS{slo="ao-vivo"}`, `galaxie_live_event_max_staleness_seconds`, `galaxie_live_events`,
  `galaxie_live_scheduler_interval_seconds`; retenção `storage.tsdb.retention.time` = 15d.
- Banco de produção, só leitura (`begin read only`): `ops.runtime_setting_log` (sem quem mudou) e `ops.job_run`
  (`live:run`, `postgame-close`, `recap-run`, `live-reconcile`).
