#!/bin/sh
# Agenda do serviço de backup (UTC):
#   - um dump por dia em BACKUP_TIME (HH:MM) e, por padrão, um na partida (prova cedo que credenciais, disco e
#     destino remoto funcionam);
#   - o verificador (backup-check.sh) a cada BACKUP_CHECK_INTERVAL_H horas (padrão 6) e depois de cada dump;
#   - o ensaio de restauração (restore-drill.sh) no dia RESTORE_DRILL_DAY de cada mês (padrão 1), logo depois do
#     dump do dia; RESTORE_DRILL_DAY=off desliga.
set -eu
# shellcheck source=infra/backup/lib.sh
. "${BACKUP_LIB:-/usr/local/lib/galaxie-backup/lib.sh}"
: "${BACKUP_TIME:=03:30}"
: "${BACKUP_ON_START:=true}"
: "${BACKUP_CHECK_INTERVAL_H:=6}"
: "${RESTORE_DRILL_DAY:=1}"
# intervalo inválido ou 0 viraria um laço sem espera
[ "$BACKUP_CHECK_INTERVAL_H" -ge 1 ] 2>/dev/null || BACKUP_CHECK_INTERVAL_H=6

trap 'log info "encerrando agendador de backup"; exit 0' TERM INT

# Espera o Postgres aceitar conexões.
i=0
until pg_isready -q -d "$PGDATABASE"; do
  i=$((i + 1))
  [ "$i" -ge 60 ] && { log error "Postgres indisponível"; exit 1; }
  sleep 2
done

# No primeiro deploy, dá tempo ao serviço migrate de criar o schema (o registro em ops.job_run depende dele).
i=0
until [ "$(sql_quiet "select to_regclass('ops.job_run') is not null")" = t ] || [ "$i" -ge 60 ]; do
  i=$((i + 1))
  sleep 2
done

drill_info="ensaio de restauração no dia $RESTORE_DRILL_DAY de cada mês"
[ "$RESTORE_DRILL_DAY" = off ] && drill_info="ensaio de restauração desligado"
log info "agendador iniciado: backup diário às $BACKUP_TIME UTC, $BACKUP_KEEP_DAILY dumps na VPS, verificação a cada ${BACKUP_CHECK_INTERVAL_H} h, $drill_info"

daily() {
  backup.sh || log error "backup falhou"
  backup-check.sh || true
  # dia do mês sem zero à esquerda (busybox date não tem %-d)
  if [ "$RESTORE_DRILL_DAY" != off ] && [ "$(date -u +%d | sed 's/^0//')" = "$RESTORE_DRILL_DAY" ]; then
    restore-drill.sh || log error "ensaio de restauração falhou"
  fi
}

if [ "$BACKUP_ON_START" = true ]; then
  backup.sh || log error "backup de partida falhou"
fi
backup-check.sh || true
next_check=$(($(date -u +%s) + BACKUP_CHECK_INTERVAL_H * 3600))

while true; do
  now=$(date -u +%s)
  next_backup=$(date -u -d "$(date -u +%Y-%m-%d) $BACKUP_TIME" +%s)
  [ "$next_backup" -le "$now" ] && next_backup=$((next_backup + 86400))
  if [ "$next_check" -lt "$next_backup" ]; then wake=$next_check; else wake=$next_backup; fi
  [ "$wake" -gt "$now" ] && {
    sleep $((wake - now)) &
    wait $!
  }
  now=$(date -u +%s)
  if [ "$now" -ge "$next_backup" ]; then
    daily
    next_check=$((now + BACKUP_CHECK_INTERVAL_H * 3600))
  elif [ "$now" -ge "$next_check" ]; then
    backup-check.sh || true
    next_check=$((now + BACKUP_CHECK_INTERVAL_H * 3600))
  fi
done
