ALTER TABLE "core"."competition" ADD COLUMN "prestige" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."event" ADD COLUMN "importance_breakdown" jsonb;