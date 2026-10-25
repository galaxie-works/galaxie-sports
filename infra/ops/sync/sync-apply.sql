\set ON_ERROR_STOP on
\i /tmp/sync-upsert.sql
BEGIN;
SET LOCAL session_replication_role = replica;
SELECT pg_temp.sync_table('sync_'||t.table_schema, t.table_schema, t.table_name, false)
  FROM information_schema.tables t
 WHERE t.table_schema IN ('core','multisport') AND t.table_type='BASE TABLE'
   AND EXISTS (SELECT 1 FROM information_schema.tables s WHERE s.table_schema='sync_'||t.table_schema AND s.table_name=t.table_name)
   AND NOT (t.table_schema = 'core' AND t.table_name = 'standing')  -- a produção recalcula a classificação
 ORDER BY t.table_schema, t.table_name;
COMMIT;
