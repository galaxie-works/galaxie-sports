# infra/nas-replica

Stack `nas-replica` do Portainer do NAS: a **réplica física em streaming** do Postgres de produção e os **dumps feitos a
partir dela**, para a VPS parar de gastar CPU e disco com `pg_dump` (decisão de 17/11/2026; épico #1304). Passo a passo,
paradas e volta atrás: [docs/runbooks/replica-no-nas.md](../../docs/runbooks/replica-no-nas.md). O NAS só é operado pela
API do Portainer (stacks, variáveis, `exec`); nada aqui pede SSH no NAS.

| Arquivo | O que é |
| --- | --- |
| [`compose.yml`](compose.yml) | A stack: `tunnel` (SSH NAS → VPS, só encaminhamento de porta), `postgres` (hot standby `postgres:17-alpine`) e `dumper` (`pg_dump` diário e sob demanda, recibo na VPS, cópia fora de casa opcional) |
| [`env.example`](env.example) | Todas as variáveis da stack, com os padrões; os segredos sem padrão. Copie para as variáveis da stack no Portainer; nunca commite preenchido |
| [`replica-entrypoint.sh`](replica-entrypoint.sh) | Entrypoint do `postgres`: na primeira subida apaga um slot inativo que tenha sobrado e faz o `pg_basebackup` pelo túnel (slot `nas_replica`, `-R`) num subdiretório do volume, depois sobe como standby; recusa subir um cluster que saiu da recuperação |
| [`dump.sh`](dump.sh) | O dump: conferências (em recuperação, replay pausado à mão, atraso, slot, disco), `pg_dump` sem pausar o replay (snapshot próprio + `max_standby_streaming_delay=-1`), mesmo formato do backup da VPS, `daily/` com a rotação 7/4/6 ou `pre-migrate/`, `--pedido` (o pedido do deploy), recibo `.nas_last_dump` na VPS, `rclone` opcional |
| [`dump.test.sh`](dump.test.sh), [`replica-entrypoint.test.sh`](replica-entrypoint.test.sh) | Testes com binários falsos (`bash infra/nas-replica/dump.test.sh`; rodam no CI, no Linux) |

Os scripts rodam **da pasta do NAS** (`NAS_REPLICA_PATH`, montada em `/replica`), como o `nas-pull.sh` da stack de backup:
o compose não depende de nada ao lado dele no repositório. Atualizar um script é copiar o arquivo novo para a pasta (e
reiniciar o contêiner, no caso do `replica-entrypoint.sh`).

## Como funciona

```text
VPS (produção)                                   NAS (LAN do dono)
┌──────────────────────────────┐                 ┌────────────────────────────────────────────────┐
│ postgres ◄── replica-proxy   │  túnel SSH       │ tunnel ──► tunnel:5432 (= Postgres de produção) │
│   (slot nas_replica)  127.0.0.1:5432 ◄──────────┤   chave só de port-forwarding                  │
│ sshd: galaxie-nas-tunnel     │                 │ postgres (hot standby, WAL em streaming)        │
│       galaxie-nas-receipt ───┼── recibos ◄─────┤ dumper ──► NAS_BACKUP_PATH/daily/*.dump[.age]   │
│ volume backups: .nas_last_dump                 │          └─► rclone (opcional, fora de casa)    │
└──────────────────────────────┘                 └────────────────────────────────────────────────┘
```

1. **`tunnel`** abre `ssh -N -L 0.0.0.0:5432:127.0.0.1:5432` para a VPS com a chave `tunnel_ed25519` (gerada no NAS), que
   no `authorized_keys` da VPS tem `command="/bin/false",restrict,port-forwarding,permitopen="127.0.0.1:5432"`: só pode
   encaminhar para essa porta, sem shell. Na VPS, `127.0.0.1:5432` é o serviço `replica-proxy` do `compose.dados.yml`
   (socat para o `postgres` da stack, com IP fixo na rede da stack: o único que o `pg_hba` aceita para replicação).
   `autossh` reconecta sozinho quando o link cai. Nada entra na LAN do NAS: a conexão sai de lá.
2. **`postgres`** é um hot standby. Na primeira subida o `replica-entrypoint.sh` espera o túnel, apaga na produção um
   slot `nas_replica` inativo que tenha sobrado de um basebackup interrompido (um ativo é de outra réplica, e para) e
   roda `pg_basebackup -h tunnel -U replicador -X stream -R -C -S nas_replica` numa pasta temporária do volume
   (`/var/lib/postgresql/data/basebackup.tmp`); completo, vira `PGDATA` (`…/data/pgdata`, um subdiretório do volume
   nomeado `nas-replica_pgdata`) e o Postgres sobe lendo o `standby.signal`. Dali em diante recebe o WAL em streaming pelo slot `nas_replica`,
   que a produção criou no basebackup: a produção guarda o WAL que a réplica ainda não recebeu, até o teto
   `max_slot_wal_keep_size` da VPS (4 GB; passou disso com o NAS fora, o slot é invalidado e a réplica se refaz). A
   réplica aceita leitura (`hot_standby=on`), nunca escrita, e **nunca é promovida**: o entrypoint recusa subir um
   cluster sem `standby.signal`, e o `dump.sh` recusa dumpar uma réplica que não está em recuperação.
3. **`dumper`** roda o `dump.sh` no horário `DUMP_CRON` (03:30 UTC, o mesmo do dump que a VPS fazia), na partida
   (`DUMP_ON_START=true`, só se o último tiver mais de 20 h), **a pedido do deploy** e sob demanda:
   - pedido do deploy: com `DUMP_MODE=nas`, um deploy com migration que não acha recibo recente deixa o pedido na VPS
     (`.nas_dump_request`) e espera; o cron roda `/dump.sh --pedido` a cada minuto, que lê o pedido pela chave de
     recibo (comando forçado `pedido`), faz o dump em `pre-migrate/` com o rótulo do deploy e toca o recibo, que apaga
     o pedido ([runbook › Deploy sem dump local](../../docs/runbooks/replica-no-nas.md#deploy-sem-dump-local));
   - pela API do Portainer: `exec` no contêiner `nas-replica-dumper-1` com `/dump.sh` (diário) ou
     `/dump.sh pre-migrate <rótulo>`;
   - ou criando o arquivo-gatilho `NAS_BACKUP_PATH/.dump-now` (o cron confere a cada minuto).

   O `pg_dump` roda **sem pausar o replay** (pausar exige superusuário, e o papel de backup não é): ele tem snapshot
   próprio e a réplica sobe com `max_standby_streaming_delay=-1`, então a consulta longa nunca é cancelada por conflito
   com a recuperação (o replay espera e alcança depois). Um replay pausado à mão é retomado antes do dump, quando o papel
   pode; senão fica o aviso. O dump sai no **mesmo formato do backup da VPS** (`infra/backup/backup.sh`: custom, zstd,
   sem dono e privilégios, sem os dados da API do YouTube), conferido com `pg_restore --list`, com `.sha256`, na pasta
   de backups do NAS que a stack `galaxie-sports-backup-nas` já usa: `daily/` (a rotação 7/4/6 da `nas-lib.sh`,
   compartilhada com o `nas-pull.sh`, e a mesma trava `.lock`: os dois nunca mexem em `daily/` ao mesmo tempo) ou
   `pre-migrate/` (os `PRE_MIGRATE_KEEP` mais novos, fora da rotação). O `espelho` semanal produção → dev
   (`infra/nas-dev`) continua lendo `daily/` como antes. Depois, o recibo `.nas_last_dump` na VPS
   (`<quando> <bytes> <arquivo>`), pela chave de recibo que o `nas-pull.sh` já usa: é o que o deploy com `DUMP_MODE=nas`
   e o verificador da VPS (`BACKUP_DUMP_SOURCE=nas`) conferem.

## Variáveis (`env.example`)

| Variável | Padrão | O quê |
| --- | --- | --- |
| `VPS_HOST`, `VPS_USER`, `VPS_PORT` | (obrigatório), `root`, `22` | O SSH da VPS, para o túnel e para o recibo |
| `VPS_PG_BIND` | `127.0.0.1:5432` | Onde o `replica-proxy` publica o Postgres na VPS (o destino do túnel e o `permitopen` da chave) |
| `NAS_REPLICA_PATH` | (obrigatório) | Pasta desta stack no NAS: `replica-entrypoint.sh`, `dump.sh`, `ssh/tunnel_ed25519`, `ssh/known_hosts`, `rclone.conf` (opcional) |
| `NAS_BACKUP_PATH` | (obrigatório) | Pasta da stack `galaxie-sports-backup-nas`: `daily/weekly/monthly`, `nas-lib.sh`, `ssh/receipt_ed25519`, `ssh/known_hosts` |
| `REPLICATOR_PASSWORD` | (obrigatório) | Senha do papel `replicador` da produção, gerada pelo `preparar-replica.sh` no `.env` da VPS; vai para o `.pgpass` do contêiner, nunca para a linha de comando |
| `REPLICA_SLOT` | `nas_replica` | Nome do slot na produção e `application_name` em `pg_stat_replication` |
| `REPLICA_MEM_LIMIT`, `REPLICA_SHARED_BUFFERS`, `REPLICA_EFFECTIVE_CACHE_SIZE` | `2560m`, `512MB`, `1792MB` | Memória da réplica (os valores da produção) |
| `REPLICA_MAX_CONNECTIONS` | `130` | Tem de ser ≥ o da produção, senão o standby não sobe |
| `POSTGRES_DB` | `galaxie_sports` | O banco a dumpar |
| `DUMP_PGUSER`, `DUMP_PGPASSWORD` | `galaxie_backup`, (obrigatório) | Quem lê tudo na réplica: o papel de backup da produção (`pg_read_all_data`) com a senha de `DB_URL_BACKUP` do `.env` da VPS. Os papéis chegam à réplica com os dados |
| `DUMP_CRON`, `DUMP_ON_START` | `30 3 * * *`, `true` | Agenda (UTC) e o dump na partida (só com o último de `daily/` mais velho que 20 h) |
| `DUMP_PREFIX` | `galaxie_sports_` | Prefixo dos arquivos (`galaxie_sports_<AAAAMMDD>T<hhmmss>Z.dump`), o mesmo do backup da VPS e do `nas-pull.sh` |
| `DUMP_MAX_LAG_MB` | `256` | WAL por aplicar (MB, medido contra a produção pelo túnel) acima do qual o dump não sai |
| `NAS_KEEP_DAILY`, `NAS_KEEP_WEEKLY`, `NAS_KEEP_MONTHLY` | `7`, `4`, `6` | Retenção de `daily/weekly/monthly` (a mesma do `nas-pull.sh`; com `NAS_DUMPS_FROM_REPLICA=1` na stack de backup, a rotação passa a ser feita aqui) |
| `PRE_MIGRATE_KEEP` | `2` | Dumps guardados em `pre-migrate/` |
| `DUMP_AGE_RECIPIENTS` | vazio | Chaves **públicas** do age (as mesmas `BACKUP_AGE_RECIPIENTS` da VPS): o dump sai `.dump.age`. Vazio = em claro no NAS (que já tem a réplica inteira em claro). Exigido pela cópia fora de casa |
| `OFFSITE_RCLONE_REMOTE` | vazio | **Opcional, desligado.** Remoto do rclone (`remoto:bucket[/pasta]`) para a cópia fora de casa; o `rclone.conf` fica em `NAS_REPLICA_PATH`, fora do git |
| `OFFSITE_KEEP` | `2` | Dumps mantidos no remoto (os mais novos; os pré-migrate contam) |
| `OFFSITE_ALLOW_PLAINTEXT` | `false` | `true` deixa enviar dump em claro (não recomendado) |

Segredos: `REPLICATOR_PASSWORD` e `DUMP_PGPASSWORD` só nas variáveis da stack no Portainer; as chaves SSH só nas pastas
do NAS. Nada disso vai para o repositório.

## Instalação

Resumo; o passo a passo com as conferências está no [runbook](../../docs/runbooks/replica-no-nas.md):

1. **VPS** (antes de qualquer coisa no NAS): `compose.dados.yml` da `main` na pasta da stack e
   `infra/vps-telemetry/preparar-replica.sh` por SSH (parâmetros de WAL, papel `replicador`, `pg_hba`, `replica-proxy`,
   comando forçado do recibo e a chave do túnel). Ele gera `REPLICATOR_PASSWORD` no `.env` da VPS.
2. **Pasta no NAS** (`NAS_REPLICA_PATH`, ex.: `/volume1/Docker/galaxie-sports-replica`): `replica-entrypoint.sh` e
   `dump.sh` desta pasta; `ssh/tunnel_ed25519` gerada lá (`ssh-keygen -t ed25519 -N '' -C galaxie-nas-tunnel`) e
   `ssh/known_hosts` copiado da stack de backup. Na pasta de backups (`NAS_BACKUP_PATH`), a `nas-lib.sh` de
   `infra/nas-backup` ao lado do `nas-pull.sh`.
3. **Stack no Portainer**: nome `nas-replica`, o `compose.yml` daqui e as variáveis de `env.example` preenchidas. Os
   contêineres saem como `nas-replica-tunnel-1`, `nas-replica-postgres-1` e `nas-replica-dumper-1`. Na mesma hora,
   `NAS_DUMPS_FROM_REPLICA=1` na stack `galaxie-sports-backup-nas` (o `nas-pull.sh` deixa os dumps com esta stack e segue
   só com os assets do S3; o que ele já trouxe fica em `daily/` até a rotação).
4. **Primeira sincronização**: o `postgres` fica horas no `pg_basebackup` (o log mostra o progresso); o `dumper` espera.
   Pronto quando `pg_stat_replication` na VPS mostra `nas_replica` em `streaming` e `select pg_is_in_recovery()` na
   réplica responde `t`.
5. **Primeiro dump**: `exec` no `nas-replica-dumper-1` com `/dump.sh`; confira `NAS_BACKUP_PATH/last_dump.txt` e, na
   VPS, `.nas_last_dump` (`preparar-replica.sh --status`).
6. Só então: `DUMP_MODE=nas` no deploy e `BACKUP_DUMP_SOURCE=nas` + `BACKUP_DAYS=0` + `BACKUP_KEEP_DAILY=3` na VPS
   ([runbook › Ligar](../../docs/runbooks/replica-no-nas.md#7-ligar-o-modo-nas)).

## Cópia fora de casa (opcional; decisão do Wagner)

Responde a "e se o NAS queimar?": além do dump semanal que continua na VPS, o `dumper` pode mandar cada dump para um
bucket S3 fora de casa com o `rclone` (Cloudflare R2, com 10 GB no nível grátis, ou Backblaze B2), guardando só os
`OFFSITE_KEEP` mais novos. **Vem desligada** (`OFFSITE_RCLONE_REMOTE` vazio) e só liga por decisão do dono: custa uma conta
num terceiro, e os dumps são o banco inteiro. Com ela ligada, o dump **tem de sair cifrado** (`DUMP_AGE_RECIPIENTS`); o
`dump.sh` recusa enviar em claro. Como criar o bucket e o `rclone.conf` (fora do git):
[runbook › Cópia fora de casa](../../docs/runbooks/replica-no-nas.md#cópia-fora-de-casa-opcional).

## Estado e paradas

- `NAS_BACKUP_PATH/last_dump.txt`: `ok: …` ou `erro: …` da última execução, com o motivo.
- Logs no Portainer: `dumper` (JSON, `service: nas-replica-dumper`), `postgres` (basebackup, walreceiver, erros de WAL) e
  `tunnel` (autossh).
- Na VPS: `preparar-replica.sh --status` (parâmetros, `pg_stat_replication`, slot, recibos).
- Cada parada (réplica atrasada, slot inativo ou perdido, túnel caído, disco cheio, réplica promovida, recibo com o
  comando antigo, NAS fora) e o que fazer: [runbook › Paradas](../../docs/runbooks/replica-no-nas.md#paradas).
