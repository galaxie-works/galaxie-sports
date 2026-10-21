CREATE SCHEMA "multisport";
--> statement-breakpoint
CREATE TYPE "multisport"."event_gender" AS ENUM('M', 'W', 'X', 'O');--> statement-breakpoint
CREATE TYPE "multisport"."games_season" AS ENUM('summer', 'winter');--> statement-breakpoint
CREATE TYPE "multisport"."games_status" AS ENUM('completed', 'in_progress', 'upcoming');--> statement-breakpoint
CREATE TYPE "multisport"."games_type" AS ENUM('OG', 'YOG', 'PAN', 'PARAPAN', 'PAN_JR');--> statement-breakpoint
CREATE TYPE "multisport"."medal_type" AS ENUM('G', 'S', 'B');--> statement-breakpoint
CREATE TYPE "multisport"."participant_kind" AS ENUM('athlete', 'team');--> statement-breakpoint
CREATE TYPE "multisport"."result_type" AS ENUM('time', 'points', 'distance', 'score', 'rank');--> statement-breakpoint
CREATE TYPE "multisport"."unit_status" AS ENUM('scheduled', 'live', 'finished', 'delayed', 'cancelled');--> statement-breakpoint
CREATE TABLE "multisport"."discipline" (
	"code" text PRIMARY KEY NOT NULL,
	"sport_code" text NOT NULL,
	"name" jsonb NOT NULL,
	"two_bronzes" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "multisport"."games" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"slug" text NOT NULL,
	"type" "multisport"."games_type" NOT NULL,
	"season" "multisport"."games_season" NOT NULL,
	"year" integer NOT NULL,
	"edition" integer,
	"name" jsonb NOT NULL,
	"host_city" text NOT NULL,
	"host_noc" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"tz" text NOT NULL,
	"status" "multisport"."games_status" NOT NULL,
	"wikidata_qid" text,
	"medal_coverage" numeric(5, 4),
	"medal_data_quality" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "multisport"."games_competition" (
	"games_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"season_id" uuid,
	"sport" text NOT NULL,
	"gender" text NOT NULL,
	"provider" text NOT NULL,
	"provider_league_id" text NOT NULL,
	"matched_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_competition_games_id_competition_id_pk" PRIMARY KEY("games_id","competition_id")
);
--> statement-breakpoint
CREATE TABLE "multisport"."games_provider_league" (
	"games_type" "multisport"."games_type" NOT NULL,
	"games_season" "multisport"."games_season" DEFAULT 'summer' NOT NULL,
	"sport" text NOT NULL,
	"gender" text NOT NULL,
	"provider" text DEFAULT 'api-sports' NOT NULL,
	"provider_league_id" text NOT NULL,
	"label" text NOT NULL,
	"notes" text,
	CONSTRAINT "games_provider_league_provider_sport_provider_league_id_pk" PRIMARY KEY("provider","sport","provider_league_id")
);
--> statement-breakpoint
CREATE TABLE "multisport"."medal" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"event_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"noc_code" text NOT NULL,
	"medal" "multisport"."medal_type" NOT NULL,
	"awarded_at" date,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"confidence" numeric(3, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "multisport"."medal_reference" (
	"games_id" uuid NOT NULL,
	"noc_code" text NOT NULL,
	"source" text NOT NULL,
	"gold" integer NOT NULL,
	"silver" integer NOT NULL,
	"bronze" integer NOT NULL,
	"url" text,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medal_reference_games_id_noc_code_source_pk" PRIMARY KEY("games_id","noc_code","source")
);
--> statement-breakpoint
CREATE TABLE "multisport"."medal_table_snapshot" (
	"games_id" uuid NOT NULL,
	"noc_code" text NOT NULL,
	"gold" integer NOT NULL,
	"silver" integer NOT NULL,
	"bronze" integer NOT NULL,
	"total" integer NOT NULL,
	"rank_by_gold" integer NOT NULL,
	"rank_by_total" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medal_table_snapshot_games_id_noc_code_pk" PRIMARY KEY("games_id","noc_code")
);
--> statement-breakpoint
CREATE TABLE "multisport"."event" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"games_id" uuid NOT NULL,
	"discipline_code" text,
	"gender" "multisport"."event_gender" DEFAULT 'O' NOT NULL,
	"name" jsonb NOT NULL,
	"odf_code" text,
	"is_team" boolean DEFAULT false NOT NULL,
	"medal_slots" jsonb,
	"event_date" date,
	"wikidata_qid" text,
	"source_sport" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "multisport"."participant" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"kind" "multisport"."participant_kind" NOT NULL,
	"noc_code" text NOT NULL,
	"person_id" uuid,
	"team_name" text,
	"external_key" text NOT NULL,
	"wikidata_qid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "multisport"."person" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"full_name" text NOT NULL,
	"given_name" text,
	"family_name" text,
	"birth_date" date,
	"gender" text,
	"wikidata_qid" text,
	"olympedia_id" text,
	"world_athletics_id" text,
	"fiba_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "multisport"."sport" (
	"code" text PRIMARY KEY NOT NULL,
	"name" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "multisport"."noc" (
	"code" text PRIMARY KEY NOT NULL,
	"iso3" text,
	"iso2" text,
	"name" jsonb NOT NULL,
	"kind" text DEFAULT 'noc' NOT NULL,
	"ioc_member" boolean DEFAULT false NOT NULL,
	"panam_member" boolean DEFAULT false NOT NULL,
	"successor_code" text,
	"flag_url" text,
	"wikidata_qid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "multisport"."phase" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"event_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "multisport"."result" (
	"unit_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"rank" integer,
	"result_value" text,
	"result_type" "multisport"."result_type",
	"irm" text,
	"qualified_mark" text,
	"records" text[],
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_unit_id_participant_id_pk" PRIMARY KEY("unit_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "multisport"."source_ref" (
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"url" text,
	"license" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_ref_entity_type_entity_id_source_source_id_pk" PRIMARY KEY("entity_type","entity_id","source","source_id")
);
--> statement-breakpoint
CREATE TABLE "multisport"."team_member" (
	"team_participant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "team_member_team_participant_id_person_id_pk" PRIMARY KEY("team_participant_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "multisport"."unit" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"phase_id" uuid NOT NULL,
	"odf_rsc" text,
	"name" jsonb,
	"start_utc" timestamp with time zone,
	"end_utc" timestamp with time zone,
	"venue" text,
	"status" "multisport"."unit_status" DEFAULT 'scheduled' NOT NULL,
	"is_medal_unit" boolean DEFAULT false NOT NULL,
	"core_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "multisport"."discipline" ADD CONSTRAINT "discipline_sport_code_sport_code_fk" FOREIGN KEY ("sport_code") REFERENCES "multisport"."sport"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."games" ADD CONSTRAINT "games_host_noc_noc_code_fk" FOREIGN KEY ("host_noc") REFERENCES "multisport"."noc"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."games_competition" ADD CONSTRAINT "games_competition_games_id_games_id_fk" FOREIGN KEY ("games_id") REFERENCES "multisport"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."games_competition" ADD CONSTRAINT "games_competition_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "core"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."games_competition" ADD CONSTRAINT "games_competition_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "core"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."medal" ADD CONSTRAINT "medal_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "multisport"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."medal" ADD CONSTRAINT "medal_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "multisport"."participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."medal" ADD CONSTRAINT "medal_noc_code_noc_code_fk" FOREIGN KEY ("noc_code") REFERENCES "multisport"."noc"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."medal_reference" ADD CONSTRAINT "medal_reference_games_id_games_id_fk" FOREIGN KEY ("games_id") REFERENCES "multisport"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."medal_reference" ADD CONSTRAINT "medal_reference_noc_code_noc_code_fk" FOREIGN KEY ("noc_code") REFERENCES "multisport"."noc"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."medal_table_snapshot" ADD CONSTRAINT "medal_table_snapshot_games_id_games_id_fk" FOREIGN KEY ("games_id") REFERENCES "multisport"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."medal_table_snapshot" ADD CONSTRAINT "medal_table_snapshot_noc_code_noc_code_fk" FOREIGN KEY ("noc_code") REFERENCES "multisport"."noc"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."event" ADD CONSTRAINT "event_games_id_games_id_fk" FOREIGN KEY ("games_id") REFERENCES "multisport"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."event" ADD CONSTRAINT "event_discipline_code_discipline_code_fk" FOREIGN KEY ("discipline_code") REFERENCES "multisport"."discipline"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."participant" ADD CONSTRAINT "participant_noc_code_noc_code_fk" FOREIGN KEY ("noc_code") REFERENCES "multisport"."noc"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."participant" ADD CONSTRAINT "participant_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "multisport"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."phase" ADD CONSTRAINT "phase_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "multisport"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."result" ADD CONSTRAINT "result_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "multisport"."unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."result" ADD CONSTRAINT "result_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "multisport"."participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."team_member" ADD CONSTRAINT "team_member_team_participant_id_participant_id_fk" FOREIGN KEY ("team_participant_id") REFERENCES "multisport"."participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."team_member" ADD CONSTRAINT "team_member_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "multisport"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."unit" ADD CONSTRAINT "unit_phase_id_phase_id_fk" FOREIGN KEY ("phase_id") REFERENCES "multisport"."phase"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "multisport"."unit" ADD CONSTRAINT "unit_core_event_id_event_id_fk" FOREIGN KEY ("core_event_id") REFERENCES "core"."event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discipline_sport_idx" ON "multisport"."discipline" USING btree ("sport_code");--> statement-breakpoint
CREATE UNIQUE INDEX "games_slug_uq" ON "multisport"."games" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "games_type_season_year_uq" ON "multisport"."games" USING btree ("type","season","year");--> statement-breakpoint
CREATE UNIQUE INDEX "games_wikidata_uq" ON "multisport"."games" USING btree ("wikidata_qid");--> statement-breakpoint
CREATE INDEX "games_competition_competition_idx" ON "multisport"."games_competition" USING btree ("competition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "medal_source_key_uq" ON "multisport"."medal" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "medal_event_idx" ON "multisport"."medal" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "medal_noc_idx" ON "multisport"."medal" USING btree ("noc_code");--> statement-breakpoint
CREATE UNIQUE INDEX "ms_event_wikidata_uq" ON "multisport"."event" USING btree ("wikidata_qid");--> statement-breakpoint
CREATE UNIQUE INDEX "ms_event_odf_uq" ON "multisport"."event" USING btree ("games_id","odf_code");--> statement-breakpoint
CREATE INDEX "ms_event_games_idx" ON "multisport"."event" USING btree ("games_id","discipline_code");--> statement-breakpoint
CREATE UNIQUE INDEX "ms_participant_key_uq" ON "multisport"."participant" USING btree ("external_key");--> statement-breakpoint
CREATE INDEX "ms_participant_noc_idx" ON "multisport"."participant" USING btree ("noc_code");--> statement-breakpoint
CREATE INDEX "ms_participant_person_idx" ON "multisport"."participant" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ms_person_wikidata_uq" ON "multisport"."person" USING btree ("wikidata_qid");--> statement-breakpoint
CREATE INDEX "ms_person_name_idx" ON "multisport"."person" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "noc_iso2_idx" ON "multisport"."noc" USING btree ("iso2");--> statement-breakpoint
CREATE INDEX "noc_iso3_idx" ON "multisport"."noc" USING btree ("iso3");--> statement-breakpoint
CREATE UNIQUE INDEX "phase_event_code_uq" ON "multisport"."phase" USING btree ("event_id","code");--> statement-breakpoint
CREATE INDEX "source_ref_source_idx" ON "multisport"."source_ref" USING btree ("source","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_odf_rsc_uq" ON "multisport"."unit" USING btree ("odf_rsc");--> statement-breakpoint
CREATE INDEX "unit_start_idx" ON "multisport"."unit" USING btree ("start_utc");--> statement-breakpoint
CREATE VIEW "multisport"."medal_table" AS (with counts as (
      select e.games_id, m.noc_code,
        count(*) filter (where m.medal = 'G')::int as gold,
        count(*) filter (where m.medal = 'S')::int as silver,
        count(*) filter (where m.medal = 'B')::int as bronze,
        count(*)::int as total
      from multisport.medal m
      join multisport.event e on e.id = m.event_id
      where m.revoked_at is null
      group by e.games_id, m.noc_code
    )
    select games_id, noc_code, gold, silver, bronze, total,
      (rank() over (partition by games_id order by gold desc, silver desc, bronze desc))::int as rank_by_gold,
      (rank() over (partition by games_id order by total desc, gold desc, silver desc, bronze desc))::int as rank_by_total
    from counts);