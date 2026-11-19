#!/bin/bash
# Exporta core+multisport do Postgres de dev (NAS) direto para o VPS por túnel reverso, sem Docker local.
set -e
. "$(dirname "$0")/hosts.sh"
PW=$(env_get DATABASE_URL | sed -E 's#^[^:]+://[^:]+:([^@]+)@.*#\1#')
ssh -o ExitOnForwardFailure=yes -R "15433:$NAS_PG" "$VPS" "cd '$VPS_DIR' && docker run --rm --network host -e PGPASSWORD='$PW' postgres:17-alpine pg_dump -h 127.0.0.1 -p 15433 -U galaxie -d galaxie_sports -Fc -Z 6 -n core -n multisport > backups/nas-core.new && mv backups/nas-core.new backups/nas-core.dump && ls -la backups/nas-core.dump"
