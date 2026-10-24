ALTER TABLE "enrich"."plan_channel" ADD COLUMN "verification" jsonb;--> statement-breakpoint
ALTER TABLE "enrich"."plan_service" ADD COLUMN "verification" jsonb;--> statement-breakpoint
ALTER TABLE "enrich"."platform" ADD COLUMN "official_domains" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "enrich"."platform_plan" ADD COLUMN "price_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "enrich"."platform_plan" ADD COLUMN "price_currency" text;--> statement-breakpoint
ALTER TABLE "enrich"."platform_plan" ADD COLUMN "verification" jsonb;