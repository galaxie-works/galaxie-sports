# Recebi um push, e agora?

O que fazer nos primeiros minutos depois de um push de alerta. Os canais, o roteamento e como ligar cada um estão em
[alertas e monitoramento](alertas-e-monitoramento.md); os SLOs e a política do orçamento, em
[docs/14](../14-slos-e-error-budget.md).

Convenções dos comandos: a VPS é `root@<vps>` (endereço no [runbook do deploy](deploy-pelo-github.md)), a stack fica em
`/docker/galaxie-sports`, e o Grafana abre pelo túnel
`ssh -L 3000:<IP do contêiner grafana>:3000 root@<vps>` em `http://localhost:3000`.

## Os primeiros 5 minutos, para qualquer push

1. **Leia o sinal** entre colchetes no título do push (`[api]`, `[ao-vivo]`, `[ia]`, `[backup-disco]`, `[deploy]`) e
   vá para a seção dele abaixo.
2. **O cliente está sentindo?** De fora da VPS:

   ```bash
   curl -sS -w '\n%{http_code} %{time_total}s\n' https://api.sports.galaxie.works/health/ready
   ```

   `200` com `"status":"ok"` = API, banco e Valkey de pé. `200` com `"status":"degraded"` = sem Valkey: a API serve,
   mas sem cache e com o limite em modo degradado. `503` = sem Postgres. Sem resposta = API ou VPS fora.
3. **Mudou alguma coisa?** O deploy mais recente costuma ser a causa:

   ```bash
   gh run list --workflow deploy.yml --limit 3
   ```

4. **Mitigue antes de consertar.** Voltar a versão, desligar uma flag no painel (Ajustes) ou pausar um job resolve mais
   rápido que achar o bug. O conserto vem depois, com calma.
5. **Anote a hora (UTC) de cada passo.** Vira a linha do tempo do postmortem.

## Sinal por sinal

| Sinal | Alertas | Primeiro passo |
|---|---|---|
| `api` | `ApiDown`, `SloBurnRateFast` (`api-disponibilidade`, `api-latencia`), monitor externo | Ver se a API responde e se houve deploy; voltar a versão se o deploy for a causa |
| `ao-vivo` | `LiveEventStale` | Ver se o `live-run` está rodando e se a cota LIVE acabou |
| `ia` | `AiCreditExhausted`, `AiSpendNearDailyBudget` | Crédito: recarregar e "verificar agora". Gasto: ver o agente que mais gastou |
| `backup-disco` | `BackupStale`, `BackupCheckFailed`, `RestoreDrillFailed`, `DiskAlmostFull` | Logs do contêiner `backup`; para disco, `df -h` (sem `prune`) |
| `deploy` | "Aviso por push" do `deploy.yml` | Abrir o run: ver se o deploy voltou sozinho para a versão anterior |
| (alertador cego) | `DatasourceError` do Grafana | Ver se o Prometheus está de pé |

### `api`: API fora ou queimando o orçamento

