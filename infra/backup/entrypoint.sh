#!/bin/sh
# Agenda do serviço de backup (UTC):
#   - um dump por dia em BACKUP_TIME (HH:MM) e, por padrão, um na partida (prova cedo que credenciais, disco e
#     destino remoto funcionam) quando o último bem-sucedido tem mais de BACKUP_ON_START_MIN_AGE_H horas (padrão 20;
#     BACKUP_ON_START=always faz sempre). Todo deploy recria este serviço (a imagem leva a tag do deploy): o dump
#     completo, com o COPY do raw, disputava disco e cache com o pós-deploy e o smoke, e vários deploys num dia
#     giravam os 7 diários. Com BACKUP_DAYS (dias da semana, 0 = domingo … 6, vírgula entre eles), o dump só sai nesses
#     dias: é o dump semanal da VPS quando o diário vem da réplica do NAS (docs/runbooks/replica-no-nas.md), o pior caso
#     de NAS e disco da VPS perdidos na mesma semana. Nesse modo o dump de partida só sai com o último mais velho que
#     BACKUP_LOCAL_MAX_AGE_H (padrão 192 h), e não que BACKUP_ON_START_MIN_AGE_H: senão cada deploy faria um dump completo;
#   - com BACKUP_S3_SYNC_PREFIXES ou BACKUP_S3_SYNC_TASKS_BUCKET=true, o sync do S3 (s3-sync.sh) logo depois de cada
#     dump e, se o recibo estiver velho, na partida;
#   - o verificador (backup-check.sh) a cada BACKUP_CHECK_INTERVAL_H horas (padrão 6) e depois de cada dump;
#   - o ensaio de restauração (restore-drill.sh) no dia RESTORE_DRILL_DAY de cada mês (padrão 1), logo depois do
#     dump do dia; RESTORE_DRILL_DAY=off desliga.
set -eu
# shellcheck source=infra/backup/lib.sh
. "${BACKUP_LIB:-/usr/local/lib/galaxie-backup/lib.sh}"
: "${BACKUP_TIME:=03:30}"
: "${BACKUP_DAYS:=}"
: "${BACKUP_LOCAL_MAX_AGE_H:=192}"
: "${BACKUP_ON_START:=true}"
: "${BACKUP_ON_START_MIN_AGE_H:=20}"
[ "$BACKUP_ON_START_MIN_AGE_H" -ge 0 ] 2>/dev/null || BACKUP_ON_START_MIN_AGE_H=20
# semanal (BACKUP_DAYS): a partida só dumpa com o último mais velho que a idade máxima do dump local
if [ -n "$BACKUP_DAYS" ]; then
  printf '%s' "$BACKUP_DAYS" | grep -Eq '^[0-6](,[0-6])*$' || { echo "BACKUP_DAYS='$BACKUP_DAYS' inválido: dias da semana 0-6 separados por vírgula" >&2; exit 1; }
  [ "$BACKUP_LOCAL_MAX_AGE_H" -ge 1 ] 2>/dev/null || BACKUP_LOCAL_MAX_AGE_H=192
  BACKUP_ON_START_MIN_AGE_H="$BACKUP_LOCAL_MAX_AGE_H"
  # o ensaio mensal restaura o dump local mais novo, que pode ter até uma semana (restore-drill.sh)
  export RESTORE_DRILL_MAX_DUMP_AGE_H="${RESTORE_DRILL_MAX_DUMP_AGE_H:-$BACKUP_LOCAL_MAX_AGE_H}"
fi
# hoje é dia de dump? (sem BACKUP_DAYS, sempre)
backup_day() {
  [ -n "$BACKUP_DAYS" ] || return 0
  case ",$BACKUP_DAYS," in *",$(date -u +%w),"*) return 0 ;; esac
  return 1
}
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
when_info="diário"
[ -z "$BACKUP_DAYS" ] || when_info="nos dias $BACKUP_DAYS da semana (0 = domingo)"
log info "agendador iniciado: backup $when_info às $BACKUP_TIME UTC, $BACKUP_KEEP_DAILY dumps na VPS, verificação a cada ${BACKUP_CHECK_INTERVAL_H} h, $drill_info"

# antes de qualquer backup: o dump em claro de uma execução morta (contêiner derrubado no meio) não fica no volume
clean_plaintext

daily() {
  if backup_day; then
    backup.sh || log error "backup falhou"
  else
    log info "sem dump hoje (BACKUP_DAYS=$BACKUP_DAYS, hoje é $(date -u +%w)); o diário vem da réplica do NAS"
  fi
  backup-check.sh || true
  # dia do mês sem zero à esquerda (busybox date não tem %-d)
  if [ "$RESTORE_DRILL_DAY" != off ] && [ "$(date -u +%d | sed 's/^0//')" = "$RESTORE_DRILL_DAY" ]; then
    restore-drill.sh || log error "ensaio de restauração falhou"
  fi
}

if [ "$BACKUP_ON_START" = always ]; then
  backup.sh || log error "backup de partida falhou"
elif [ "$BACKUP_ON_START" = true ]; then
  if find "$BACKUP_DIR/.last_success" -mmin "-$((BACKUP_ON_START_MIN_AGE_H * 60))" 2>/dev/null | grep -q .; then
    log info "backup de partida dispensado: o último bem-sucedido tem menos de $BACKUP_ON_START_MIN_AGE_H h"
  else
    backup.sh || log error "backup de partida falhou"
  fi
fi
# Assets: o sync roda depois de cada dump; sem recibo recente (primeira vez com BACKUP_S3_SYNC_PREFIXES, ou dump de
# partida dispensado), roda já, para o verificador não acusar um recibo que só existiria no próximo dump.
if s3_sync_enabled && ! find "$(s3_sync_receipt)" -mmin "-$((BACKUP_MAX_AGE_H * 60))" 2>/dev/null | grep -q .; then
  s3-sync.sh || log error "sync do S3 de partida falhou"
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
    # o ensaio mensal fica no dia do dump; sem dump hoje (BACKUP_DAYS), a hora do dump vira só uma verificação
    daily
    next_check=$((now + BACKUP_CHECK_INTERVAL_H * 3600))
  elif [ "$now" -ge "$next_check" ]; then
    backup-check.sh || true
    next_check=$((now + BACKUP_CHECK_INTERVAL_H * 3600))
  fi
done
