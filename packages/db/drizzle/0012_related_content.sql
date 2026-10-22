CREATE TYPE "enrich"."related_content_status" AS ENUM('published', 'pending', 'rejected', 'retracted', 'expired');--> statement-breakpoint
CREATE TYPE "enrich"."related_content_type" AS ENUM('highlights', 'goal', 'penalties', 'press_conference', 'interview', 'behind_the_scenes', 'fan_reaction', 'analysis', 'full_match', 'other');--> statement-breakpoint
CREATE TABLE "enrich"."related_content" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"event_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"embed_url" text,
	"title" text NOT NULL,
	"description_excerpt" text,
	"channel_id" text NOT NULL,
	"channel_title" text NOT NULL,
	"channel_handle" text,
	"source_tier" text NOT NULL,
	"content_type" "enrich"."related_content_type" NOT NULL,
	"format" text NOT NULL,
	"aspect_ratio" text NOT NULL,
	"duration_seconds" integer,
	"published_at" timestamp with time zone NOT NULL,
	"thumbnail_url" text,
	"language" text,
	"statistics" jsonb,
	"rank_score" numeric(6, 3) NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"classified_by" text NOT NULL,
	"status" "enrich"."related_content_status" NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"queries" text[] DEFAULT '{}'::text[] NOT NULL,
	"run_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_by" uuid,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "enrich"."related_run" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"event_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"quota_day" date NOT NULL,
	"quota_units" integer DEFAULT 0 NOT NULL,
	"searches" integer DEFAULT 0 NOT NULL,
	"candidates" integer DEFAULT 0 NOT NULL,
	"published" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6),
	"stats" jsonb,
	"error" text,
	"requested_by" text DEFAULT 'cli' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "enrich"."related_content" ADD CONSTRAINT "related_content_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."related_run" ADD CONSTRAINT "related_run_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "related_content_current_uq" ON "enrich"."related_content" USING btree ("event_id","provider","external_id") WHERE "enrich"."related_content"."superseded_by" is null;--> statement-breakpoint
CREATE INDEX "related_content_event_idx" ON "enrich"."related_content" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "related_content_checked_idx" ON "enrich"."related_content" USING btree ("last_checked_at") WHERE "enrich"."related_content"."superseded_by" is null;--> statement-breakpoint
CREATE INDEX "related_run_event_idx" ON "enrich"."related_run" USING btree ("event_id","started_at");--> statement-breakpoint
CREATE INDEX "related_run_quota_idx" ON "enrich"."related_run" USING btree ("quota_day");--> statement-breakpoint
-- Módulo add-on related_content (docs/12 §7): o plano enterprise recebe todos os módulos.
UPDATE "api"."tenant" SET "modules" = array_append("modules", 'related_content') WHERE "plan" = 'enterprise' AND NOT ('related_content' = ANY("modules"));
