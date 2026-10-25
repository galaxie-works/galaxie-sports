#!/bin/bash
# Rodada NAS → produção: exporta core/multisport do NAS, monta sync_* na produção, reaponta ids, aplica (com backup antes),
# limpa órfãos, copia objetos do S3 e limpa o cache. Mesmas regras do sync-upsert.sql (curadoria e resultados da produção prevalecem).
set -e
S="$(dirname "$0")"; VPS=root@145.223.94.149; SSHO="-o ServerAliveInterval=30"
scp -q "$S/sync-upsert.sql" "$S/sync-apply.sql" "$S/sync-remap.sql" "$S/sync-orphans.sql" $VPS:/tmp/
echo "== exporta do NAS"; bash "$S/nas-export.sh"
ssh $SSHO $VPS 'cd /docker/galaxie-sports && P="docker compose exec -T postgres"; C=$(docker compose ps -q postgres)
for f in sync-upsert sync-apply sync-remap sync-orphans; do docker cp /tmp/$f.sql $C:/tmp/; done
$P psql -U galaxie -d postgres -Atc "drop database if exists galaxie_sync" -c "create database galaxie_sync" >/dev/null
$P pg_dump -U galaxie -d galaxie_sports -s -n public --no-owner | $P psql -U galaxie -d galaxie_sync -q 2>&1 | grep -v "already exists" | grep -i error | head -3
$P pg_restore -U galaxie -d galaxie_sync --no-owner --no-privileges < backups/nas-core.dump 2>&1 | grep -E "^pg_restore: error" | sed -E "s/Command was:.*//" | sort | uniq -c | head -5
$P psql -U galaxie -d galaxie_sync -Atc "alter schema core rename to sync_core" -c "alter schema multisport rename to sync_multisport"
$P psql -U galaxie -d galaxie_sports -Atc "drop schema if exists sync_core cascade" -c "drop schema if exists sync_multisport cascade" >/dev/null 2>&1
$P pg_dump -U galaxie -d galaxie_sync -n sync_core -n sync_multisport --no-owner | $P psql -U galaxie -d galaxie_sports -q 2>&1 | grep -i error | head -3
echo "== reaponta ids"; $P psql -U galaxie -d galaxie_sports -At -f /tmp/sync-remap.sql 2>&1 | grep -vE "^(DO|CREATE|ALTER)|already exists"
T=$(date -u +%Y%m%dT%H%M); $P pg_dump -U galaxie -d galaxie_sports -Fc -n core -n multisport > backups/pre-sync-$T.dump; echo "== backup pre-sync-$T.dump"
echo "== aplica"; $P psql -U galaxie -d galaxie_sports -At -f /tmp/sync-apply.sql 2>&1 | grep -vE "^(CREATE FUNCTION|BEGIN|SET|COMMIT)$" | grep -vE "inseridos=0 · " 
echo "== órfãos"; $P psql -U galaxie -d galaxie_sports -At -f /tmp/sync-orphans.sql 2>&1 | grep -v "^CREATE FUNCTION"
$P psql -U galaxie -d galaxie_sports -Atc "delete from core.event_participant c where not exists (select 1 from core.event e where e.id=c.event_id)" -c "delete from core.event_state_log c where not exists (select 1 from core.event e where e.id=c.event_id)"
$P psql -U galaxie -d galaxie_sports -Atc "drop schema sync_core cascade" -c "drop schema sync_multisport cascade" >/dev/null 2>&1; $P psql -U galaxie -d postgres -Atc "drop database galaxie_sync" >/dev/null
echo "== jogos por esporte"; $P psql -U galaxie -d galaxie_sports -Atc "select sport, count(*) from core.event group by 1 order by 2 desc" | tr "\n" " "; echo'
echo "== S3"; bash "$S/s3copy.sh" 2>&1 | grep -v "command not found" | tail -2
ssh $SSHO $VPS 'cd /docker/galaxie-sports && for p in "gs:cache:*" "gs:tag:*"; do docker compose exec -T valkey sh -c "valkey-cli --scan --pattern \"$p\" | xargs -r -n 500 valkey-cli del" >/dev/null; done; docker compose restart demo >/dev/null 2>&1; echo "== cache limpo, demo reiniciada"'
