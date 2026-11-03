# Papéis do banco: o que cada serviço lê e escreve

O `POSTGRES_USER` é o dono do banco: só o `migrate` e a manutenção à mão entram com ele. Cada serviço entra com um papel próprio, sem superusuário e sem DDL. A fonte da verdade é [`packages/db/src/roles.ts`](../../packages/db/src/roles.ts) (`ROLE_GRANTS`, `ROLE_CONNECTION_LIMITS`); a troca sem downtime, serviço por serviço, está em [infra/vps-telemetry/README.md › Papéis do banco](../../infra/vps-telemetry/README.md#papéis-do-banco).

## Matriz

Leitura larga, escrita estreita. `schema.tabela` limita a escrita àquela tabela (e às sequências dela).

| Papel | Lê | Escreve | Conexões (teto) |
| --- | --- | --- | --- |
| `galaxie_api` | todos os schemas da aplicação e `demo_auth.cache_feed_cursor` | `api`, `enrich`, `ops` | 45 |
| `galaxie_demo` | todos, menos `raw` | `ops`, `semantic`, `enrich`, `api`, `core.asset`; é dono do `demo_auth` | 60 |
| `galaxie_ingestor` | todos e `demo_auth.cache_feed_cursor` | `raw`, `core`, `ops`, `semantic`, `enrich`, `multisport`, `equestrian` | 55 |
| `galaxie_agents` | todos | `enrich`, `semantic`, `ops`, `core.asset`, `api.tenant_channel_list` | 25 |
| `galaxie_live` | `core`, `ops`, `raw`, `semantic` | `core`, `raw.api_response`, `ops.change_feed`, `ops.job_run`, `ops.sync_cursor`, `ops.quota_ledger`, `ops.quota_snapshot`, `ops.quota_budget` | 45 |
| `galaxie_backup` | tudo (`pg_read_all_data`) | `ops.job_run`; tem `CREATEDB` para o ensaio de restauração | 6 |

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

`applyRoles` roda `ALTER ROLE … CONNECTION LIMIT n` com `ROLE_CONNECTION_LIMITS`. Passou do teto, o Postgres recusa a conexão (SQLSTATE 53300, `too many connections for role`). A conta de cada teto está no comentário do mapa: pool do perfil (`DB_POOL_MAX`) × cópias que coexistem num deploy (a no ar, a nova e o candidato) + uma conexão de trava por processo de job + folga para CLI.

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
