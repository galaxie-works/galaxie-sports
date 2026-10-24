CREATE TABLE "enrich"."lineup_page" (
	"url" text PRIMARY KEY NOT NULL,
	"platform_id" uuid,
	"status" text NOT NULL,
	"via" text,
	"http_status" integer,
	"final_url" text,
	"content_hash" text,
	"previous_hash" text,
	"hash_changed_at" timestamp with time zone,
	"content" jsonb,
	"error" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrich"."platform_addon" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"platform_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"channel" text,
	"name" text NOT NULL,
	"price_amount" numeric(12, 2),
	"price_currency" text,
	"price_text" text,
	"commitment_months" integer,
	"url" text,
	"verification" jsonb,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_change" jsonb,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrich"."lineup_page" ADD CONSTRAINT "lineup_page_platform_id_platform_id_fk" FOREIGN KEY ("platform_id") REFERENCES "enrich"."platform"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."platform_addon" ADD CONSTRAINT "platform_addon_platform_id_platform_id_fk" FOREIGN KEY ("platform_id") REFERENCES "enrich"."platform"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."platform_addon" ADD CONSTRAINT "platform_addon_ref_id_broadcaster_id_fk" FOREIGN KEY ("ref_id") REFERENCES "enrich"."broadcaster"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lineup_page_platform_idx" ON "enrich"."lineup_page" USING btree ("platform_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_addon_slug_uq" ON "enrich"."platform_addon" USING btree ("platform_id","slug");--> statement-breakpoint
CREATE INDEX "platform_addon_ref_idx" ON "enrich"."platform_addon" USING btree ("ref_id");