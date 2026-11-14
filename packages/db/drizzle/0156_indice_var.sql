-- galaxie:concurrently
-- Métrica galaxie_var_unknown_details (coletor var_details, #641): os lances de VAR da semana saem deste índice
-- parcial, que tem só alguns milhares de linhas. Antes, a consulta descia no event_incident_seq_uq de cada jogo, e
-- com o cache frio do deploy passava do statement_timeout. O migrate cria o índice com CREATE INDEX CONCURRENTLY,
-- fora de transação, antes de aplicar este arquivo (packages/db/src/concurrent-indexes.ts).
CREATE INDEX IF NOT EXISTS "event_incident_var_idx" ON "core"."event_incident" USING btree ("event_id") WHERE "core"."event_incident"."type" = 'var';
