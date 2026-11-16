-- galaxie:concurrently
-- O scheduler do ao vivo (`live:scheduler`) e a métrica liveEvents do /metrics leem ops.sync_cursor por (endpoint, key),
-- sem provedor nem esporte, e a chave primária começa pelo provedor. Com 1,9 milhão de cursores (detalhe por jogo,
-- jogador, desfalques e títulos), cada leitura virou um seq scan de 625 MB: a CPU ficou no teto, a hospedagem limitou
-- a VPS a 30% e o ao vivo passou a estourar o statement_timeout (13/11 e 15/11/2026). O migrate cria o índice com
-- CREATE INDEX CONCURRENTLY, fora de transação, antes de aplicar este arquivo (packages/db/src/concurrent-indexes.ts).
CREATE INDEX IF NOT EXISTS "sync_cursor_endpoint_key_idx" ON "ops"."sync_cursor" USING btree ("endpoint","key");
