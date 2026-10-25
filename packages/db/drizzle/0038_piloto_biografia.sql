ALTER TABLE "core"."participant" ADD COLUMN IF NOT EXISTS "full_name" text;--> statement-breakpoint
ALTER TABLE "core"."participant" ADD COLUMN IF NOT EXISTS "death_date" date;--> statement-breakpoint
ALTER TABLE "core"."participant" ADD COLUMN IF NOT EXISTS "bio_facts" jsonb;