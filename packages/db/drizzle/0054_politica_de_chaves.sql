ALTER TABLE "api"."api_key" ADD COLUMN "key_format" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."publishable_key" ADD COLUMN "env" text DEFAULT 'live' NOT NULL;