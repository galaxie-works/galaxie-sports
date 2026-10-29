-- galaxie:concurrently
-- Índices em tabelas grandes da produção. O migrate (packages/db/src/concurrent-indexes.ts) cria cada um com
-- CREATE INDEX CONCURRENTLY, fora de transação, antes de aplicar este arquivo; aqui o IF NOT EXISTS vira no-op.
-- Num banco vazio (CI, ambiente novo) o próprio arquivo cria os índices dentro da transação do migrator.
CREATE INDEX IF NOT EXISTS "api_response_seen_idx" ON "raw"."api_response" USING btree ("sport",coalesce("last_seen_at", "fetched_at"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_response_live_seen_idx" ON "raw"."api_response" USING btree (coalesce("last_seen_at", "fetched_at")) WHERE "raw"."api_response"."retention" = 'live';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_season_idx" ON "core"."event" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_stage_idx" ON "core"."event" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_incident_participant_idx" ON "core"."event_incident" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_incident_assist_person_idx" ON "core"."event_incident" USING btree ("assist_person_id") WHERE "core"."event_incident"."assist_person_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_season_stat_participant_idx" ON "core"."person_season_stat" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "standing_participant_idx" ON "core"."standing" USING btree ("participant_id");