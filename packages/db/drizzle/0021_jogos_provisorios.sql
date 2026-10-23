-- Jogos provisórios (config/fixtures/provisional.yaml): anunciados oficialmente e ainda não publicados pelo
-- fornecedor. A normalização assume o evento quando o jogo oficial chega (mesmo `event.id`). Idempotente: o
-- banco de dev é compartilhado entre worktrees.
ALTER TABLE "core"."event" ADD COLUMN IF NOT EXISTS "is_provisional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."event" ADD COLUMN IF NOT EXISTS "provisional" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_provisional_key_uq" ON "core"."event" USING btree (("provisional"->>'key'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_provisional_idx" ON "core"."event" USING btree ("competition_id","season_id") WHERE "core"."event"."is_provisional";
