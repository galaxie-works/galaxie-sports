#!/bin/bash
# Exporta core+multisport do Postgres de dev (NAS) direto para o VPS por túnel reverso, sem Docker local.
set -e
PW=$(grep -E "^DATABASE_URL=" "${GALAXIE_ENV:-/g/galaxie-sports/.env}" | sed -E 's#^[^:]+://[^:]+:([^@]+)@.*#\1#')
ssh -o ExitOnForwardFailure=yes -R 15433:192.168.1.34:5433 root@145.223.94.149 "cd /docker/galaxie-sports && docker run --rm --network host -e PGPASSWORD='$PW' postgres:17-alpine pg_dump -h 127.0.0.1 -p 15433 -U galaxie -d galaxie_sports -Fc -Z 6 -n core -n multisport > backups/nas-core.new && mv backups/nas-core.new backups/nas-core.dump && ls -la backups/nas-core.dump"
