# Réplica do Postgres no NAS e dumps fora da VPS

Épico [#1304](https://github.com/galaxie-works/galaxie-sports/issues/1304). O NAS do dono vira **réplica física em
streaming** do Postgres de produção, e o dump diário e o de antes de cada deploy com migration passam a ser feitos **no
NAS, a partir da réplica**. A VPS deixa de rodar `pg_dump`; fica com um dump semanal, de segurança. Custo zero.

Peças: a stack [`infra/nas-replica`](../../infra/nas-replica/README.md) no Portainer do NAS (#1307), o
[`preparar-replica.sh`](../../infra/vps-telemetry/preparar-replica.sh) da VPS (#1306), o modo `DUMP_MODE=nas` do deploy
(#1308), o dump semanal da VPS, o `nas-pull.sh` sem dumps e os alertas (#1309), a cópia fora de casa opcional (#1310) e
este runbook (#1311). A medição do WAL por dia é a #1305 ([abaixo](#medir-o-wal-por-dia-1305)).

## Por quê

A VPS (KVM 2, 2 vCPU) tem créditos de CPU: depois de horas de uso alto, o provedor limita a máquina a **30 %** de CPU
(`st` em ~70 no `vmstat`) e só libera horas depois. Entre 13 e 17/11/2026 isso parou o ao vivo por ~36 h e travou o
deploy. O que mais dispara o corte é o `pg_dump` de ~4,5 GB (diário às 03:30 e antes de cada migrate: quatro deploys
num dia foram quatro dumps), que também ocupa até 92 GB dos 100 GB de disco nos picos
([VPS com CPU limitada](../../CLAUDE.md), memória de 15/11; análise na repo interna, `arquitetura/infra/separacao-de-maquinas.md`).

Com a réplica, a produção só manda o WAL (o que já escreve de qualquer forma, cerca de dezenas de MB por hora) pelo
túnel, e o NAS faz o trabalho pesado: o `pg_dump` lê a réplica, comprime e grava no disco do NAS. A VPS não compila
dump, não grava 4,5 GB e não perde 20 a 40 minutos de CPU por deploy.

## Arquitetura

```mermaid
flowchart LR
  subgraph VPS["VPS (produção)"]
    PG[(postgres<br/>slot nas_replica)]
    PX[replica-proxy<br/>127.0.0.1:5432]
    SSHD[sshd<br/>galaxie-nas-tunnel<br/>galaxie-nas-receipt]
    VOL[(volume backups<br/>.nas_last_dump<br/>dump semanal)]
    PX --> PG
    SSHD --> PX
    SSHD --> VOL
  end
  subgraph NAS["NAS (LAN do dono, Portainer)"]
    T[tunnel<br/>autossh -L 5432]
    R[(postgres<br/>hot standby)]
    D[dumper<br/>dump.sh]
    DIR[(NAS_BACKUP_PATH<br/>daily/ weekly/ monthly/ pre-migrate/)]
    T -->|WAL em streaming| R
    D -->|pg_dump| R
    D --> DIR
    D -.->|rclone, opcional| OFF[(bucket fora de casa)]
  end
  T ==>|SSH, só port-forwarding| SSHD
  D -->|recibo "dump quando bytes arquivo"| SSHD
  GH[deploy.yml<br/>DUMP_MODE=nas] -->|nas-dump-check.sh| VOL
```

- **Túnel**: o NAS abre a conexão (nada entra na LAN). A chave `galaxie-nas-tunnel` só encaminha porta para
  `127.0.0.1:5432` da VPS (`command="/bin/false",restrict,port-forwarding,permitopen`), onde o `replica-proxy`
  (`compose.dados.yml`) repassa ao `postgres` da stack. O Postgres vê a conexão vir da rede da stack
  (`172.30.50.0/24`), que é o que o `pg_hba.conf` libera para o papel `replicador`, só para `replication`.
- **Réplica**: `pg_basebackup` na primeira subida, depois WAL em streaming pelo slot `nas_replica`. Só leitura; nunca
  promovida (o entrypoint e o `dump.sh` recusam).
- **Dumps**: no NAS, em `daily/` (rotação 7/4/6, a mesma da cópia de antes, e a mesma trava do `nas-pull.sh`) ou
  `pre-migrate/`. O `pg_dump` roda sem pausar o replay (pausar exige superusuário; o papel de backup não é): ele tem
  snapshot próprio e a réplica sobe com `max_standby_streaming_delay=-1`, então a consulta longa nunca é cancelada por
  conflito com a recuperação. O recibo `.nas_last_dump` na VPS é a prova que o deploy e o verificador conferem.
- **Deploy com migration**: sem recibo recente, o deploy deixa um **pedido de dump** na VPS e espera o NAS atender
  ([Deploy sem dump local](#deploy-sem-dump-local)).
- **VPS**: dump semanal (domingo, 3 guardados) para o pior caso; `nas-pull.sh` continua copiando os assets do S3.

## O que não muda

- **Produção intacta**: nada é apagado, nenhum serviço da VPS é recriado (o `replica-proxy` é um serviço novo, com IP
  fixo na rede da stack; os parâmetros de WAL entram por `ALTER SYSTEM` + reload). O `preparar-replica.sh` é
  idempotente e guarda só os 3 backups mais novos do `authorized_keys`.
- Os papéis, senhas e dados que já existem; o formato dos dumps (`restore.sh` lê os do NAS como lia os da VPS); a
  cópia dos assets do S3 pelo `nas-pull.sh`; o `espelho` semanal produção → dev, que continua lendo `daily/`.
- Até ligar `DUMP_MODE=nas`, `BACKUP_DUMP_SOURCE=nas` e `NAS_DUMPS_FROM_REPLICA=1`, **tudo continua como hoje**: o deploy
  roda o `pg_dump` na VPS, o `backup` dumpa todo dia e o NAS puxa os dumps por `rsync`.

## Ordem de execução

Quem executa é a sessão principal: a VPS por SSH, o NAS **só pela API do Portainer** (stacks, variáveis, `exec` em
contêiner, logs). Exemplos usam `203.0.113.10` no lugar do IP real.

### 1. VPS: `compose.dados.yml` da `main` e `preparar-replica.sh`

```bash
# da máquina de dev, na main já com este PR
scp infra/vps-telemetry/compose.dados.yml root@203.0.113.10:/docker/galaxie-sports/compose.dados.yml.new
ssh root@203.0.113.10 'cd /docker/galaxie-sports && cp compose.dados.yml compose.dados.yml.bak-$(date +%F) && docker compose -f compose.dados.yml.new config -q && mv compose.dados.yml.new compose.dados.yml'
# confira que não há deploy em curso (o deploy troca o .env por cima do que o script grava)
ssh root@203.0.113.10 'cd /docker/galaxie-sports && ls -d .deploy.lock .env.next 2>/dev/null || echo "sem deploy em curso"'
ssh root@203.0.113.10 'cd /docker/galaxie-sports && bash -s -- --status' < infra/vps-telemetry/preparar-replica.sh
ssh root@203.0.113.10 'cd /docker/galaxie-sports && bash -s' < infra/vps-telemetry/preparar-replica.sh
```

O script confere `wal_level`, `max_wal_senders` e `max_replication_slots` (os padrões do 17 bastam), aplica
`wal_keep_size=512MB` (uma queda curta do link, mesmo sem slot) e `max_slot_wal_keep_size=4GB` (o teto do slot, que é
quem guarda de verdade; `REPLICA_WAL_KEEP_SIZE`, `REPLICA_MAX_SLOT_WAL_KEEP_SIZE` no `.env`), gera
`REPLICATOR_PASSWORD` no `.env` e cria o papel `replicador`, libera o `pg_hba.conf` só para o IP fixo do
`replica-proxy` (`172.30.50.250/32`), sobe o `replica-proxy`, instala `/usr/local/bin/galaxie-nas-receipt` e troca o
comando forçado da chave `galaxie-nas-receipt` para ele (a mesma chave passa a aceitar `pull`, `dump …` e `pedido`).
Ele avisa que falta a chave do túnel: ela vem do passo 2.

Variáveis que ele deixa no `.env` da VPS (todas com padrão em [`env.example`](../../infra/vps-telemetry/env.example)):
`REPLICATOR_PASSWORD`, `REPLICA_WAL_KEEP_SIZE`, `REPLICA_MAX_SLOT_WAL_KEEP_SIZE`, `REPLICA_PROXY_IP`,
`REPLICA_HBA_CIDR`, `REPLICA_PROXY_BIND`. Mudou um valor: rode o script de novo.

### 2. NAS: pastas, chaves e a `nas-lib.sh`

Pela API do Portainer (ou pela pasta compartilhada do NAS, se o dono preferir), criar `NAS_REPLICA_PATH`
(ex.: `/volume1/Docker/galaxie-sports-replica`) com:

- `replica-entrypoint.sh` e `dump.sh` de [`infra/nas-replica`](../../infra/nas-replica);
- `ssh/tunnel_ed25519` + `.pub`, gerados **no NAS** (`ssh-keygen -t ed25519 -N '' -f ssh/tunnel_ed25519 -C galaxie-nas-tunnel`;
  pela API: `exec` num contêiner `alpine` com a pasta montada, `apk add openssh-keygen`), e `ssh/known_hosts` copiado de
  `NAS_BACKUP_PATH/ssh/known_hosts` (a chave de host da VPS, a mesma que o `nas-pull.sh` já confere);
- em `NAS_BACKUP_PATH` (a pasta da stack `galaxie-sports-backup-nas`): `nas-lib.sh` de
  [`infra/nas-backup`](../../infra/nas-backup) ao lado do `nas-pull.sh`, e o `nas-pull.sh` novo (ele passa a carregar a
  lib).

Depois, na VPS, a chave pública do túnel:

```bash
ssh root@203.0.113.10 'cd /docker/galaxie-sports && bash -s -- --tunnel-key "ssh-ed25519 AAAA… galaxie-nas-tunnel"' < infra/vps-telemetry/preparar-replica.sh
```

### 3. NAS: a stack `nas-replica` no Portainer

Stack `nas-replica` (ambiente `local`) com [`infra/nas-replica/compose.yml`](../../infra/nas-replica/compose.yml) e as
variáveis de [`env.example`](../../infra/nas-replica/env.example). Os dois segredos vêm do `.env` da VPS:
`REPLICATOR_PASSWORD` (`grep ^REPLICATOR_PASSWORD= .env`) e `DUMP_PGPASSWORD` (a senha do papel `galaxie_backup` em
`DB_URL_BACKUP`). Pela API: `POST /api/stacks/create/standalone/string?endpointId=<id>` com `name`, `stackFileContent` e
`env` (lista de `{name, value}`); atualizar: `PUT /api/stacks/<id>?endpointId=<id>`.

**Na mesma hora**, na stack `galaxie-sports-backup-nas`: `NAS_DUMPS_FROM_REPLICA=1` e redeploy. O `nas-pull.sh` para de
puxar dumps da VPS e segue só com os prefixos do S3 e o recibo `.nas_last_pull`; os dumps que ele já trouxe ficam em
`daily/` como estão, até a rotação. As duas stacks usam a mesma trava (`NAS_BACKUP_PATH/.lock`), então nunca mexem em
`daily/` ao mesmo tempo, mas sem a variável os dois escreveriam dumps do mesmo dia lá.

### 4. Primeira sincronização

O `nas-replica-postgres-1` fica no `pg_basebackup` (~20 GB pelo link residencial: de dezenas de minutos a algumas
horas; o progresso sai no log do contêiner). O `dumper` espera por conta própria. Conferir:

```bash
# na VPS: a réplica em streaming e o slot ativo
ssh root@203.0.113.10 'cd /docker/galaxie-sports && bash -s -- --status' < infra/vps-telemetry/preparar-replica.sh
# no NAS (exec no nas-replica-postgres-1): em recuperação e o atraso
psql -U galaxie_backup -d galaxie_sports -Atc "select pg_is_in_recovery(), now() - pg_last_xact_replay_timestamp()"
```

Esperado: `nas_replica … streaming` em `pg_stat_replication`, `active=t, wal_status=reserved` no slot, `t` e segundos de
atraso na réplica.

### 5. Primeiro dump e o recibo

`exec` no `nas-replica-dumper-1`: `/dump.sh`. Depois `NAS_BACKUP_PATH/last_dump.txt` (`ok: daily galaxie_sports_…`) e, na
VPS, `--status` mostra `recibo .nas_last_dump: há N min (<quando> <bytes> <arquivo>)`. O `.sha256` fica ao lado do dump
em `daily/`.

### 6. Medir o WAL por dia (#1305)

Antes de ligar o modo, uma medição de 24 h do que a produção vai mandar pelo túnel:

```bash
# na VPS, hoje e amanhã à mesma hora (o --status também imprime o LSN)
ssh root@203.0.113.10 'cd /docker/galaxie-sports && docker compose -f compose.dados.yml exec -T postgres psql -U galaxie -d galaxie_sports -Atc "select pg_current_wal_lsn()"'
# em 24 h: a diferença em bytes
… -Atc "select pg_size_pretty(pg_wal_lsn_diff('<LSN de agora>', '<LSN de ontem>'))"
```

Decisão a partir do número: até ~5 GB/dia o link residencial dá conta sem nada; acima disso, ligar
`wal_compression=on` na produção (`ALTER SYSTEM`, reload; reduz as imagens de página inteira, ao custo de CPU na VPS,
pequeno) e a compressão do túnel (`-C` no `autossh` do serviço `tunnel`; CPU no NAS, não na VPS). Registre o número e a
decisão na issue #1305.

### 7. Ligar o modo NAS

Só com os passos 4 e 5 conferidos. Em ordem:

1. **Deploy**: `gh variable set DUMP_MODE --body nas` (e, se quiser outra idade máxima, `NAS_DUMP_MAX_AGE_MIN`,
   padrão 120). O próximo deploy com migration confere o recibo em vez de rodar o `pg_dump`
   ([Deploy sem dump local](#deploy-sem-dump-local)).
2. **VPS, `.env`** (confira antes que não há deploy em curso): `BACKUP_DUMP_SOURCE=nas`, `BACKUP_DAYS=0`,
   `BACKUP_KEEP_DAILY=3`; depois `docker compose -f compose.dados.yml up -d --no-deps backup`. O `backup` passa a dumpar
   só aos domingos (3 guardados) e o verificador passa a aceitar o recibo do NAS como prova (registrando os jobs
   `nas-dump` e `backup-mode-nas` para os alertas). Esta mudança precisa da imagem do `backup` com este PR
   (`gh workflow run dados-backup.yml`, [stack-dados-e-observabilidade.md](stack-dados-e-observabilidade.md)).
3. Observabilidade: `gh workflow run deploy.yml -f project=obs` para os alertas novos (`NasDumpStale`, o `BackupStale`
   que entende o `nas-dump`, o SLO `backup`).

(`NAS_DUMPS_FROM_REPLICA=1` na stack de backup do NAS já foi ligado no passo 3, junto com a stack.)

## Deploy sem dump local

Com `DUMP_MODE=nas` (variável do repositório; padrão `vps`), o `deploy-gh.sh` chama
[`nas-dump-check.sh`](../../infra/vps-telemetry/nas-dump-check.sh) na VPS em vez do `pre-migrate-dump.sh`, só quando o
journal do SHA tem migration que o banco não tem. Nesta ordem:

1. **Recibo recente dispensa tudo**: `.nas_last_dump` com até `NAS_DUMP_MAX_AGE_MIN` minutos (padrão 120) e tamanho
   plausível (≥ 256 MB e ≥ 5 % do banco) é a prova. Um dump feito na própria VPS (`/backups` ou `pre-migrate/`, o
   semanal de domingo ou um deploy anterior com `DUMP_MODE=vps`) com a mesma idade também.
2. **Senão, o deploy pede o dump ao NAS e espera.** Ele grava o pedido `.nas_dump_request` no volume de backups
   (`<quando> <rótulo>`, o rótulo é `gha-<run id>-<antigo>-<novo>`) e espera até `NAS_DUMP_WAIT_MIN` minutos (padrão
   20) por um recibo gravado **depois** do pedido. No NAS, o `dumper` consulta o pedido a cada minuto pela chave de
   recibo (`dump.sh --pedido` → comando forçado `pedido`), faz o `pg_dump` da réplica em `pre-migrate/` com esse rótulo
   e toca o recibo, que apaga o pedido. O deploy vê o recibo e segue para o `migrate`. Tempos: 1 min até o NAS ver o
   pedido + o `pg_dump` (10 a 40 min, conforme o banco) + o recibo; o teto de 20 min cabe no passo do deploy
   (75 min), e `NAS_DUMP_WAIT_MIN` sobe se o dump passar disso.
3. **Sem recibo no prazo**, o deploy retira o pedido e **para antes de tocar no banco**, com a mensagem: conferir o NAS
   (`last_dump.txt`, logs de `dumper`, `postgres` e `tunnel` no Portainer: túnel caído? réplica atrasada ou no
   basebackup? dump ainda rodando?) ou publicar com `DUMP_MODE=vps` por um deploy (`gh variable set DUMP_MODE --body
   vps`; o `pg_dump` volta a rodar na VPS, custa CPU e disco). Um dump que termine depois do prazo ainda deixa o recibo:
   o deploy seguinte o aceita como recibo recente.

Regra operacional que continua valendo: no máximo um deploy com migration por dia, de madrugada, com `st` abaixo de 20
%. `skip_dump=1` continua pulando os dois modos (só com o OK do dono). Nada muda no deploy sem migration.

## Operação diária

- **Dump diário**: 03:30 UTC pelo cron do `dumper`. Estado em `NAS_BACKUP_PATH/last_dump.txt`; recibo na VPS com
  `preparar-replica.sh --status`.
- **Dump sob demanda**: `exec` no `nas-replica-dumper-1` (`/dump.sh` ou `/dump.sh pre-migrate <rótulo>`), ou o
  arquivo-gatilho `NAS_BACKUP_PATH/.dump-now`. O deploy com migration pede sozinho ([acima](#deploy-sem-dump-local)).
- **Alertas** (`backup-disco`, push): `BackupCheckFailed` (verificador da VPS: sem prova de backup com até 26 h, ou dump
  semanal local com mais de 8 dias), `NasDumpStale` (sem recibo novo do NAS há 26 h, só enquanto
  `BACKUP_DUMP_SOURCE=nas`: o verificador registra o job `backup-mode-nas` a cada 6 h e o alerta exige um com menos de
  12 h), `BackupStale` (nem o NAS nem a VPS dumparam em 26 h). O slot e a conexão de replicação não têm exporter: a
  consulta está em [Paradas](#paradas) e o `--status` a imprime; conferir uma vez por semana enquanto não houver alerta.
- **Onde ver**: logs dos três contêineres no Portainer; na VPS, `preparar-replica.sh --status`.

## Paradas

| Sinal | Causa provável | O que fazer |
| --- | --- | --- |
| `last_dump.txt`: `réplica atrasada: N MB de WAL por aplicar` | A réplica recebeu mas não aplicou (um `pg_dump` longo segura o replay por `max_standby_streaming_delay=-1`, NAS lento) ou o túnel ficou fora e ela está alcançando | Esperar; `select now() - pg_last_xact_replay_timestamp()` na réplica cai sozinho. Persistindo, log do `postgres` do NAS |
| Log do `dumper`: `o replay da réplica estava pausado` | Alguém rodou `pg_wal_replay_pause()` à mão | O `dump.sh` retoma sozinho quando pode; sem permissão, `select pg_wal_replay_resume()` como superusuário na réplica |
| Deploy: `o NAS não atendeu o pedido de dump em 20 min` | NAS fora, túnel caído, réplica atrasada ou ainda no basebackup, `pg_dump` mais longo que `NAS_DUMP_WAIT_MIN`, ou outro dump rodando (trava) | `last_dump.txt` e logs no Portainer; `--status` na VPS. Dump só demorou: disparar o deploy de novo (o recibo que chegou depois vale). Pressa: `DUMP_MODE=vps` por um deploy |
| `postgres` do NAS reiniciando com `replication slot "nas_replica" already exists` (versões anteriores do entrypoint) | Sobra de um basebackup interrompido | O entrypoint atual apaga sozinho um slot inativo antes do basebackup; se não conseguir, `select pg_drop_replication_slot('nas_replica')` na VPS |
| `--status`: slot `active=f` | A réplica não está conectada: túnel caído, `postgres` do NAS parado, ou a réplica está refazendo o basebackup | Logs de `tunnel` e `postgres` no Portainer; o `autossh` reconecta sozinho quando a VPS volta a responder |
| `--status`: slot `wal_status=lost`; `last_dump.txt` manda refazer; log do `postgres` do NAS com "requested WAL segment … has already been removed" | O NAS ficou fora por mais WAL que `max_slot_wal_keep_size` (4 GB) e a produção invalidou o slot, de propósito, para não encher o disco | [Refazer a réplica](#refazer-a-réplica) |
| `tunnel` reiniciando; `pg_isready -h tunnel` falha | Chave do túnel fora do `authorized_keys`, `known_hosts` desatualizado (VPS recriada), `replica-proxy` parado, porta ocupada | `preparar-replica.sh --status` (proxy e chaves); `ssh-keyscan -t ed25519` da VPS para o `known_hosts` do NAS |
| `last_dump.txt`: `pouco espaço em /data` | Disco do NAS cheio | Liberar espaço (os `monthly/` mais antigos saem sozinhos pela rotação; `pre-migrate/` guarda 2) |
| `last_dump.txt`: `a réplica NÃO está em recuperação`; `postgres` do NAS não sobe ("não é mais um standby") | Alguém promoveu a réplica (ou apagou o `standby.signal`) | Nunca dumpar daí: a cópia divergiu. [Refazer a réplica](#refazer-a-réplica) |
| `last_dump.txt`: `a VPS não gravou o recibo`; `NasDumpStale` | A chave de recibo ainda tem o comando antigo (`touch`), ou o `galaxie-nas-receipt` saiu do lugar | `preparar-replica.sh` na VPS (idempotente) |
| Disco da VPS crescendo em `pg_wal` | Slot segurando WAL com o NAS fora | É o esperado até 4 GB; passou disso, o slot é invalidado sozinho. Para cortar antes: `select pg_drop_replication_slot('nas_replica')` e refazer a réplica depois |
| **NAS queimou, sem energia ou sem internet** | — | Nada para a produção: ela segue, o slot segura até 4 GB de WAL e depois se invalida; o dump semanal da VPS continua; o deploy com migration ou espera o NAS, ou roda com `DUMP_MODE=vps` uma vez. NAS de volta: o `autossh` reconecta; se o slot se perdeu, refazer a réplica. NAS perdido de vez: com a [cópia fora de casa](#cópia-fora-de-casa-opcional) ligada há um dump de até 24 h lá; sem ela, o semanal da VPS |

Consulta do slot e da conexão (a mesma do `--status`), para quem quiser olhar à mão na VPS:

```sql
select slot_name, active, wal_status, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) as retido,
       pg_size_pretty(safe_wal_size) as folga
  from pg_replication_slots;
select application_name, client_addr, state, sent_lsn, replay_lsn, replay_lag from pg_stat_replication;
```

## Refazer a réplica

Quando o slot foi perdido (`wal_status=lost`), a réplica foi promovida, ou o volume do NAS se perdeu:

1. Na VPS, se o slot ainda existir: `select pg_drop_replication_slot('nas_replica')` (o `pg_basebackup` o cria de novo).
2. No Portainer: parar a stack `nas-replica`, apagar o volume `nas-replica_pgdata`, subir a stack. O
   `replica-entrypoint.sh` refaz o basebackup do zero (passo 4 de novo).
3. `--status` na VPS até `streaming`; depois um `/dump.sh` e o recibo.

Produção intacta nos três passos: só o slot é tocado, e ele não guarda dado.

## Volta atrás

Em qualquer ordem, cada um independente:

- Deploy: `gh variable set DUMP_MODE --body vps` (ou `gh variable delete DUMP_MODE`): o `pg_dump` volta para a VPS no
  próximo deploy com migration.
- VPS: `BACKUP_DUMP_SOURCE=vps`, `BACKUP_DAYS=` (vazio) e `BACKUP_KEEP_DAILY=3` no `.env`, `up -d --no-deps backup`.
  **Alerta preso?** Não: a série `nas-dump` continua no banco (o último recibo envelhece para sempre), mas o
  `NasDumpStale` exige o job `backup-mode-nas` com menos de 12 h, que o verificador só registra em modo `nas`; duas
  verificações depois (12 h) o alerta desarma sozinho, e o `BackupStale` volta a depender só do `pg-backup`, que o
  diário da VPS alimenta de novo.
- NAS: `NAS_DUMPS_FROM_REPLICA=0` na stack de backup (o `rsync` dos dumps volta); parar a stack `nas-replica`. O slot
  pode ficar (`max_slot_wal_keep_size` o limita); para tirar: `pg_drop_replication_slot('nas_replica')`. O
  `replica-proxy` e as chaves são inofensivos; para desfazer de vez, `docker compose -f compose.dados.yml rm -sf
  replica-proxy` e apagar as linhas `galaxie-nas-tunnel` do `authorized_keys` (a de recibo fica: o `nas-pull.sh` a usa).

## Restaurar a partir de um dump do NAS

O [`restore.sh`](../../infra/backup/README.md#restore-testado) da VPS lê qualquer dump no volume `backups`, no mesmo
formato (em claro ou `.dump.age`, com a chave do ensaio no `.env`). Copie o dump e o `.sha256` do NAS para a VPS (pela
máquina de dev: `scp` do NAS para a VPS, ou `docker cp` de dentro do contêiner `dumper` para a pasta do NAS e daí
`scp`), em `/var/lib/docker/volumes/galaxie-sports_backups/_data/`, e siga o restore de sempre:

```bash
docker compose stop api site console live ingestor agents webhooks
docker compose -f compose.dados.yml exec backup restore.sh --yes galaxie_sports_<data>.dump
docker compose run --rm migrate && docker compose start api site console live ingestor agents webhooks
```

Num dump `pre-migrate/` do NAS (a volta de um deploy com migration), o nome é
`galaxie_sports_pre-migrate_<data>_<antigo>-<novo>.dump`. Com a VPS perdida, o roteiro é o de
[exercicio-dr.md › Cenários](exercicio-dr.md#cenários-de-desastre-e-resposta), com o dump vindo do NAS (ou da cópia fora
de casa).

## Cópia fora de casa (opcional)

Desligada por padrão; **a decisão é do Wagner**. Liga-se com `OFFSITE_RCLONE_REMOTE` na stack `nas-replica`, e exige o
dump cifrado (`DUMP_AGE_RECIPIENTS`, as chaves públicas da recuperação e do ensaio: a privada da recuperação fica só com
ele, fora do NAS, como em [exercicio-dr.md › Dumps cifrados](exercicio-dr.md#dumps-cifrados)). Passos, todos fora do git:

1. Bucket privado num S3 compatível: Cloudflare R2 (10 GB no nível grátis; um dump cifrado de ~4,5 GB × `OFFSITE_KEEP=2`
   cabe) ou Backblaze B2. Crie um token/chave **só desse bucket**, com leitura, escrita e remoção.
2. `NAS_REPLICA_PATH/rclone.conf` (modo 600), por exemplo para o R2:

   ```ini
   [r2]
   type = s3
   provider = Cloudflare
   access_key_id = <id da chave>
   secret_access_key = <segredo>
   endpoint = https://<id da conta>.r2.cloudflarestorage.com
   acl = private
   ```

3. Na stack: `OFFSITE_RCLONE_REMOTE=r2:galaxie-dumps` (remoto:bucket, opcionalmente `/pasta`), `OFFSITE_KEEP=2`,
   `DUMP_AGE_RECIPIENTS=age1…,age1…`. Redeploy e um `/dump.sh`: o `last_dump.txt` passa a terminar com `cópia fora de
   casa em r2:galaxie-dumps`.
4. Conferir de fora: `rclone lsl r2:galaxie-dumps` na máquina de dev com o mesmo `rclone.conf`. Restaurar daí é baixar o
   `.dump.age` e o `.sha256` para o volume da VPS e seguir [Restaurar](#restaurar-a-partir-de-um-dump-do-nas).

Sem `DUMP_AGE_RECIPIENTS`, o `dump.sh` recusa enviar e diz por quê (o dump e o recibo saem normalmente);
`OFFSITE_ALLOW_PLAINTEXT=true` força, e não é recomendado.

## Segurança

- A chave do túnel só encaminha porta para `127.0.0.1:5432` da VPS; a de recibo só roda o `galaxie-nas-receipt`, que só
  escreve dois arquivos no volume de backups (os recibos) e lê um (o pedido), com campos validados e sem expansão de
  glob (`set -f`). Nenhuma das duas abre shell. O NAS nunca executa nada que venha da VPS além do rótulo do dump, que
  é validado dos dois lados.
- O papel `replicador` só tem `REPLICATION` e `LOGIN`: lê WAL e as views de sistema (o `dump.sh` consulta
  `pg_replication_slots` com ele), nenhuma tabela. A senha fica no `.env` da VPS e nas variáveis da stack do NAS.
- O `replica-proxy` publica só em loopback da VPS. O NAS tem a cópia inteira do banco em claro (como já tinha os dumps):
  é a LAN do dono, e a cópia que sai de lá (fora de casa) vai cifrada.
- Nada de segredo, chave ou IP real no repositório: `env.example` tem placeholders.
