# Serviço de backup do Postgres: pg_dump diário com retenção, verificador, ensaio de restauração mensal, cópia
# opcional para S3 e restore scriptado.
# A versão do cliente acompanha o servidor (postgres:17) — pg_dump/pg_restore precisam ser >= o servidor.
#   docker build -t galaxie-sports-backup infra/backup
ARG POSTGRES_IMAGE=postgres:17-alpine
FROM ${POSTGRES_IMAGE}
# age: cifragem dos dumps com chave pública (BACKUP_AGE_RECIPIENTS)
RUN apk add --no-cache aws-cli tini age
COPY lib.sh /usr/local/lib/galaxie-backup/lib.sh
COPY --chmod=0755 backup.sh /usr/local/bin/backup.sh
COPY --chmod=0755 restore.sh /usr/local/bin/restore.sh
COPY --chmod=0755 backup-check.sh /usr/local/bin/backup-check.sh
COPY --chmod=0755 restore-drill.sh /usr/local/bin/restore-drill.sh
COPY --chmod=0755 entrypoint.sh /usr/local/bin/backup-scheduler.sh
ENV BACKUP_DIR=/backups BACKUP_KEEP_DAILY=7 BACKUP_TIME=03:30 BACKUP_ON_START=true
RUN mkdir -p /backups && chown postgres:postgres /backups
VOLUME ["/backups"]
USER postgres
# Saudável enquanto o último backup bem-sucedido tiver menos de 26 h.
HEALTHCHECK --interval=5m --timeout=10s --start-period=30m --retries=1 \
  CMD find "$BACKUP_DIR/.last_success" -mmin -1560 2>/dev/null | grep -q . || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["backup-scheduler.sh"]
