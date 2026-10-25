CREATE TABLE "enrich"."match_channel" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"event_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	"broadcaster_id" text NOT NULL,
	"channel_name" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"source_kind" text NOT NULL,
	"source_url" text NOT NULL,
	"source_publisher" text NOT NULL,
	"source_excerpt" text NOT NULL,
	"source_published_at" timestamp with time zone,
	"evidence" jsonb NOT NULL,
	"phase" text NOT NULL,
	"window" text NOT NULL,
	"research_id" uuid,
	"first_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"post_confirmed_at" timestamp with time zone,
	"retracted_at" timestamp with time zone,
	"retracted_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrich"."match_channel" ADD CONSTRAINT "match_channel_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_channel_event_country_broadcaster_uq" ON "enrich"."match_channel" USING btree ("event_id","country_code","broadcaster_id");--> statement-breakpoint
CREATE INDEX "match_channel_event_country_idx" ON "enrich"."match_channel" USING btree ("event_id","country_code","status");