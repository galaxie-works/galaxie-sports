#!/bin/sh
# Agenda do serviço de backup: um dump por dia em BACKUP_TIME (HH:MM, UTC) e, por padrão, um na partida
# (prova cedo que credenciais, disco e destino remoto funcionam).
set -eu
. /usr/local/lib/galaxie-backup/lib.sh
: "${BACKUP_TIME:=03:30}"
: "${BACKUP_ON_START:=true}"

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

log info "agendador iniciado: backup diário às $BACKUP_TIME UTC, retenção de $BACKUP_RETENTION_DAYS dias"
[ "$BACKUP_ON_START" = true ] && { backup.sh || log error "backup de partida falhou"; }

while true; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) $BACKUP_TIME" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  log info "próximo backup em $(date -u -d "@$next" +%Y-%m-%dT%H:%M:%SZ)"
  sleep $((next - now)) &
  wait $!
  backup.sh || log error "backup agendado falhou"
done
