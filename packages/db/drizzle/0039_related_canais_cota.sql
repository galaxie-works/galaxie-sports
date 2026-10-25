-- Conteúdo relacionado: mapa de canais oficiais, cache do channels.list, orçamento por dia de cota e os dois
-- baldes da cota do YouTube (docs/12 §3.2 e §8). Idempotente. Numerada 0039: a 0038 está num PR aberto.
CREATE TABLE IF NOT EXISTS "enrich"."related_budget" (
	"quota_day" date PRIMARY KEY NOT NULL,
	"search_limit" integer NOT NULL,
	"search_used" integer DEFAULT 0 NOT NULL,
	"search_reserved" integer DEFAULT 0 NOT NULL,
	"api_limit" integer NOT NULL,
	"api_used" integer DEFAULT 0 NOT NULL,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"upcoming" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrich"."related_channel" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"channel_id" text NOT NULL,
	"kind" text NOT NULL,
	"participant_id" uuid,
	"competition_id" uuid,
	"broadcaster_id" text,
	"country" text,
	"source" text NOT NULL,
	"source_ref" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "related_channel_uq" UNIQUE NULLS NOT DISTINCT("channel_id","kind","participant_id","competition_id","broadcaster_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrich"."youtube_channel" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"handle" text,
	"uploads_playlist_id" text,
	"country" text,
	"subscribers" integer,
	"missing" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrich"."related_run" ADD COLUMN IF NOT EXISTS "api_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- histórico: até aqui quota_units somava 100 por busca; o balde geral é o que sobra
UPDATE "enrich"."related_run" SET "api_units" = greatest(0, "quota_units" - 100 * "searches") WHERE "api_units" = 0 AND "quota_units" > 0;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "enrich"."related_channel" ADD CONSTRAINT "related_channel_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "core"."participant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "enrich"."related_channel" ADD CONSTRAINT "related_channel_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "core"."competition"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "related_channel_participant_idx" ON "enrich"."related_channel" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "related_channel_competition_idx" ON "enrich"."related_channel" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "youtube_channel_handle_idx" ON "enrich"."youtube_channel" USING btree ("handle");
