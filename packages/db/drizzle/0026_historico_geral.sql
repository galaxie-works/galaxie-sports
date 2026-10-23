CREATE TABLE IF NOT EXISTS "semantic"."head_to_head" (
	"slug" text PRIMARY KEY NOT NULL,
	"sport" text NOT NULL,
	"teams" jsonb NOT NULL,
	"all_time" jsonb NOT NULL,
	"source_file" text NOT NULL,
	"review_status" "semantic"."review_status" DEFAULT 'draft' NOT NULL,
	"content_hash" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "semantic"."derby" ADD COLUMN IF NOT EXISTS "all_time" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "head_to_head_teams_idx" ON "semantic"."head_to_head" USING gin ("teams");