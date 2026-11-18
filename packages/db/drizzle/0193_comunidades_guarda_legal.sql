ALTER TABLE "community"."comment" ADD COLUMN "legal_hold_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community"."post" ADD COLUMN "legal_hold_until" timestamp with time zone;