ALTER TABLE "enrich"."platform" ADD COLUMN "plan_pages" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "enrich"."platform" ADD COLUMN "plan_pages_hash" text;--> statement-breakpoint
ALTER TABLE "enrich"."platform" ADD COLUMN "plan_pages_extracted_at" timestamp with time zone;