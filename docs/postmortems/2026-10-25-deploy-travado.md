# 2026-10-25: deploy parado quase 2 horas no envio das imagens, sem ninguém ver

| Campo | Valor |
|---|---|
| Estado | resolvido |
| Severidade | SEV3: só a entrega de mudanças parou; não há registro de indisponibilidade para o cliente |
| Início / fim (UTC) | 2026-10-25 14:44 → 2026-10-25 16:30 (hora do PR #295 lida como Brasília; ver linha do tempo) |
| Duração do impacto | ~1 h 46 min com o deploy parado, mais ~16 min de fila presa por uma trava órfã |
| SLO afetado | nenhum (não há SLO de entrega) |
| Detectado por | pessoa olhando, depois do fato |
| PRs da correção | [#295](https://github.com/galaxie-works/galaxie-sports/pull/295), [#315](https://github.com/galaxie-works/galaxie-sports/pull/315), [#330](https://github.com/galaxie-works/galaxie-sports/pull/330), [#384](https://github.com/galaxie-works/galaxie-sports/pull/384), [#403](https://github.com/galaxie-works/galaxie-sports/pull/403) |

## Resumo

Em 25/10 o deploy ainda saía da máquina de dev: `deploy.sh` montava as imagens no Docker local e as mandava para a VPS
por `docker save | ssh`. Uma queda do SSH no meio do envio deixou o processo parado das 11:44 às 13:30, sem erro e sem
aviso ([#295](https://github.com/galaxie-works/galaxie-sports/pull/295)). Nada no caminho tinha teto de tempo nem
keepalive no SSH, e nenhum canal avisava sobre deploy parado.

A versão anterior seguiu no ar, porque o envio das imagens vem antes do `up` da stack. O dano foi de entrega: as
mudanças daquela manhã ficaram paradas, e o deploy seguinte esperou na trava.

## Impacto

- Nenhuma mudança chegou à produção durante ~1 h 46 min. O deploy que destravou a fila publicou 8 PRs de uma vez
  (release [deploy-2026-10-25.2](https://github.com/galaxie-works/galaxie-sports/releases/tag/deploy-2026-10-25.2),
  "8 PR(s) desde deploy-2026-10-25.0").
- Não há registro de API fora. Pela ordem do `deploy.sh`, "enviando imagens" vem antes de "subindo a stack" (log do
  deploy `p0-auditoria` de 25/10 em `~/.galaxie-ops/deploy-p0-auditoria.log`). Não existe medida externa daquele dia
  que confirme isso de fora.
- Não existe release `deploy-2026-10-25.1`: a lista de releases pula da `.0` (16:11 UTC) para a `.2` (16:59 UTC).

## Linha do tempo (UTC)

O PR #295 dá "11:44 às 13:30 de 25/10" sem fuso. Lemos como Brasília (UTC−3): o #288 foi mergeado às 14:40:50 UTC
(`47651ea5`, 11:40:50 −03:00), 4 min antes do início do deploy, e a fila só andou depois das 16:30 UTC. É inferência,
não registro.

| Hora | Evento | Fonte |
|---|---|---|
| 14:40:50 | #288 mergeado na main | commit `47651ea5` |
| 14:44 | Deploy começa e para no envio das imagens (queda de SSH) | [#295](https://github.com/galaxie-works/galaxie-sports/pull/295) |
| 15:41 – 16:19 | #291, #292, #293 e #294 mergeados enquanto o deploy está parado | commits `794830c4`, `e21ccc63`, `09232d87`, `ac7c5842` |
| 16:30 | Fim da parada | [#295](https://github.com/galaxie-works/galaxie-sports/pull/295) |
| 16:36 – 16:52 | Trava `deploy.lock` órfã: um `deploy-safe` encerrado à força não rodou o `trap` e a fila esperou | nota de handover da operação de 25/10 (fora do repositório; sem log) |
| 16:54:07 | #295 mergeado: teto de 45 min no `deploy-safe.sh` e keepalive em todo `ssh` do `deploy.sh` | [#295](https://github.com/galaxie-works/galaxie-sports/pull/295) |
| 16:59:32 | Release `deploy-2026-10-25.2` (`3bd4ebb`) | [release](https://github.com/galaxie-works/galaxie-sports/releases/tag/deploy-2026-10-25.2) |
| 20:07:07 | #315: teto do `deploy-safe` em 80 min, configurável | [#315](https://github.com/galaxie-works/galaxie-sports/pull/315) |
| 22:03:05 | #330: deploy falha alto, trava na VPS com dono e tomada de trava velha, CI conferido | [#330](https://github.com/galaxie-works/galaxie-sports/pull/330) |

## Causa raiz

1. **Sem teto de tempo.** `deploy-safe.sh` esperava o `deploy.sh` para sempre. Um SSH que cai sem fechar a conexão
   deixa o `docker save | ssh` bloqueado sem erro.
2. **SSH sem keepalive.** Sem `ServerAliveInterval`, o cliente não percebe a conexão morta
   ([#295](https://github.com/galaxie-works/galaxie-sports/pull/295)).
3. **Trava sem dono nem validade.** A trava local era um diretório liberado só pelo `trap`. Matar o processo à força
   deixava a trava presa, e não havia regra para tomá-la ([#330](https://github.com/galaxie-works/galaxie-sports/pull/330),
   item INF-2).
4. **Deploy pela máquina de dev.** O caminho dependia de uma conexão doméstica longa (envio de todas as imagens).

## Detecção

- Nada avisou. Ninguém soube até alguém olhar o processo.
- O que faltava: um teto que vira falha e um aviso de deploy falho. Os dois existem hoje: o teto do `deploy-safe`
  (#295/#315) e, no deploy pelo GitHub (#384), o passo "Aviso por push" do `deploy.yml`, que manda push quando o deploy
  falha, é cancelado ou estoura o teto ([#403](https://github.com/galaxie-works/galaxie-sports/pull/403)).

## O que funcionou

- A ordem do deploy (imagens antes do `up`) manteve a versão anterior no ar.
- A release seguinte listou todos os PRs desde a última release publicada, então nada sumiu das notas.

## Ações

| Ação | Tipo | Estado | Onde |
|---|---|---|---|
| Teto de tempo no `deploy-safe.sh` (45 min, depois 80 min configurável) | detecta | feito | #295, #315 |
| Keepalive em todo `ssh` do `deploy.sh` | previne | feito | #295 |
| Trava na VPS com dono, liberada no `trap`, tomada com WARN quando passa do teto | previne | feito | #330 |
| Deploy pelo GitHub Actions (imagens no GHCR, a VPS baixa); `deploy.sh` vira plano B | previne | feito | #384 |
| Push quando o deploy falha, é cancelado ou estoura o teto | detecta | feito | #403 |
| Monitor externo (Better Stack) para saber de fora se a API caiu num deploy | detecta | aberto (conta é do dono) | [runbook de alertas](../runbooks/alertas-e-monitoramento.md#monitor-externo-better-stack-plano-gratuito) |

## Fontes

- PRs: [#295](https://github.com/galaxie-works/galaxie-sports/pull/295), [#315](https://github.com/galaxie-works/galaxie-sports/pull/315), [#330](https://github.com/galaxie-works/galaxie-sports/pull/330), [#384](https://github.com/galaxie-works/galaxie-sports/pull/384), [#403](https://github.com/galaxie-works/galaxie-sports/pull/403)
- Releases: [deploy-2026-10-25.0](https://github.com/galaxie-works/galaxie-sports/releases/tag/deploy-2026-10-25.0), [deploy-2026-10-25.2](https://github.com/galaxie-works/galaxie-sports/releases/tag/deploy-2026-10-25.2)
