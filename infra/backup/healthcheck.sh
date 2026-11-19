#!/bin/sh
# Healthcheck da imagem de backup (HEALTHCHECK do Dockerfile): saudável enquanto a última verificação do backup
# (backup-check.sh) tiver passado há menos de BACKUP_CHECK_INTERVAL_H + BACKUP_HEALTH_GRACE_H horas (padrão 6 + 3).
# O agendador roda o verificador na partida e a cada BACKUP_CHECK_INTERVAL_H horas, e ele grava
# $BACKUP_DIR/.last_check_ok só quando passa; o que ele cobra depende do modo (BACKUP_DUMP_SOURCE): o dump local com até
# 26 h (vps), ou o recibo do dump feito na réplica do NAS mais o dump local semanal com até 8 dias (nas), e a cópia do
# NAS e o sync do S3 quando ligados. A folga cobre o dia do dump: o verificador só roda depois do dump e do sync, que
# podem levar mais de uma hora. Antes o healthcheck olhava só o dump local (.last_success), e com o dump semanal da VPS
# (BACKUP_DAYS) o contêiner ficava unhealthy de terça a sábado.
set -u
: "${BACKUP_DIR:=/backups}"
: "${BACKUP_CHECK_INTERVAL_H:=6}"
: "${BACKUP_HEALTH_GRACE_H:=3}"
[ "$BACKUP_CHECK_INTERVAL_H" -ge 1 ] 2>/dev/null || BACKUP_CHECK_INTERVAL_H=6
[ "$BACKUP_HEALTH_GRACE_H" -ge 0 ] 2>/dev/null || BACKUP_HEALTH_GRACE_H=3
find "$BACKUP_DIR/.last_check_ok" -size +0c -mmin "-$(((BACKUP_CHECK_INTERVAL_H + BACKUP_HEALTH_GRACE_H) * 60))" 2>/dev/null | grep -q .
