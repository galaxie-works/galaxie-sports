# 2026-10-27: conta do Gemini sem crédito e agentes de IA no texto determinístico

| Campo | Valor |
|---|---|
| Estado | **aberto**: o último deploy (29/10 16:19 UTC) ainda vê a conta sem crédito |
| Severidade | SEV2: o conteúdo gerado por IA parou; a API e o ao vivo seguiram normais |
| Início / fim (UTC) | entre 2026-10-26 20:07 e 2026-10-27 02:21 → em aberto |
| Duração do impacto | mais de 2 dias até 29/10 16:19 UTC |
| SLO afetado | nenhum dos SLOs de [docs/14](../14-slos-e-error-budget.md) mede conteúdo de IA |
| Detectado por | pessoa olhando: o jogo Flamengo x Atlético-MG de 26/10 com 1 vídeo relacionado de 24 encontrados ([#395](https://github.com/galaxie-works/galaxie-sports/pull/395)) |
| PRs ligados | [#395](https://github.com/galaxie-works/galaxie-sports/pull/395), [#385](https://github.com/galaxie-works/galaxie-sports/pull/385), [#386](https://github.com/galaxie-works/galaxie-sports/pull/386), [#403](https://github.com/galaxie-works/galaxie-sports/pull/403) |

## Resumo

A produção usa o Gemini com crédito pré-pago. Entre a noite de 26/10 e a madrugada de 27/10 o crédito acabou, e a API
do Gemini passou a responder `402 RESOURCE_EXHAUSTED`. Os agentes que usam LLM caem no texto determinístico quando o
cliente está indisponível (`services/ai-agents/src/cli/common.ts`). Os vídeos relacionados dependiam do Gemini para
classificar e ficaram pendentes.

Nenhum alerta avisou. O smoke do deploy marca a conta sem crédito como `WARN`, não como falha, e nenhum canal de alerta
estava ligado à checagem de crédito. Quem percebeu foi quem olhou um jogo com poucos vídeos.

A mitigação tirou o Gemini do fluxo de vídeos (#395, decisão do dono). O ledger passou a contar as chamadas que ficavam
fora dele (#385), o teto virou faixas por prioridade (#386) e a conta sem crédito virou push (#403). O crédito em si
continua sem recarga até o último deploy registrado.

## Impacto

- **Vídeos relacionados:** no jogo Flamengo x Atlético-MG de 26/10, citado no #395, 5 vídeos ficaram pendentes por falta do
  Gemini (outros 17 caíram por uma regra de direitos, que é outro assunto). Desde o #395, os vídeos não usam LLM.
- **Demais agentes de IA:** passam a gravar o texto determinístico (smoke: "agentes no texto determinístico"). A nota
  de handover da operação de 27/10 cita onde assistir, contexto (cenário) e grades como afetados. Não há contagem de
  textos que deixaram de ser gerados.
- A API, o ao vivo e os dados esportivos não dependem do LLM e seguiram normais (smoke dos mesmos deploys com 24 ok).

## Linha do tempo (UTC)

| Hora | Evento | Fonte |
|---|---|---|
| 26/10 20:07:18 | Smoke: `PASS IA: conta com crédito (gemini)` (último PASS registrado) | run [40392400951](https://github.com/galaxie-works/galaxie-sports/actions/runs/40392400951) |
| 26/10 noite | Flamengo x Atlético-MG sai com 1 vídeo de 24; 5 pendentes por falta do Gemini | [#395](https://github.com/galaxie-works/galaxie-sports/pull/395) |
| 27/10 02:21:48 | #395 mergeado: vídeos classificados só por regras, sem Gemini | [#395](https://github.com/galaxie-works/galaxie-sports/pull/395) |
| 27/10 02:34:06 | Smoke: `WARN IA: 402 RESOURCE_EXHAUSTED — agentes no texto determinístico` (primeiro registro) | run [40438900500](https://github.com/galaxie-works/galaxie-sports/actions/runs/40438900500) |
| 28/10 13:47:45 | Mesmo `WARN` no primeiro deploy de 28/10, e em todos os seguintes | run [40699353784](https://github.com/galaxie-works/galaxie-sports/actions/runs/40699353784) |
| 28/10 14:01:27 | #385: ordem das fotos da F1 passa a reservar e gravar no ledger; todo agente com teto em US$ | [#385](https://github.com/galaxie-works/galaxie-sports/pull/385) |
| 28/10 14:23:02 | #386: teto global dividido em faixas por prioridade, dia de orçamento às 06:00 de Brasília | [#386](https://github.com/galaxie-works/galaxie-sports/pull/386) |
| 29/10 15:01:05 | #403: alerta `AiCreditExhausted` (push, sinal `ia`) a partir da checagem horária | [#403](https://github.com/galaxie-works/galaxie-sports/pull/403) |
| 29/10 16:19:23 | Smoke ainda com `WARN IA: 402 RESOURCE_EXHAUSTED` | run [40910050130](https://github.com/galaxie-works/galaxie-sports/actions/runs/40910050130) |

## Causa raiz

1. **Crédito pré-pago sem aviso de saldo.** O saldo acabou e nada no sistema olhava o saldo antes de zerar. A
   checagem de crédito existia no deploy ([#159](https://github.com/galaxie-works/galaxie-sports/pull/159),
   [#271](https://github.com/galaxie-works/galaxie-sports/pull/271)), mas só como `WARN` no smoke.
2. **Gasto fora do ledger.** A ordem das fotos da F1 chamava o Gemini direto, sem reserva nem registro: cerca de
   US$ 4 só em 25/10 ([#385](https://github.com/galaxie-works/galaxie-sports/pull/385),
   [docs/07](../07-ia-tempo-real-e-enriquecimento.md)). O teto diário em US$ não via esse gasto.
3. **Diferença ainda sem explicação completa.** A nota de handover de 27/10 registra ~US$ 17 no ledger contra os
   US$ 30 da conta. O item 2 explica uma parte; o resto (buscas do grounding subestimadas é uma hipótese) segue em
   aberto.
4. **Fluxo de produto dependente do LLM sem alternativa.** Sem o Gemini, os vídeos ficavam pendentes em vez de
   publicados pelas regras. O #395 tirou essa dependência.

## Detecção

- Nenhum alerta. O `AiCreditExhausted` só entrou em 29/10 (#403).
- O smoke de cada deploy registrou o `402` desde 27/10 02:34, mas `WARN` não falha o deploy nem manda aviso.
- O que teria pegado antes: um alerta de saldo baixo (o Gemini não expõe saldo pela API; dá para aproximar pelo gasto
  acumulado contra o valor carregado) e o push da checagem horária, que agora existe.

## O que funcionou

- O texto determinístico manteve as páginas com conteúdo, sem erro para o cliente.
- O teto em US$ e a decisão de tirar o LLM dos vídeos reduziram a dependência do saldo.

## Ações

| Ação | Tipo | Estado | Onde |
|---|---|---|---|
| Recarregar o crédito do Gemini e pedir "verificar agora" em Ajustes → Sistema → IA | corrige | **aberto (dono)** | conta do AI Studio |
| Vídeos relacionados sem LLM | mitiga | feito | #395 |
| Ordem das fotos da F1 no ledger, teto para todo agente | previne | feito | #385 |
| Faixas de orçamento por prioridade | previne | feito | #386 |
| Push quando a checagem horária falha (`AiCreditExhausted`) | detecta | feito | #403 |
| Conciliar o ledger com a fatura do AI Studio de 21 a 27/10 e explicar a diferença | previne | aberto | issue a abrir |
| Aviso de saldo estimado (valor carregado − gasto no ledger) antes de zerar | detecta | aberto | issue a abrir |

## Fontes

- PRs: [#159](https://github.com/galaxie-works/galaxie-sports/pull/159), [#271](https://github.com/galaxie-works/galaxie-sports/pull/271), [#385](https://github.com/galaxie-works/galaxie-sports/pull/385), [#386](https://github.com/galaxie-works/galaxie-sports/pull/386), [#395](https://github.com/galaxie-works/galaxie-sports/pull/395), [#403](https://github.com/galaxie-works/galaxie-sports/pull/403)
- Runs do `deploy.yml`: [40392400951](https://github.com/galaxie-works/galaxie-sports/actions/runs/40392400951) (último PASS), [40438900500](https://github.com/galaxie-works/galaxie-sports/actions/runs/40438900500) (primeiro 402), [40910050130](https://github.com/galaxie-works/galaxie-sports/actions/runs/40910050130) (402 em 29/10)
