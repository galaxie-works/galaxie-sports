-- Perfis completos de jogadores: local de nascimento, estatísticas por temporada, transferências,
-- títulos e afastamentos (players, transfers, trophies, sidelined). Idempotente: o banco de dev é
-- compartilhado entre worktrees.
CREATE TABLE IF NOT EXISTS "core"."person_season_stat" (
	"person_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"position" text,
	"number" integer,
	"captain" boolean,
	"appearances" integer,
	"lineups" integer,
	"minutes" integer,
	"rating" numeric(4, 2),
	"goals" integer,
	"assists" integer,
	"conceded" integer,
	"saves" integer,
	"yellow_cards" integer,
	"red_cards" integer,
	"stats" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_season_stat_person_id_participant_id_season_id_pk" PRIMARY KEY("person_id","participant_id","season_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."person_sidelined" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"person_id" uuid NOT NULL,
	"type" text NOT NULL,
	"start_date" date,
	"end_date" date,
	CONSTRAINT "person_sidelined_uq" UNIQUE NULLS NOT DISTINCT("person_id","type","start_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."person_transfer" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date,
	"type" text,
	"from_participant_id" uuid,
	"to_participant_id" uuid,
	"from_name" text,
	"to_name" text,
	CONSTRAINT "person_transfer_uq" UNIQUE NULLS NOT DISTINCT("person_id","date","from_participant_id","to_participant_id","type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."person_trophy" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"person_id" uuid NOT NULL,
	"league" text NOT NULL,
	"country" text,
	"season" text,
	"place" text,
	CONSTRAINT "person_trophy_uq" UNIQUE NULLS NOT DISTINCT("person_id","league","country","season","place")
);
--> statement-breakpoint
ALTER TABLE "core"."person" ADD COLUMN IF NOT EXISTS "birth_place" text;--> statement-breakpoint
ALTER TABLE "core"."person" ADD COLUMN IF NOT EXISTS "birth_country" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "core"."person_season_stat" ADD CONSTRAINT "person_season_stat_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "core"."person_season_stat" ADD CONSTRAINT "person_season_stat_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "core"."participant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "core"."person_season_stat" ADD CONSTRAINT "person_season_stat_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "core"."season"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "core"."person_sidelined" ADD CONSTRAINT "person_sidelined_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "core"."person_transfer" ADD CONSTRAINT "person_transfer_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "core"."person_transfer" ADD CONSTRAINT "person_transfer_from_participant_id_participant_id_fk" FOREIGN KEY ("from_participant_id") REFERENCES "core"."participant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "core"."person_transfer" ADD CONSTRAINT "person_transfer_to_participant_id_participant_id_fk" FOREIGN KEY ("to_participant_id") REFERENCES "core"."participant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "core"."person_trophy" ADD CONSTRAINT "person_trophy_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."person"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_season_stat_season_idx" ON "core"."person_season_stat" USING btree ("season_id");