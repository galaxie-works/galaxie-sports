#!/bin/sh
# Healthcheck da imagem de backup (HEALTHCHECK do Dockerfile): saudável enquanto a última verificação do backup
# (backup-check.sh) tiver passado há menos de BACKUP_CHECK_INTERVAL_H + 1 horas. O agendador roda o verificador na
# partida e a cada BACKUP_CHECK_INTERVAL_H horas, e ele grava $BACKUP_DIR/.last_check_ok só quando passa; o que ele
# cobra depende do modo (BACKUP_DUMP_SOURCE): o dump local com até 26 h (vps) ou o recibo do dump feito na réplica do
# NAS (nas), mais a cópia do NAS e o sync do S3 quando ligados. Antes o healthcheck olhava só o dump local
# (.last_success), e com o dump semanal da VPS (BACKUP_DAYS) o contêiner ficava unhealthy de terça a sábado.
set -u
: "${BACKUP_DIR:=/backups}"
: "${BACKUP_CHECK_INTERVAL_H:=6}"
[ "$BACKUP_CHECK_INTERVAL_H" -ge 1 ] 2>/dev/null || BACKUP_CHECK_INTERVAL_H=6
find "$BACKUP_DIR/.last_check_ok" -mmin "-$(((BACKUP_CHECK_INTERVAL_H + 1) * 60))" 2>/dev/null | grep -q .
