# Papéis do banco: o que cada serviço lê e escreve

O `POSTGRES_USER` é o dono do banco: só o `migrate` e a manutenção à mão entram com ele. Cada serviço entra com um papel próprio, sem superusuário e sem DDL. A fonte da verdade é [`packages/db/src/roles.ts`](../../packages/db/src/roles.ts) (`ROLE_GRANTS`, `ROLE_CONNECTION_LIMITS`); a troca sem downtime, serviço por serviço, está em [infra/vps-telemetry/README.md › Papéis do banco](../../infra/vps-telemetry/README.md#papéis-do-banco).

## Matriz

Leitura larga, escrita estreita. `schema.tabela` limita a escrita àquela tabela (e às sequências dela). Poda (`prune` em `ROLE_GRANTS`) é só `SELECT` e `DELETE` numa tabela de outro serviço, sem `INSERT`, `UPDATE` nem sequência. Só acréscimo (`append`) é `SELECT` e `INSERT`, sem `UPDATE` nem `DELETE` (extrato e registros de auditoria). Acréscimo e atualização (`modify`) é `SELECT`, `INSERT` e `UPDATE`, sem `DELETE`.

| Papel | Lê | Escreve | Conexões (teto) |
| --- | --- | --- | --- |
| `galaxie_api` | todos os schemas da aplicação e `demo_auth.cache_feed_cursor` | `api`, `enrich`, `ops`, `fan`, `engage`, `chat`; na Cosmos, só o que o webhook do Stripe grava (ver abaixo) | 45 |
| `galaxie_demo` | todos, menos `raw` | `ops`, `semantic`, `enrich`, `api`, `engage`, `core.asset`, `core.participant`, `core.competition`; na Cosmos, tabela por tabela (ver abaixo); é dono do `demo_auth` | 60 |
| `galaxie_ingestor` | todos e `demo_auth.cache_feed_cursor` | `raw`, `core`, `ops`, `semantic`, `enrich`, `multisport`, `equestrian`; na Cosmos, só a manutenção da carteira (ver abaixo); poda (só `SELECT` e `DELETE`) em `api.webhook_delivery` | 55 |
| `galaxie_agents` | todos | `enrich`, `semantic`, `ops`, `core.asset`, `api.tenant_channel_list` | 25 |
| `galaxie_live` | `core`, `ops`, `raw`, `semantic` | `core`, `raw.api_response`, `ops.change_feed`, `ops.job_run`, `ops.sync_cursor`, `ops.quota_ledger`, `ops.quota_snapshot`, `ops.quota_budget` | 45 |
| `galaxie_backup` | tudo (`pg_read_all_data`) | `ops.job_run`; tem `CREATEDB` para o ensaio de restauração | 6 |

### Cosmos AI: escrita tabela por tabela (#1064)

O schema `cosmos` guarda saldo em dinheiro, então nenhum papel escreve o schema inteiro. Cada papel recebe só as tabelas e as operações que as funções de `@galaxie/cosmos` que ele chama gravam:

| Papel | `modify` (sem `DELETE`) | `update` (só `UPDATE`) | `append` (só `INSERT`) | `write` |
| --- | --- | --- | --- | --- |
| `galaxie_api` (webhook do Stripe) | `stripe_event`, `wallet`, `recharge_attempt` | `purchase_intent`, `auto_recharge` | `ledger`, `balance_alert` | — |
| `galaxie_demo` (painel do cliente, assistente e Ajustes da equipe Galaxie) | `wallet`, `reservation`, `function_def`, `package`, `purchase_intent`, `auto_recharge`, `recharge_attempt`, `credit_request`, `staff_usage` | — | `ledger`, `balance_alert`, `staff_action`, `moderation_config_log`, `doc_embedding` | `moderation_config` (remover a exceção de uma sala apaga a linha) |
| `galaxie_ingestor` (`cosmos-upkeep`) | `wallet`, `recharge_attempt` | `reservation`, `auto_recharge` | `ledger`, `balance_alert` | — |

O extrato (`cosmos.ledger`) só recebe lançamentos: nenhum serviço muda nem apaga o que já foi escrito. Só a API grava o registro de eventos do Stripe. A demo grava `package` e `function_def` porque as telas Pacotes e Funções da equipe Galaxie rodam nela. A API e o ingestor ainda podem inserir em `balance_alert` e `recharge_attempt` porque um lançamento negativo passa por `evaluateBalance`, que grava os dois. Tabela nova da Cosmos entra aqui e na matriz: o teste `toda tabela da Cosmos tem quem a escreva` quebra se ela ficar de fora, e `toda tabela citada na matriz existe` quebra com nome errado.

### Por que o `galaxie_ingestor` poda `api.webhook_delivery`

O job `data-retention` (agendado no ingestor) apaga as entregas de webhook antigas: entregues com mais de 30 dias e DLQ com mais de 90 (`services/ingestor/src/ops/ops-retention.ts`). É o único acesso de escrita do ingestor em `api`, e só como poda: sem `INSERT` nem `UPDATE`, o ingestor não consegue criar nem alterar uma entrega, que o worker de webhooks assina e envia ao cliente. O teste `data-retention com o papel do ingestor` roda a retenção inteira com o papel: tabela nova na retenção que fique fora da matriz quebra o teste. Sem esse GRANT o job inteiro falha com `permission denied for table webhook_delivery` e nada mais é podado (foi o que aconteceu de 04 a 06/11/2026, com `JobOverdue` e `JobFailingRepeatedly` do `data-retention`).

### Por que o `galaxie_live` escreve em `raw.api_response`

O cliente da api-sports grava toda resposta no raw (`PgRawStore`), inclusive a do ao vivo (retenção `live`, 30 dias), e atualiza `last_seen_at` e `seen_count` quando o corpo se repete. Sem esse GRANT o tick falha na primeira chamada. O resto da escrita vem de `upsertBatch` e do relógio dos eventos (`core`), do `publishChange` e dos triggers do `core.event` (`ops.change_feed`), do estado e dos cursores (`ops.sync_cursor`), do `ops.job_run` e do Quota Governor.

O papel não escreve em `semantic`, `enrich`, `api`, `multisport` nem `equestrian`. Tabela nova de `ops` que o ao vivo passe a gravar entra na lista de `ROLE_GRANTS.live`; o erro aparece como `permission denied for table …` (SQLSTATE 42501) no log do serviço.

## Ligar a URL de um serviço

1. Gere a senha: `openssl rand -hex 32` (só letras e números; o backup lê a URL em shell, sem decodificar).
2. No `.env` da stack: `DB_URL_<SERVIÇO>=postgres://galaxie_<serviço>:<senha>@postgres:5432/galaxie_sports` (`API`, `DEMO`, `INGESTOR`, `AGENTS`, `LIVE`, `BACKUP`).
3. `docker compose run --rm --no-deps migrate </dev/null`: o `migrate` cria o papel que faltar, reaplica a matriz e dá LOGIN com a senha da URL. É por isso que a `DB_URL_<SERVIÇO>` está na lista de envs do `migrate` no compose.
4. `docker compose up -d --no-deps <serviço>` e acompanhe o log por um ciclo.
5. Reverso: tire a variável do `.env` e suba o serviço de novo; ele volta para o dono.

## Limite de conexões

`applyRoles` roda `ALTER ROLE … CONNECTION LIMIT n` com `ROLE_CONNECTION_LIMITS`. Passou do teto, o Postgres recusa a conexão (SQLSTATE 53300, `too many connections for role`). No serviço (postgres.js 4) a recusa não vira erro na hora: o pool que já tem conexão aberta põe a consulta na fila de uma delas, e o que não tem nenhuma tenta de novo até o `connect_timeout` (30 s) antes de rejeitar com o 53300. Teto batido aparece como consulta lenta e o 53300 no log do Postgres; `pg_dump` e `psql` do backup falham na hora. A conta de cada teto está no comentário do mapa: pool do perfil (`DB_POOL_MAX`) × cópias que coexistem num deploy (a no ar, a nova e o candidato) + uma conexão de trava por processo de job + folga para CLI.

O da demo vale para os dois serviços da imagem dela, `site` e `console` (#546): os dois e os dois candidatos do deploy somam 40 no pior momento, e o teto é 60 com a folga.

A soma dos tetos (236) passa do `max_connections` do Postgres (130 desde 03/11/2026, 3 reservadas ao superusuário) de propósito: o teto não reserva vaga, só impede que um papel com pool vazando tome a vaga dos outros. O que precisa caber é o pico real, que está na tabela do README da infra (› Freios › Conexões).

Para ver quem está perto do teto:

```sql
select r.rolname, r.rolconnlimit, count(a.pid) as em_uso
  from pg_roles r left join pg_stat_activity a on a.usename = r.rolname
 where r.rolname like 'galaxie\_%'
 group by 1, 2 order by em_uso desc;
```

Mudar um teto é editar `ROLE_CONNECTION_LIMITS` e rodar o `migrate` (a mudança vale para as próximas conexões, sem reiniciar o serviço).

## Tempos por perfil

O `live` tem perfil próprio em `DB_TIMEOUTS` (`packages/db/src/client.ts`): consulta 30 s, espera por trava 10 s, transação parada 30 s. O tick do ao vivo não pode ficar preso numa consulta, e 10 minutos (perfil `job`) seriam vários ticks perdidos. A espera por trava é maior que a da API (3 s) porque o upsert do lote pega o advisory lock do `normalize` do esporte, que um lote grande segura por alguns segundos. `DB_STATEMENT_TIMEOUT_MS` e companhia sobrescrevem por processo.
