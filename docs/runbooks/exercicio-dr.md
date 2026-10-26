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
| 1 | Volume `backups` da VPS | Dump diário (`pg_dump -Fc`, zstd) + `.sha256` | 7 dumps diários (`BACKUP_KEEP_DAILY=7`, por contagem: com o backup parado, nada some) | serviço `backup` |
| 2 | NAS do dono (fora da VPS) | Cópia dos dumps e `.sha256` | 14 diários + 8 semanais + 12 mensais | o NAS (o dono configura, abaixo) |
| 3 | Provedor da VPS | Snapshot diário da VPS inteira | a do provedor | provedor da VPS |

A cópia para um S3 externo (`BACKUP_S3_*`) continua opcional e pode somar uma camada (retenção pela regra de ciclo de
vida do bucket). O snapshot do provedor recupera a VPS inteira de uma vez, mas não substitui o dump: é uma imagem do
disco, sem conferência de que o banco nele está íntegro.

### O que o NAS deve fazer (configurado pelo dono, fora deste repositório)

1. **Puxar** os dumps uma vez por dia, depois do backup (a partir das 05:00 UTC, com folga para o dump das 03:30): por
   SSH com uma chave só de leitura restrita à pasta do volume (`/var/lib/docker/volumes/galaxie-sports_backups/_data`
   na VPS; confira o nome com `docker volume inspect galaxie-sports_backups`), por exemplo `rsync -a` com
   `command="rrsync -ro <pasta>",restrict` no `authorized_keys`. Copie o `.dump` e o `.sha256`.
2. **Conferir** cada dump novo com `sha256sum -c <arquivo>.sha256` antes de considerá-lo guardado.
3. **Rodar a rotação** avô-pai-filho: 14 diários, 8 semanais (o dump de domingo) e 12 mensais (o do dia 1). Ferramentas
   de NAS fazem isso direto (rotação por versões); num script, mantenha três pastas e apague por idade em cada uma.
4. **Deixar o recibo** depois de copiar e conferir, com uma segunda chave SSH cujo único comando é tocar o arquivo:
   `command="touch /var/lib/docker/volumes/galaxie-sports_backups/_data/.nas_last_pull",restrict ssh-ed25519 ...`.
   Com o recibo funcionando, ligue `BACKUP_NAS_RECEIPT=true` no `.env` da VPS: o verificador passa a acusar cópia do NAS
   com mais de 26 h (alerta `BackupCheckFailed`).

Frequência e retenção que o NAS usa hoje: a confirmar pelo dono. Enquanto `BACKUP_NAS_RECEIPT=false`, nada no
repositório sabe se a cópia do NAS está em dia.

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
