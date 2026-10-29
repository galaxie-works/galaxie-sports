# 2026-10-26: deploy das tabelas LATAM tirou as stakes do Brasileirão e foi desfeito sozinho

| Campo | Valor |
|---|---|
| Estado | resolvido |
| Severidade | SEV3: stakes de jogos do Brasileirão ausentes por ~6 min; deploys parados por ~38 min |
| Início / fim (UTC) | 2026-10-26 19:01:41 → 2026-10-26 19:07:31 (versão com defeito no ar); fila de deploy parada até 19:45:08 |
| Duração do impacto | ~6 min para o cliente; ~44 min sem conseguir publicar |
| SLO afetado | nenhum: a rota respondeu 200, sem as stakes |
| Detectado por | smoke do deploy pelo Actions, que desfez o deploy sozinho |
| PRs da correção | [#394](https://github.com/galaxie-works/galaxie-sports/pull/394), [#393](https://github.com/galaxie-works/galaxie-sports/pull/393) |

## Resumo

O [#364](https://github.com/galaxie-works/galaxie-sports/pull/364) passou a montar as tabelas de cada competição pelo
regulamento (`tables:` em `config/rules`). Para o Brasileirão, o regulamento pedia grupo com nome (`groups: '.'`), mas
a tabela gravada na produção ainda estava no grupo sem nome (`''`), deixado pelo recálculo antigo. A escolha da tabela
do jogo não achava nenhuma, e o jogo ficava sem stakes ([#394](https://github.com/galaxie-works/galaxie-sports/pull/394)).

O deploy automático subiu a versão, o smoke falhou em "Stakes e tags do torcedor" e o deploy voltou sozinho para a
versão anterior em 6 min (run [40382794997](https://github.com/galaxie-works/galaxie-sports/actions/runs/40382794997)).
Como o smoke roda antes do recálculo das tabelas, todo deploy com o #364 falharia. O `DEPLOY_AUTO` foi desligado até a
correção.

## Impacto

- Entre 19:01:41 e 19:07:31, `16f6732` serviu a API. Jogos do Brasileirão com a tabela no grupo sem nome saíram sem
  stakes. O smoke achou um (`01a163b8-68bc-70dc-ac38-23f1d5fc1356`); não há contagem dos outros.
- Das 19:07 às 19:45 a main teve PRs que não podiam ser publicados (o #390 foi mergeado às 19:16 e o deploy dele foi
  pulado).
- Sem perda de dado: o `16f6732` não trazia migration (`git show --stat 16f6732`), então a volta foi completa.

## Linha do tempo (UTC)

| Hora | Evento | Fonte |
|---|---|---|
| 18:51:10 | #364 mergeado (`16f6732`) | [#364](https://github.com/galaxie-works/galaxie-sports/pull/364) |
| 19:00:39 | Deploy automático de `16f6732` começa | run [40382794997](https://github.com/galaxie-works/galaxie-sports/actions/runs/40382794997) |
| 19:01:41 | "subindo a stack": a versão nova entra no ar | mesmo run |
| 19:02:19 | Migrations aplicadas (nenhuma nova) | mesmo run |
| 19:03:18 | Smoke começa | mesmo run |
| 19:06:33 | `FAIL Stakes e tags do torcedor`: jogo do Brasileirão sem stakes | mesmo run |
| 19:07:31 | "deploy desfeito: compose.yml e .env de bd7b312 de volta e a stack subiu de novo nela" | mesmo run |
| 19:16:15 | #390 mergeado (`515d8ad`) | commit `515d8ad8` |
| 19:17 | `DEPLOY_AUTO` desligado; os deploys de `515d8ad` saem `skipped` (19:17:52 e 19:25:25) | [#394](https://github.com/galaxie-works/galaxie-sports/pull/394), runs 40385462957 e 40386601947 |
| 19:32:53 | #394 mergeado (`f635579`): grupo sem nome pertence à única tabela de fase | [#394](https://github.com/galaxie-works/galaxie-sports/pull/394) |
| 19:33:19 | Deploy manual de `f635579` | run [40387757972](https://github.com/galaxie-works/galaxie-sports/actions/runs/40387757972) |
| 19:45:08 | Deploy termina verde (release `deploy-2026-10-26.10`) | mesmo run, [release](https://github.com/galaxie-works/galaxie-sports/releases/tag/deploy-2026-10-26.10) |
| 19:55:13 | #393 mergeado: fases deduzidas para competição sem regulamento de tabelas | [#393](https://github.com/galaxie-works/galaxie-sports/pull/393) |
| 20:10:02 | Deploy de `54fb589` com o #393 verde (release `deploy-2026-10-26.12`) | run 40392400951 |

## Causa raiz

1. **Dado da produção num formato que o código novo não esperava.** A tabela do Brasileirão estava no grupo `''`.
   O regulamento novo exigia grupo com nome, e `standingsTableOf` não ligava o grupo sem nome a nenhuma fase.
2. **Ordem do deploy.** O recálculo que regravaria os grupos com nome roda depois do deploy; o smoke roda antes. A
   versão nova só funcionaria com dados que ela mesma ainda ia gravar.
3. **Testes sem o caso da produção.** Os testes do #364 não tinham a tabela no grupo sem nome; o #394 acrescentou esse
   caso para o Brasileirão e para a Argentina.

## Detecção

- O smoke pegou em 3 min e o deploy voltou sozinho em menos de 1 min depois do FAIL. Funcionou como desenhado
  ([#330](https://github.com/galaxie-works/galaxie-sports/pull/330), [#384](https://github.com/galaxie-works/galaxie-sports/pull/384)).
- O aviso por push de deploy falho ainda não existia (veio no
  [#403](https://github.com/galaxie-works/galaxie-sports/pull/403), em 29/10). Quem viu foi quem acompanhava o Actions.

## O que funcionou

- O smoke tinha uma checagem de conteúdo (stakes de um jogo real), não só de status HTTP.
- Volta automática completa, porque não havia migration nova.
- Desligar o `DEPLOY_AUTO` evitou uma série de deploys que falhariam e voltariam a cada merge.

## Ações

| Ação | Tipo | Estado | Onde |
|---|---|---|---|
| Grupo sem nome pertence à única tabela de fase do regulamento | corrige | feito | #394 |
| Fases deduzidas das rodadas para competição sem `tables:`; grupo vazio sai inteiro | corrige | feito | #393 |
| Push quando o deploy falha | detecta | feito | #403 |
| Deploy de mudança de dado em duas etapas: código que aceita o formato antigo e o novo, depois o recálculo, depois o código que exige o novo | previne | aberto (prática; registrar no runbook do deploy) | [deploy pelo GitHub](../runbooks/deploy-pelo-github.md) |

## Fontes

- PRs: [#364](https://github.com/galaxie-works/galaxie-sports/pull/364), [#393](https://github.com/galaxie-works/galaxie-sports/pull/393), [#394](https://github.com/galaxie-works/galaxie-sports/pull/394), [#330](https://github.com/galaxie-works/galaxie-sports/pull/330), [#384](https://github.com/galaxie-works/galaxie-sports/pull/384), [#403](https://github.com/galaxie-works/galaxie-sports/pull/403)
- Runs do `deploy.yml`: [40382794997](https://github.com/galaxie-works/galaxie-sports/actions/runs/40382794997) (falha e volta), [40387757972](https://github.com/galaxie-works/galaxie-sports/actions/runs/40387757972) (deploy manual com a correção)
- Releases: [deploy-2026-10-26.10](https://github.com/galaxie-works/galaxie-sports/releases/tag/deploy-2026-10-26.10), [deploy-2026-10-26.12](https://github.com/galaxie-works/galaxie-sports/releases/tag/deploy-2026-10-26.12)
