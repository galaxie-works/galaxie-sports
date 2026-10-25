#!/bin/bash
# Prévia NAS → produção (sem aplicar): exporta do NAS, monta sync_* na produção, reaponta ids e roda o sync-dry
# (contagens por tabela: novas, atualizadas, onde a produção ganha). Limpa os esquemas temporários no fim.
set -e
S="$(dirname "$0")"; VPS=root@145.223.94.149; SSHO="-o ServerAliveInterval=30"
scp -q "$S/sync-upsert.sql" "$S/sync-dry.sql" "$S/sync-remap.sql" $VPS:/tmp/
echo "== exporta do NAS"; bash "$S/nas-export.sh"
ssh $SSHO $VPS 'cd /docker/galaxie-sports && P="docker compose exec -T postgres"; C=$(docker compose ps -q postgres)
for f in sync-upsert sync-dry sync-remap; do docker cp /tmp/$f.sql $C:/tmp/; done
$P psql -U galaxie -d postgres -Atc "drop database if exists galaxie_sync" -c "create database galaxie_sync" >/dev/null
$P pg_dump -U galaxie -d galaxie_sports -s -n public --no-owner | $P psql -U galaxie -d galaxie_sync -q 2>&1 | grep -v "already exists" | grep -i error | head -3
$P pg_restore -U galaxie -d galaxie_sync --no-owner --no-privileges < backups/nas-core.dump 2>&1 | grep -E "^pg_restore: error" | sed -E "s/Command was:.*//" | sort | uniq -c | head -5
$P psql -U galaxie -d galaxie_sync -Atc "alter schema core rename to sync_core" -c "alter schema multisport rename to sync_multisport"
$P psql -U galaxie -d galaxie_sports -Atc "drop schema if exists sync_core cascade" -c "drop schema if exists sync_multisport cascade" >/dev/null 2>&1
$P pg_dump -U galaxie -d galaxie_sync -n sync_core -n sync_multisport --no-owner | $P psql -U galaxie -d galaxie_sports -q 2>&1 | grep -i error | head -3
echo "== reaponta ids"; $P psql -U galaxie -d galaxie_sports -At -f /tmp/sync-remap.sql 2>&1 | grep -vE "^(DO|CREATE|ALTER)|already exists"
echo "== prévia"; $P psql -U galaxie -d galaxie_sports -At -f /tmp/sync-dry.sql 2>&1 | grep -vE "^(CREATE FUNCTION|BEGIN|SET|COMMIT)$" | grep -vE "inseridos=0 · atualizados=0"
$P psql -U galaxie -d galaxie_sports -Atc "drop schema sync_core cascade" -c "drop schema sync_multisport cascade" >/dev/null 2>&1; $P psql -U galaxie -d postgres -Atc "drop database galaxie_sync" >/dev/null
echo "== fim da prévia (nada aplicado)"'