- **`ApiDown`** (o Prometheus não raspa a API há 2 min):

  ```bash
  ssh root@<vps> 'cd /docker/galaxie-sports && docker compose ps api && docker compose logs --tail 100 api'
  ```

  - Contêiner reiniciando em laço: os logs dizem o porquê (banco, variável faltando). Se começou com um deploy,
    volte a versão: `gh workflow run deploy.yml -f sha=<sha anterior> -f force=1` (o SHA anterior está na release
    anterior).
  - Contêiner `healthy` e `curl` de fora com `200`: o problema é entre o Prometheus e a API (rede da stack,
    `METRICS_TOKEN`). O cliente não está sentindo; siga sem pressa.
  - Nada responde, nem o SSH: a VPS caiu. Painel do provedor; o roteiro de VPS perdida está no
    [runbook de DR](exercicio-dr.md#cenários-de-desastre-e-resposta).
- **`SloBurnRateFast`, `slo="api-disponibilidade"`** (5xx ou tempo fora acima de 7,2% na hora): no Grafana, painel
  "Cota, ingestão e API" → "Requisições por rota e status" mostra a rota dos 5xx. Depois:

  ```bash
  ssh root@<vps> 'cd /docker/galaxie-sports && docker compose logs --since 30m api | grep -E "\"statusCode\":5|\"level\":50" | tail -30'
  ```

  Começou num deploy: volte a versão. Uma rota só: veja se dá para desligar a feature no painel.
- **`SloBurnRateFast`, `slo="api-latencia"`** (mais de 6% a 14,4% das rotas principais acima de 1 s): quase sempre é o
  banco ou a VPS saturada.

  ```bash
  ssh root@<vps> 'docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"'
  ```

  Um job pesado rodando à mão (`docker compose run ...`) é o suspeito número um: pare-o. Valkey fora deixa tudo sem
  cache (`/health/ready` responde `degraded`).

### `ao-vivo`: jogo do plano sem atualização

O push diz o esporte. No Grafana, painel "Cota, ingestão e API":

1. "Cota restante por API": cota LIVE do esporte em zero = o Live Scheduler não tem chamadas. Não há o que consertar
   até a virada do dia UTC; avise quem depende, se for jogo grande.
2. "Tempo desde o último sucesso" do `live-run` (a cada 5 min): parado = o scheduler do ingestor parou.

   ```bash
   ssh root@<vps> 'cd /docker/galaxie-sports && docker compose ps ingestor && docker compose logs --since 20m ingestor | grep -i live | tail -40'
   ```

3. Fonte fora (erros 5xx ou timeouts da api-sports no log): não há o que fazer do nosso lado além de registrar.

A queima do SLO `ao-vivo` não manda push: ela chega no resumo diário e diz se os atrasos do dia somaram demais.

### `ia`: conta sem crédito ou gasto perto do teto

- **`AiCreditExhausted`**: recarregue o saldo no AI Studio (ou troque a chave) e peça "verificar agora" em Ajustes →
  Sistema → IA. Os agentes seguem no texto determinístico enquanto isso: nada quebra para o cliente, mas o conteúdo de
  IA para. Ver o [postmortem de 27/10](../postmortems/2026-10-27-ia-sem-credito.md).
- **`AiSpendNearDailyBudget`** (80% do teto do dia): em Ajustes → Sistema → IA, veja o gasto por agente. Um agente fora
  do normal (lote manual, laço de retentativa) tem o teto dele reduzido no mesmo painel. Não suba o teto sem saber quem gastou: o dia vira
  às 06:00 de Brasília e o alerta resolve sozinho.

### `backup-disco`: backup atrasado, verificação falhando ou disco cheio

- **`BackupStale` ou `BackupCheckFailed`**:

  ```bash
  ssh root@<vps> 'cd /docker/galaxie-sports && docker compose logs --tail 100 backup && docker compose exec -T backup ls -lt /backups | head'
  ```

  O `error` do job em Ajustes → Sistema (jobs `pg-backup` e `backup-check`) diz qual parte falhou: dump, conferência
  ou recibo do NAS. Recibo do NAS atrasado: a stack `galaxie-sports-backup-nas` no Portainer do NAS parou.
- **`RestoreDrillFailed`**: o dump mais recente não restaurou. É sério, mas não urgente de madrugada: siga o
  [runbook de DR](exercicio-dr.md) no dia seguinte e confira se o dump de antes restaura.
- **`DiskAlmostFull`** (acima de 85%):

  ```bash
  ssh root@<vps> 'df -h && docker system df'
  ```

  Não rode `docker system prune` nem apague volume: os dumps e o banco estão lá. Imagens antigas saem com
  `docker image prune` (só imagens sem contêiner); dumps antigos, pela rotação do serviço `backup`.

### `deploy`: deploy falhou, foi cancelado ou travou

Abra o link do run no push (ou `gh run list --workflow deploy.yml --limit 3`) e procure as linhas `FAIL`:

- `deploy desfeito: ... de volta e a stack subiu de novo nela`: a produção já está na versão anterior. O cliente não
  sente nada; investigue a falha (o smoke diz o que quebrou) antes de repetir. Se cada merge vai falhar do mesmo jeito,
  desligue o `DEPLOY_AUTO` até a correção, como em 26/10
  ([postmortem](../postmortems/2026-10-26-deploy-tabelas-desfeito.md)).
- `rollback manual`: o deploy tinha migration nova e não voltou sozinho. Siga o comando que o log imprime; a versão
  nova pode estar no ar com problema, então trate como sinal `api`.
- Teto estourado ou cancelado: confira a trava na VPS antes de disparar de novo
  (`ssh root@<vps> 'cat /docker/galaxie-sports/.deploy.lock/owner'`) e o [runbook do deploy](deploy-pelo-github.md#plano-b-contingência).

### Alertador cego: `DatasourceError`

O Grafana não consegue consultar o Prometheus, então nenhum outro alerta chega.

```bash
ssh root@<vps> 'cd /docker/galaxie-sports && docker compose ps prometheus && docker compose logs --tail 50 prometheus'
```

Disco cheio derruba o Prometheus primeiro: confira `df -h`. Depois de subir, os alertas que estavam disparando voltam
em 1 a 2 min.

## Depois

- **Resolveu?** O push avisa quando o alerta resolve. Confira no painel "SLOs e orçamento de erro" quanto do orçamento
  o episódio gastou.
- **Postmortem** quando: o cliente sentiu por mais de 15 min, o episódio gastou 20% ou mais do orçamento de um SLO, ou
  houve perda de dado. Copie o [template](../postmortems/_template.md) para `docs/postmortems/AAAA-MM-DD-<assunto>.md`,
  sem culpados e com fonte em cada afirmação.
- **Alerta sem ação útil** (falso positivo, ou nada a fazer): ajuste o alerta no mesmo dia. Push que ninguém precisa
  ler ensina a ignorar push.
