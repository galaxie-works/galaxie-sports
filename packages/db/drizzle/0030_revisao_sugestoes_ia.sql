CREATE TABLE "semantic"."review_override" (
	"item_id" text PRIMARY KEY NOT NULL,
	"fields" jsonb NOT NULL,
	"base" jsonb NOT NULL,
	"review_hash" text NOT NULL,
	"source" text NOT NULL,
	"reason" text,
	"suggestion" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "semantic"."review_decision" ADD COLUMN "ai_verdict" jsonb;