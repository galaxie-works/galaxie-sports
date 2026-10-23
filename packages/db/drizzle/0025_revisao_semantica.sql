CREATE TABLE "semantic"."review_decision" (
	"item_id" text PRIMARY KEY NOT NULL,
	"status" "semantic"."review_status" NOT NULL,
	"review_hash" text NOT NULL,
	"suggestion" jsonb,
	"decided_by" text NOT NULL,
	"decided_by_id" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "semantic"."review_item" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"locale" text,
	"sport" text NOT NULL,
	"market" text,
	"title" text NOT NULL,
	"source_file" text NOT NULL,
	"yaml_status" "semantic"."review_status" NOT NULL,
	"review_hash" text NOT NULL,
	"content" jsonb NOT NULL,
	"original" jsonb,
	"original_locale" text,
	"parent_kind" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "semantic"."review_log" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"item_id" text NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" "semantic"."review_status" NOT NULL,
	"review_hash" text NOT NULL,
	"comment" text,
	"proposed" jsonb,
	"actor" text NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "review_item_filter_idx" ON "semantic"."review_item" USING btree ("kind","sport","market");--> statement-breakpoint
CREATE INDEX "review_log_item_idx" ON "semantic"."review_log" USING btree ("item_id","created_at");