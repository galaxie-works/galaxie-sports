# AAAA-MM-DD: título curto do que o usuário viu

> Postmortem sem culpados: descreve o sistema e as decisões que ele permitiu, não quem apertou o botão.
> Toda afirmação aponta para a fonte (commit, PR, release, execução do Actions ou log). O que é inferência diz que é.

| Campo | Valor |
|---|---|
| Estado | aberto · mitigado · resolvido |
| Severidade | SEV1 (API ou ao vivo fora para todos) · SEV2 (função importante degradada) · SEV3 (degradação menor ou só interna) |
| Início / fim (UTC) | AAAA-MM-DD HH:MM → AAAA-MM-DD HH:MM |
| Duração do impacto | |
| SLO afetado | ver [docs/14](../14-slos-e-error-budget.md); "nenhum" quando não há SLO que meça |
| Detectado por | alerta X · smoke do deploy · pessoa olhando · cliente |
| PRs da correção | #NNN |

## Resumo

Dois ou três parágrafos: o que quebrou, quem sentiu, quanto tempo e o que mudou para não repetir.

## Impacto

- O que o cliente da API, o usuário da demo ou a operação deixou de ter.
- Volume, quando houver número (jogos, requisições, minutos). Sem número, diga que não há medida.

## Linha do tempo (UTC)

| Hora | Evento | Fonte |
|---|---|---|
| HH:MM:SS | | commit, PR, run do Actions, log |

## Causa raiz

O mecanismo, em termos do sistema. Quando houver mais de um fator, liste cada um.

## Detecção

- O que avisou e quanto tempo depois do início.
- O que deveria ter avisado e não avisou, e por quê.

## O que funcionou

## Ações

| Ação | Tipo | Estado | Onde |
|---|---|---|---|
| | corrige · previne · detecta · mitiga | feito · aberto | PR ou issue |

## Fontes

- Links para PRs, commits, releases e execuções citados.
