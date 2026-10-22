ALTER TYPE "core"."asset_kind" ADD VALUE 'broadcaster_logo' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "enrich"."broadcast_rights" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"competition_slug" text NOT NULL,
	"season" integer NOT NULL,
	"country_code" text NOT NULL,
	"distribution" text NOT NULL,
	"holders" jsonb NOT NULL,
	"status" text NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"notes" text,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"produced_by" text NOT NULL,
	"research_id" uuid,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_by" uuid,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "enrich"."broadcaster" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"kind" text NOT NULL,
	"countries" text[] DEFAULT '{}'::text[] NOT NULL,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"website" text,
	"markets" jsonb NOT NULL,
	"logo_asset_id" uuid,
	"logo_source_url" text,
	"logo_source_page" text,
	"logo_license" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrich"."wtw_research" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"kind" text NOT NULL,
	"research_key" text NOT NULL,
	"competition_slug" text NOT NULL,
	"season" integer,
	"round" text,
	"markets" text[] NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"requested_by" text DEFAULT 'scheduler' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"provider" text,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6),
	"stats" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrich"."broadcaster" ADD CONSTRAINT "broadcaster_logo_asset_id_asset_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_rights_current_idx" ON "enrich"."broadcast_rights" USING btree ("competition_slug","season","country_code") WHERE "enrich"."broadcast_rights"."superseded_by" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "wtw_research_key_uq" ON "enrich"."wtw_research" USING btree ("research_key");--> statement-breakpoint
CREATE INDEX "wtw_research_created_idx" ON "enrich"."wtw_research" USING btree ("created_at");