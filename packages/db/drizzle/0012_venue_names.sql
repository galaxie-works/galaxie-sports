ALTER TABLE "core"."participant" ADD COLUMN "provider_former_names" jsonb;--> statement-breakpoint
ALTER TABLE "core"."venue" ADD COLUMN "name_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core"."venue" ADD COLUMN "curated" jsonb;--> statement-breakpoint
ALTER TABLE "core"."venue" ADD COLUMN "provider_former_names" jsonb;