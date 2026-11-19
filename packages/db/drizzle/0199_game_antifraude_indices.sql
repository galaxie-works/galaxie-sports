-- galaxie:concurrently
-- Antifraude da Gamificação (#934): a varredura dos sinais lê só os Palpites e os créditos da última hora ou do último dia.
CREATE INDEX IF NOT EXISTS "points_ledger_game_recent_idx" ON "fan"."points_ledger" USING btree ("created_at") WHERE "fan"."points_ledger"."source" = 'gamification' and "fan"."points_ledger"."points_delta" > 0;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prediction_created_idx" ON "game"."prediction" USING btree ("created_at");