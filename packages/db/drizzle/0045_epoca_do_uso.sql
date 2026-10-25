ALTER TABLE "api"."usage_daily" ADD COLUMN "epoch" text;--> statement-breakpoint
ALTER TABLE "api"."usage_daily" ADD COLUMN "epoch_requests" bigint DEFAULT 0 NOT NULL;