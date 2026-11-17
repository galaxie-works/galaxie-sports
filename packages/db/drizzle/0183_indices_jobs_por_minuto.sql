-- galaxie:concurrently
-- Jobs do scheduler que rodam a cada minuto liam core.event (1,7 milhão de jogos) sem um índice que servisse: o
-- explore-summary contava jogo novo por created_at (sem índice) e o events-clock pegava os 48 mil `scheduled` pelo
-- índice de status para filtrar por starts_at depois (17/11/2026, CPU da VPS limitada pela hospedagem). O migrate cria
-- os índices com CREATE INDEX CONCURRENTLY, fora de transação, antes de aplicar este arquivo
-- (packages/db/src/concurrent-indexes.ts); aqui o IF NOT EXISTS vira no-op.
CREATE INDEX IF NOT EXISTS "event_created_at_idx" ON "core"."event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_open_starts_idx" ON "core"."event" USING btree ("starts_at") WHERE "core"."event"."status" in ('scheduled', 'starting', 'live', 'break', 'suspended');
