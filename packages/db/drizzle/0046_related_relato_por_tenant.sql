CREATE TABLE "enrich"."related_playback_report" (
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" integer NOT NULL,
	"channel_id" text,
	"format" text,
	"reports" integer DEFAULT 1 NOT NULL,
	"quorum" boolean DEFAULT true NOT NULL,
	"first_reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "related_playback_report_provider_external_id_tenant_id_pk" PRIMARY KEY("provider","external_id","tenant_id")
);
--> statement-breakpoint
CREATE INDEX "related_playback_report_tenant_channel_idx" ON "enrich"."related_playback_report" USING btree ("tenant_id","provider","channel_id");