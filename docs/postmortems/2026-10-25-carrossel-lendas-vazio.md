# 2026-10-25: carrossel "Legendary" da F1 vazio na produção

| Campo | Valor |
|---|---|
| Estado | resolvido |
| Severidade | SEV3: uma vitrine da F1 vazia; o resto da API seguiu normal |
| Início / fim (UTC) | entre 2026-10-25 15:41 e 16:51 (deploy com o #291, hora exata sem registro) → 2026-10-25 16:59 |
| Duração do impacto | no máximo ~78 min; provavelmente bem menos (ver linha do tempo) |
| SLO afetado | nenhum: a rota respondeu 200, com a lista vazia |
| Detectado por | smoke do deploy ("nenhuma lenda") |
| PRs da correção | [#296](https://github.com/galaxie-works/galaxie-sports/pull/296) |

## Resumo

O [#291](https://github.com/galaxie-works/galaxie-sports/pull/291) trocou o critério do carrossel "Legendary" pela
lista editorial `F1_LEGENDS`. Na produção, o carrossel saiu vazio, e o smoke acusou "nenhuma lenda"
([#296](https://github.com/galaxie-works/galaxie-sports/pull/296)).

O `core.provider_map` guarda o id do F1DB com o tipo na frente (`driver-ayrton-senna`); a lista usa o id puro
(`ayrton-senna`). Os testes do #291 montavam os ids sem o prefixo e por isso passaram. O #296 tira o prefixo antes de
comparar e passa os testes para o formato real do banco.

## Impacto

- `/v1/sports/formula-1/legends` devolveu a lista vazia, e o carrossel da página da F1 na demo ficou sem cards.
- Não há contagem de requisições afetadas: o histograma da API não separa resposta vazia de resposta cheia.

## Linha do tempo (UTC)

| Hora | Evento | Fonte |
|---|---|---|
| 15:41:00 | #291 mergeado | [#291](https://github.com/galaxie-works/galaxie-sports/pull/291), commit `794830c4` |
| entre 15:41 e 16:51 | Deploy com o #291; o smoke acusa "nenhuma lenda" | [#296](https://github.com/galaxie-works/galaxie-sports/pull/296) |
| 16:51:30 | #296 mergeado (`3bd4ebb`) | [#296](https://github.com/galaxie-works/galaxie-sports/pull/296) |
| 16:59:32 | Release `deploy-2026-10-25.2` publica `3bd4ebb`, já com o #291 e o #296 | [release](https://github.com/galaxie-works/galaxie-sports/releases/tag/deploy-2026-10-25.2) |
| 26/10 01:51 | Smoke do deploy da release `deploy-2026-10-25.8`: "10 lendas (1ª: Ayrton Senna)" (primeiro log guardado que mostra o carrossel cheio) | `~/.galaxie-ops/deploy-p1-auditoria-a.log` na máquina de operação |

Não existe release `deploy-2026-10-25.1`, e o `deploy.sh` daquele dia só publicava a release depois do smoke. Isso é
compatível com um deploy do #291 que parou no smoke, mas não há log que confirme. Se o deploy do #291 só rodou depois
que a fila destravou ([postmortem do deploy parado](2026-10-25-deploy-travado.md), fim às ~16:30), a vitrine ficou
vazia por menos de 30 min. Também é inferência.

## Causa raiz

1. **Teste com dado fabricado em formato diferente do banco.** O teste do #291 usava o id sem o prefixo `driver-`.
   Unitário e integração passaram com um formato que não existe na produção.
2. **Lista vazia não é erro.** O código trata a lista vazia como "sem lendas", e a rota responde 200. Só o smoke, que
   espera 10, percebeu.
3. **O aviso existia, mas o processo não parava nele.** O review do Codex no #291 marcou como P1 "Strip the driver
   prefix before filtering the legends", e nada no merge exigia resolver P1. O
   [#327](https://github.com/galaxie-works/galaxie-sports/pull/327) passou a fazer o `merge-train` recusar PR com P1 do
   Codex sem resolver.

## Detecção

- O smoke do deploy pegou ("Lendas da F1 (carrossel "Legendary")", que exige 10 lendas).
- O smoke rodava depois do `up`. A versão nova já estava no ar quando ele falhou, e naquele dia não havia volta
  automática (veio no [#330](https://github.com/galaxie-works/galaxie-sports/pull/330), só sem migration nova).

## O que funcionou

- O smoke tinha uma checagem de conteúdo para a vitrine nova, não só de status HTTP.
- A correção foi pequena e entrou em ~1 h desde o merge do #291.

## Ações

| Ação | Tipo | Estado | Onde |
|---|---|---|---|
| `pickListed` tira o prefixo `driver-`; testes com o formato real | corrige | feito | #296 |
| `merge-train` recusa PR com P1 do Codex sem resolver | previne | feito | #327 |
| Deploy volta sozinho à versão anterior quando o smoke falha (sem migration nova) | mitiga | feito | #330, #384 |
| Testes de integração usam o formato do `core.provider_map` (lição registrada no handover) | previne | feito (neste caso) | #296 |

## Fontes

- PRs: [#291](https://github.com/galaxie-works/galaxie-sports/pull/291), [#296](https://github.com/galaxie-works/galaxie-sports/pull/296), [#327](https://github.com/galaxie-works/galaxie-sports/pull/327), [#330](https://github.com/galaxie-works/galaxie-sports/pull/330)
- Release: [deploy-2026-10-25.2](https://github.com/galaxie-works/galaxie-sports/releases/tag/deploy-2026-10-25.2)
