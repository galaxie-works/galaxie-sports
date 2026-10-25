#!/bin/bash
# Resto da rodada, rodando no VPS (nohup): espera a cópia dos schemas sync_* terminar e segue.
cd /docker/galaxie-sports; P="docker compose exec -T postgres"
:
echo "== cópia: $($P psql -U galaxie -d galaxie_sports -Atc "select count(*) from sync_core.event") jogos no sync_core"
echo "== reaponta ids"; $P psql -U galaxie -d galaxie_sports -At -f /tmp/sync-remap.sql 2>&1 | grep -vE "^(DO|CREATE|ALTER)|already exists"
T=$(date -u +%Y%m%dT%H%M); $P pg_dump -U galaxie -d galaxie_sports -Fc -n core -n multisport > backups/pre-sync-$T.dump; echo "== backup pre-sync-$T.dump"
echo "== aplica"; $P psql -U galaxie -d galaxie_sports -At -f /tmp/sync-apply.sql 2>&1 | grep -vE "^(CREATE FUNCTION|BEGIN|SET|COMMIT)$" | grep -vE "atualizados=0 · inseridos=0 · "
echo "== órfãos"; $P psql -U galaxie -d galaxie_sports -At -f /tmp/sync-orphans.sql 2>&1 | grep -v "^CREATE FUNCTION"
$P psql -U galaxie -d galaxie_sports -Atc "delete from core.event_participant c where not exists (select 1 from core.event e where e.id=c.event_id)" -c "delete from core.event_state_log c where not exists (select 1 from core.event e where e.id=c.event_id)"
$P psql -U galaxie -d galaxie_sports -Atc "drop schema sync_core cascade" -c "drop schema sync_multisport cascade" >/dev/null 2>&1; $P psql -U galaxie -d postgres -Atc "drop database galaxie_sync" >/dev/null
echo "== jogos por esporte: $($P psql -U galaxie -d galaxie_sports -Atc "select sport, count(*) from core.event group by 1 order by 2 desc" | tr "\n" " ")"
echo FIM_DB
