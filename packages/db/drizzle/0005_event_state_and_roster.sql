DROP INDEX "core"."roster_uq";--> statement-breakpoint
ALTER TABLE "core"."event" ADD COLUMN "status_source" text DEFAULT 'provider' NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."event" ADD COLUMN "source_provider" text;--> statement-breakpoint
ALTER TABLE "core"."roster" ADD CONSTRAINT "roster_uq" UNIQUE NULLS NOT DISTINCT("participant_id","person_id","role","season_id");