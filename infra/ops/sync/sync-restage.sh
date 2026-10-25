#!/bin/bash
# Refaz a rodada a partir do dump do NAS já no VPS (backups/nas-core.dump): monta sync_*, reaponta, backup, aplica.
cd /docker/galaxie-sports; P="docker compose exec -T postgres"; C=$(docker compose ps -q postgres)
for f in sync-upsert sync-apply sync-remap sync-orphans; do docker cp /tmp/$f.sql $C:/tmp/; done
$P psql -U galaxie -d postgres -Atc "drop database if exists galaxie_sync" -c "create database galaxie_sync" >/dev/null
$P pg_dump -U galaxie -d galaxie_sports -s -n public --no-owner | $P psql -U galaxie -d galaxie_sync -q 2>&1 | grep -v "already exists" | grep -i error | head -3
$P pg_restore -U galaxie -d galaxie_sync --no-owner --no-privileges < backups/nas-core.dump 2>&1 | grep -E "^pg_restore: error" | sed -E "s/Command was:.*//" | sort | uniq -c | head -5
$P psql -U galaxie -d galaxie_sync -Atc "alter schema core rename to sync_core" -c "alter schema multisport rename to sync_multisport"
$P psql -U galaxie -d galaxie_sports -Atc "drop schema if exists sync_core cascade" -c "drop schema if exists sync_multisport cascade" >/dev/null 2>&1
$P pg_dump -U galaxie -d galaxie_sync -n sync_core -n sync_multisport --no-owner | $P psql -U galaxie -d galaxie_sports -q 2>&1 | grep -i error | head -3
echo "== cópia: $($P psql -U galaxie -d galaxie_sports -Atc "select count(*) from sync_core.event") jogos no sync_core"
bash /tmp/sync-rest.sh
