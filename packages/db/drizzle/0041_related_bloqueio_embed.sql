CREATE TABLE "enrich"."related_channel_rule" (
	"provider" text NOT NULL,
	"channel_id" text NOT NULL,
	"mode" text NOT NULL,
	"channel_title" text,
	"note" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "related_channel_rule_provider_channel_id_pk" PRIMARY KEY("provider","channel_id")
);
--> statement-breakpoint
CREATE TABLE "enrich"."related_playback_block" (
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"code" integer NOT NULL,
	"channel_id" text,
	"format" text,
	"content_type" "enrich"."related_content_type",
	"reports" integer DEFAULT 1 NOT NULL,
	"tenant_id" uuid,
	"first_reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "related_playback_block_provider_external_id_pk" PRIMARY KEY("provider","external_id")
);
--> statement-breakpoint
ALTER TABLE "enrich"."related_content" ADD COLUMN "region_allowed" text[];--> statement-breakpoint
ALTER TABLE "enrich"."related_content" ADD COLUMN "region_blocked" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "related_playback_block_channel_idx" ON "enrich"."related_playback_block" USING btree ("channel_id","format");