-- galaxie:concurrently
CREATE INDEX IF NOT EXISTS "person_transfer_to_date_idx" ON "core"."person_transfer" USING btree ("to_participant_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_transfer_from_date_idx" ON "core"."person_transfer" USING btree ("from_participant_id","date");
