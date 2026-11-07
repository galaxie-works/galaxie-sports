-- galaxie:concurrently
-- Frescor por endpoint do raw (métrica galaxie_raw_endpoint_last_fetched_timestamp_seconds e alerta
-- RawEndpointOverdue): a última busca de cada endpoint sai de uma descida no índice. O migrate cria o índice com
-- CREATE INDEX CONCURRENTLY, fora de transação, antes de aplicar este arquivo (packages/db/src/concurrent-indexes.ts).
CREATE INDEX IF NOT EXISTS "api_response_endpoint_seen_idx" ON "raw"."api_response" USING btree ("provider","sport","endpoint",coalesce("last_seen_at", "fetched_at"));
