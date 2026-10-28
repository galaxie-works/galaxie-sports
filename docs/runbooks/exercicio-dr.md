# Backup e recuperação de desastre (DR): política, ensaio e exercício

Política de backup do Postgres, o que roda sozinho (verificador, ensaio mensal e alertas), o que o NAS do dono faz, e
o roteiro do exercício completo, com o registro dos exercícios feitos. O procedimento operacional (restore real e
rollback) está em [infra/portainer/README.md §Backups e §Restore](../../infra/portainer/README.md#backups).

## Objetivos

| Métrica | Alvo | Observação |
|---|---|---|
| RPO (perda máxima de dados) | 24 h | Dump diário (`BACKUP_TIME`, 03:30 UTC). O `raw` perdido pode ser rebuscado no fornecedor, mas custa cota |
| RTO (tempo até a API voltar) | 2 h | Do incidente declarado à API respondendo `/health/db` com o banco restaurado (inclui baixar o dump do NAS ou subir uma VPS nova) |
| Ensaio de restauração | Mensal, automático | `restore-drill.sh` no dia 1 (abaixo); o CI roda o ciclo completo em banco descartável (`infra/backup/e2e-test.sh`) |
| Exercício completo | Trimestral, manual | Roteiro abaixo, com a API subindo sobre o banco restaurado |

## Política de retenção (3-2-1, avô-pai-filho)

Três cópias, em dois lugares diferentes, uma fora da VPS:

| Camada | Onde | O que | Retenção | Quem mantém |
|---|---|---|---|---|
| 1 | Volume `backups` da VPS | Dump diário (`pg_dump -Fc`, zstd; cifrado com age, `.dump.age`, com `BACKUP_AGE_RECIPIENTS`) + `.sha256` | 7 dumps diários (`BACKUP_KEEP_DAILY=7`, por contagem: com o backup parado, nada some) | serviço `backup` |
| 2 | NAS do dono (fora da VPS) | Cópia dos dumps (cifrados: o NAS nunca tem a chave) e `.sha256` | 14 diários + 8 semanais + 12 mensais | stack `galaxie-sports-backup-nas` no NAS (abaixo) |
| 3 | Provedor da VPS | Snapshot diário da VPS inteira | a do provedor | provedor da VPS |

A cópia para um S3 externo (`BACKUP_S3_*`) continua opcional e pode somar uma camada (retenção pela regra de ciclo de
vida do bucket). O snapshot do provedor recupera a VPS inteira de uma vez, mas não substitui o dump: é uma imagem do
disco, sem conferência de que o banco nele está íntegro.

### Cópia no NAS

Roda no NAS desde 26/10/2026, na stack `galaxie-sports-backup-nas` do Portainer do NAS (ambiente `local`), com o
compose [infra/nas-backup/compose.yml](../../infra/nas-backup/compose.yml) e o script
[infra/nas-backup/nas-pull.sh](../../infra/nas-backup/nas-pull.sh). Um container `alpine` com `crond` roda o script às
05:15 e às 17:15 UTC (`NAS_PULL_CRON`; a das 17:15 é a reserva) e na partida. Cada execução:

1. **Lista** os dumps do volume `backups` da VPS e, para cada dia UTC dos últimos 14, **baixa** o dump mais recente
   daquele dia com o `.sha256`, se o NAS ainda não o tem (`rsync --partial`: uma cópia interrompida continua de onde
   parou). O NAS guarda um dump por dia. Se a VPS tiver um mais novo do mesmo dia (o backup roda também na partida do
   serviço, a cada deploy), o novo substitui o anterior depois de conferido.
2. **Confere** o sha256 de cada dump baixado antes de movê-lo para `daily/`. Se não conferir, apaga a cópia e falha.
3. **Faz a rotação** avô-pai-filho por hardlink, sem duplicar espaço: `daily/` fica com os 14 dias mais recentes,
   `weekly/` com o último dump de cada semana ISO (8 semanas; normalmente o de domingo) e `monthly/` com o último de
   cada mês (12 meses). A rotação conta dumps, não idade: com a cópia parada, nada some.
4. **Deixa o recibo** `.nas_last_pull` no volume da VPS, mas só quando o próprio dump mais recente da VPS está
   guardado e conferido. Com `BACKUP_NAS_RECEIPT=true`, que é o padrão do compose da VPS desde este PR, o verificador acusa
   cópia do NAS com mais de 26 h (alerta `BackupCheckFailed`).

**Onde fica, no NAS** (`NAS_BACKUP_PATH`, hoje `/volume1/Docker/galaxie-sports-backups`): `daily/`, `weekly/`,
`monthly/` (dumps e `.sha256`), `incoming/` (cópia em andamento), `ssh/` (chaves e `known_hosts`), `nas-pull.sh`
(cópia do script do repositório) e `last_run.txt`, com o resultado da última execução.

**Acesso à VPS**: duas chaves ed25519 geradas no próprio NAS (`ssh/pull_ed25519` e `ssh/receipt_ed25519`), que nunca
saem de lá. No `authorized_keys` do root da VPS, cada uma tem `restrict` e um comando fixo:

```text
command="/usr/bin/rrsync -ro /var/lib/docker/volumes/galaxie-sports_backups/_data",restrict ssh-ed25519 ... galaxie-nas-pull
command="touch /var/lib/docker/volumes/galaxie-sports_backups/_data/.nas_last_pull",restrict ssh-ed25519 ... galaxie-nas-receipt
```

A primeira só lista e lê a pasta dos backups: escrever, sair da pasta, rodar comando e abrir shell são recusados
(conferido na instalação). A segunda só toca o recibo, qualquer que seja o comando pedido. O host da VPS é conferido
pelo `ssh/known_hosts` (`StrictHostKeyChecking=yes`). Se a VPS for recriada, atualize esse arquivo com a chave nova
(`ssh-keyscan -t ed25519 <vps>`, conferida pelo console do provedor).

**Operação**:

- Estado: `last_run.txt` na pasta, ou o log do container `galaxie-sports-backup-nas-backup-nas-1` no Portainer do NAS.
  Na VPS: `ls -la --time-style=full-iso /var/lib/docker/volumes/galaxie-sports_backups/_data/.nas_last_pull`.
- Rodar já: reinicie o container (`NAS_PULL_ON_START=true`) ou, no console dele, `. /etc/nas-pull.env; sh /data/nas-pull.sh`.
- Atualizar o script: copie `infra/nas-backup/nas-pull.sh` para a pasta do NAS. O compose roda o arquivo da pasta, então
  não precisa refazer a stack.
- Restaurar a partir do NAS: copie o dump e o `.sha256` para o volume `backups` da VPS (ou de uma VPS nova) e siga
  [Cenários de desastre](#cenários-de-desastre-e-resposta).
- Trocar as chaves: gere outras em `ssh/` no NAS, substitua as linhas `galaxie-nas-*` no `authorized_keys` da VPS e
  reinicie o container.
- Desligar a cópia: pare a stack no NAS e ponha `BACKUP_NAS_RECEIPT=false` no `.env` da VPS. Senão, o alerta dispara em
  26 h.

### Dumps cifrados (age)

Com `BACKUP_AGE_RECIPIENTS` no `.env` da VPS, o dump sai do contêiner só cifrado com [age](https://age-encryption.org)
(`galaxie_sports_<data>.dump.age`), para o volume, o NAS e o S3.

- **Durante o backup.** O dump em claro existe só enquanto a execução roda: o `pg_restore --list` confere o arquivo, o
  `age` cifra e o claro é apagado. O `.sha256` é o do arquivo cifrado.
- **No NAS.** O NAS guarda o `.age` como veio. Ele nunca tem uma chave privada, então a cópia de 12 meses de lá não se
  lê sem a chave de recuperação.

**As duas chaves:**

| chave | pública | privada | para quê |
| --- | --- | --- | --- |
| recuperação | em `BACKUP_AGE_RECIPIENTS` | **só com o Wagner**, fora da VPS e do NAS | restaurar quando a VPS se perdeu |
| ensaio | em `BACKUP_AGE_RECIPIENTS` | `BACKUP_AGE_IDENTITY` no `.env` da VPS | ensaio mensal, `restore.sh` e a conferência de cada dump |

A chave do ensaio na VPS não abre nada que a VPS já não tenha: quem controla a VPS tem o banco vivo. Ela existe para o
ensaio mensal provar que o arquivo guardado decifra e restaura. Sem ela, o ensaio de um dump cifrado falha e registra
o erro (alerta), em vez de passar em silêncio.

**Ligar (uma vez, com o OK do Wagner):**
1. **Chave de recuperação, na máquina do Wagner** (nunca na VPS): rodar `age-keygen -o galaxie-backup-recuperacao.key`.
   O comando mostra a chave pública (`age1…`). Para instalar o `age`: `winget install FiloSottile.age` no Windows ou
   `brew install age` no macOS.
2. **Guardar a chave privada de recuperação** em dois lugares:
   - no gerenciador de senhas do Wagner, como nota segura `Galaxie Sports, chave de recuperação dos backups`, com o
     conteúdo do arquivo;
   - numa cópia offline (pendrive ou papel com o `AGE-SECRET-KEY-1…`), guardada junto dos outros documentos da
     empresa.

   Depois, apague o arquivo da máquina. Sem essa chave, os dumps do NAS não se leem. A chave nunca vai para a VPS, o
   NAS, o repositório ou o chat.
3. **Chave do ensaio, na VPS:** rode `docker compose run --rm --no-deps --entrypoint age-keygen backup </dev/null`.
   - A linha `AGE-SECRET-KEY-1…` vai em `BACKUP_AGE_IDENTITY=` no `.env`.
   - A linha `# public key: age1…` vai em `BACKUP_AGE_RECIPIENTS`.
4. **Destinatários e recriação.** Ponha `BACKUP_AGE_RECIPIENTS=<pública da recuperação>,<pública do ensaio>` no `.env`
   e rode `docker compose up -d --no-deps backup`. A partida já faz um backup (`BACKUP_ON_START=true`).
5. **Conferência:**
   - `docker compose exec backup sh -c 'ls -l /backups | tail -3'` tem de mostrar o `.dump.age` mais recente;
   - `docker compose exec backup restore-drill.sh` tem de terminar OK;
   - no dia seguinte, o `last_run.txt` do NAS tem de citar o `.dump.age`.

**Restaurar com a chave de recuperação (VPS perdida):** copie o `.dump.age` e o `.sha256` do NAS. Depois:
1. `sha256sum -c galaxie_sports_<data>.dump.age.sha256`
2. `age -d -i galaxie-backup-recuperacao.key -o galaxie_sports_<data>.dump galaxie_sports_<data>.dump.age`
3. Ponha o `.dump` no volume `backups` e siga os [Cenários de desastre](#cenários-de-desastre-e-resposta).

Outra opção: rode o `restore.sh` com `BACKUP_AGE_IDENTITY` igual à chave de recuperação, só durante a restauração.

**Transição:** os dumps em claro de antes continuam no NAS até a rotação apagá-los, em 14 dias (diários), 8 semanas
e 12 meses (mensais). Para acabar com eles antes, apague `daily/`, `weekly/` e `monthly/*.dump` no NAS (os `.dump.age`
ficam).

## O que roda sozinho

O serviço `backup` (`infra/backup/entrypoint.sh`) agenda, em UTC:

| Quando | Script | O que faz | Registro (`ops.job_run`) e alerta |
|---|---|---|---|
| Diário, `BACKUP_TIME` (03:30) e na partida | `backup.sh` | Dump, `pg_restore --list`, `.sha256`, cópia S3 opcional, mantém os 7 mais recentes | `pg-backup` → `BackupStale` (sem sucesso há 26 h) |
| A cada `BACKUP_CHECK_INTERVAL_H` (6 h) e depois de cada dump | `backup-check.sh` | Último dump com no máximo 26 h; com `BACKUP_NAS_RECEIPT=true`, recibo do NAS com no máximo 26 h | `backup-check` → `BackupCheckFailed` (1ª falha) |
| Dia `RESTORE_DRILL_DAY` (1) de cada mês, depois do dump | `restore-drill.sh` | Restaura o dump mais recente em `<banco>_drill_<data>` (nunca o de produção), confere e apaga | `pg-restore-drill` → `RestoreDrillFailed` (1ª falha), `RestoreDrillStale` (sem sucesso há 35 dias) |

O ensaio confere: dump com no máximo 26 h e `.sha256` certo; espaço livre de pelo menos 2x o tamanho do banco no disco
dos volumes; `pg_restore` sem erro; migrations aplicadas no restaurado (> 0 e não mais que na produção); linhas em
`core.competition`, `core.event`, `raw.api_response` e `ops.job_run` (`RESTORE_DRILL_TABLES`); e última atualização de
partida até 72 h antes do dump (`RESTORE_DRILL_EVENT_MAX_AGE_H`). O resultado, com tempos e contagens, fica em
`ops.job_run.stats`. Avulso: `docker compose exec backup restore-drill.sh`. Banco temporário de um ensaio interrompido é
apagado no ensaio seguinte.

Os alertas (e os demais: disco acima de 85%, API fora, fila do change feed parada) saem do Prometheus e vão por e-mail
pelo Grafana quando o SMTP está configurado; sem SMTP, ficam visíveis no Grafana. Como ligar:
[infra/vps-telemetry/README.md §Alertas por e-mail](../../infra/vps-telemetry/README.md#alertas-por-e-mail).

## Roteiro do exercício completo

Nunca use `restore.sh --yes` com `PGDATABASE` apontando para o banco real fora de um incidente: a restauração real
**substitui** o banco. O exercício restaura num banco descartável.

1. **Dump** (somente leitura no banco de origem) com a imagem de backup do repositório:
   ```bash
   docker build -t galaxie-sports-backup:dev infra/backup
   docker volume create galaxie-dr-drill
   TS=$(date -u +%Y%m%dT%H%M%SZ)
   docker run --rm --network galaxie-sports_default -v galaxie-dr-drill:/backups \
     -e PGHOST=postgres -e PGUSER=galaxie -e PGPASSWORD=galaxie -e PGDATABASE=galaxie_sports \
     galaxie-sports-backup:dev pg_dump -Fc --no-owner --no-privileges \
     -f /backups/galaxie_drill_$TS.dump galaxie_sports
   ```
   Em staging, use o dump mais recente do volume `backups` (ou da cópia S3) em vez de gerar um novo — o exercício deve
   provar que **o backup que existe** é restaurável.
2. **Ensaio** (restaura em `galaxie_drill_restore_check`, confere e apaga):
   ```bash
   docker run --rm --network galaxie-sports_default -v galaxie-dr-drill:/backups \
     -e PGHOST=postgres -e PGUSER=galaxie -e PGPASSWORD=galaxie -e PGDATABASE=galaxie_drill \
     galaxie-sports-backup:dev restore.sh --verify latest
   ```
3. **Restauração real num alvo descartável**: crie um `galaxie_drill` vazio (simula o banco perdido) e rode
   `restore.sh --yes latest` com `PGDATABASE=galaxie_drill`. O script restaura em `galaxie_drill_restoring`, confere e
   troca pelo nome, guardando o anterior como `galaxie_drill_pre_restore_<data>`.
4. **Conferência**: compare as contagens (`core.competition`, `core.season`, `core.standing`, `raw.api_response`,
   `drizzle.__drizzle_migrations`) entre origem e restaurado; aplique as migrations pendentes
   (`runMigrations`/`pnpm db:migrate` com `DATABASE_URL` do banco restaurado).
5. **Prova de vida da API**: suba a API apontando para o banco restaurado e rode o smoke de carga
   ([tests/load](../../tests/load/README.md)) — respostas 200 do catálogo e do autoatendimento.
6. **Limpeza**: `DROP DATABASE galaxie_drill WITH (FORCE)` (e `_pre_restore_*`), `docker volume rm galaxie-dr-drill`.
7. **Registro**: acrescente uma linha na tabela abaixo (data, origem, tamanho, tempos, divergências, ações).

## Registro dos exercícios

| Data (UTC) | Ambiente | Dump | Tempos | Conferência | Resultado / ações |
|---|---|---|---|---|---|
| 2026-10-21 | Local (Docker Desktop, Postgres 17, banco de dev com 67 MB) | `pg_dump -Fc` 8,6 MiB + `.sha256` | dump ≤ 5 s · ensaio `--verify` 5 s · restauração real com troca de nome 5 s · migrations pendentes (0007) < 1 s | `core.competition` 1249 = 1249 · `core.season` 8781 = 8781 · `core.standing` 220 = 220 · `raw.api_response` 522 = 522 · migrations 7 = 7 (+1 aplicada depois) | **OK.** API do branch subiu sobre o banco restaurado; tenant criado pela API administrativa e smoke k6 de 30 s por cenário com 0% de erro (números no PR da issue #85). Ações: nenhuma bloqueante; repetir em staging com o dump real do volume `backups` e a cópia S3 quando a stack estiver no ar |

## Cenários de desastre e resposta

| Cenário | Resposta |
|---|---|
| Banco corrompido / `DROP` acidental | Pare API e ingestor → `restore.sh --yes latest` → confira → suba os serviços. Perda: desde o último dump |
| VPS perdida | Primeiro, o snapshot diário do provedor da VPS (volta a VPS inteira do dia anterior). Sem ele: nova VPS → stack → copie o dump mais recente do NAS (com o `.sha256`) para o volume `backups` e rode `restore.sh --yes <dump>` (ou, com S3, `restore.sh --yes s3://...`; ele baixa e confere o `.sha256` e para sem ele, salvo `--no-checksum`) → DNS. Segredos vêm do secret store, não do disco perdido |
| Valkey perdido | Sem restauração: cache e rate limit se reconstroem; contadores de uso do dia corrente voltam a partir do último consolidado em `api.usage_daily` (o flush usa `greatest`, nada regride) |
| Bucket de assets perdido | `assets:mirror` rebaixa da CDN de mídia (fora da cota); `core.asset` guarda as URLs de origem |
| Vazamento de segredo | [SECURITY.md §Rotação de segredos](../../SECURITY.md#rotação-de-segredos) |
