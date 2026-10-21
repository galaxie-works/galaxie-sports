CREATE SCHEMA "raw";
--> statement-breakpoint
CREATE SCHEMA "core";
--> statement-breakpoint
CREATE SCHEMA "semantic";
--> statement-breakpoint
CREATE SCHEMA "enrich";
--> statement-breakpoint
CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE TYPE "core"."asset_kind" AS ENUM('flag', 'league_logo', 'team_logo', 'venue', 'player', 'coach', 'driver', 'circuit', 'fighter', 'other');--> statement-breakpoint
CREATE TYPE "core"."competition_type" AS ENUM('league', 'cup', 'tournament', 'multisport');--> statement-breakpoint
CREATE TYPE "core"."event_status" AS ENUM('scheduled', 'starting', 'live', 'break', 'finished', 'postponed', 'cancelled', 'suspended', 'abandoned');--> statement-breakpoint
CREATE TYPE "core"."participant_kind" AS ENUM('club', 'national_team', 'athlete', 'driver', 'constructor', 'fighter');--> statement-breakpoint
CREATE TYPE "semantic"."review_status" AS ENUM('draft', 'reviewed', 'approved');--> statement-breakpoint
CREATE TYPE "enrich"."access_model" AS ENUM('free', 'subscription', 'ppv', 'unknown');--> statement-breakpoint
CREATE TYPE "enrich"."broadcast_medium" AS ENUM('free_tv', 'pay_tv', 'streaming_svod', 'streaming_free', 'youtube', 'official_app', 'radio');--> statement-breakpoint
CREATE TYPE "enrich"."broadcast_status" AS ENUM('confirmed', 'probable', 'pending', 'omitted', 'retracted');--> statement-breakpoint
CREATE TYPE "ops"."quota_priority" AS ENUM('BOOTSTRAP', 'DAILY', 'LIVE', 'ADHOC');--> statement-breakpoint
CREATE TABLE "raw"."api_response" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'api-sports' NOT NULL,
	"sport" text NOT NULL,
	"api_version" text NOT NULL,
	"endpoint" text NOT NULL,
	"params" jsonb NOT NULL,
	"request_hash" text NOT NULL,
	"page" integer DEFAULT 1 NOT NULL,
	"status_code" integer NOT NULL,
	"results" integer,
	"errors" jsonb,
	"body" jsonb NOT NULL,
	"body_hash" text NOT NULL,
	"quota_remaining" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" text
);
--> statement-breakpoint
CREATE TABLE "core"."asset" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"kind" "core"."asset_kind" NOT NULL,
	"source_url" text NOT NULL,
	"storage_key" text,
	"sha256" text,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."competition" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"sport" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"labels" jsonb,
	"country_code" text,
	"type" "core"."competition_type" NOT NULL,
	"tier" smallint DEFAULT 3 NOT NULL,
	"live_priority" text DEFAULT 'none' NOT NULL,
	"logo_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."country" (
	"code" text PRIMARY KEY NOT NULL,
	"name" jsonb NOT NULL,
	"ioc_code" text,
	"confederation" text,
	"flag_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."event" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"sport" text NOT NULL,
	"competition_id" uuid,
	"season_id" uuid,
	"stage_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at_expected" timestamp with time zone NOT NULL,
	"status" "core"."event_status" DEFAULT 'scheduled' NOT NULL,
	"status_detail" text,
	"clock" jsonb,
	"score" jsonb,
	"venue_id" uuid,
	"last_valid_at" timestamp with time zone,
	"is_stale" boolean DEFAULT false NOT NULL,
	"importance" integer DEFAULT 0 NOT NULL,
	"derby_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."event_incident" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"event_id" uuid NOT NULL,
	"minute" integer,
	"extra" integer,
	"type" text NOT NULL,
	"detail" text,
	"participant_id" uuid,
	"person_id" uuid,
	"assist_person_id" uuid,
	"sequence" integer NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "core"."event_participant" (
	"event_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"side" text NOT NULL,
	"position" integer,
	"result" jsonb,
	CONSTRAINT "event_participant_event_id_participant_id_pk" PRIMARY KEY("event_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "core"."event_state_log" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"event_id" uuid NOT NULL,
	"from_status" "core"."event_status",
	"to_status" "core"."event_status" NOT NULL,
	"reason" text NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."football_fixture" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"provider_fixture_id" integer NOT NULL,
	"round" text,
	"referee" text,
	"summary" jsonb NOT NULL,
	"detail" jsonb,
	"detail_fetched_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."participant" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"sport" text NOT NULL,
	"kind" "core"."participant_kind" NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"code" text,
	"country_code" text,
	"founded" integer,
	"home_venue_id" uuid,
	"logo_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."person" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"birth_date" date,
	"nationality" text,
	"height_cm" integer,
	"weight_kg" integer,
	"photo_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."provider_map" (
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"sport" text NOT NULL,
	"provider_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_map_provider_sport_entity_type_provider_id_pk" PRIMARY KEY("provider","sport","entity_type","provider_id")
);
--> statement-breakpoint
CREATE TABLE "core"."roster" (
	"participant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"season_id" uuid,
	"role" text NOT NULL,
	"number" integer,
	"position" text,
	"valid_from" date,
	"valid_to" date
);
--> statement-breakpoint
CREATE TABLE "core"."season" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"competition_id" uuid NOT NULL,
	"label" text NOT NULL,
	"year" integer NOT NULL,
	"start_date" date,
	"end_date" date,
	"current" boolean DEFAULT false NOT NULL,
	"coverage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."sport" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."stage" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"season_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" jsonb NOT NULL,
	"provider_label" text,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."standing" (
	"season_id" uuid NOT NULL,
	"group" text DEFAULT '' NOT NULL,
	"participant_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"points" integer NOT NULL,
	"played" integer DEFAULT 0 NOT NULL,
	"won" integer DEFAULT 0 NOT NULL,
	"drawn" integer DEFAULT 0 NOT NULL,
	"lost" integer DEFAULT 0 NOT NULL,
	"goals_for" integer DEFAULT 0 NOT NULL,
	"goals_against" integer DEFAULT 0 NOT NULL,
	"form" text,
	"description" text,
	"source" text DEFAULT 'provider' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standing_season_id_group_participant_id_pk" PRIMARY KEY("season_id","group","participant_id")
);
--> statement-breakpoint
CREATE TABLE "core"."venue" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"country_code" text,
	"capacity" integer,
	"surface" text,
	"image_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "semantic"."competition_profile" (
	"slug" text PRIMARY KEY NOT NULL,
	"competition_id" uuid,
	"labels" jsonb,
	"nicknames" jsonb,
	"trophy_nickname" text,
	"source_file" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_status" "semantic"."review_status" DEFAULT 'draft' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "semantic"."copy_template" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"locale" text NOT NULL,
	"sport" text NOT NULL,
	"copy_intent" text NOT NULL,
	"tone_intensity" smallint NOT NULL,
	"affinity_type" text,
	"affinity_source" text,
	"momentum" text,
	"competition_context" text,
	"confidence" text NOT NULL,
	"template" text NOT NULL,
	"review_status" "semantic"."review_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "semantic"."derby" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labels" jsonb,
	"scope" text NOT NULL,
	"intensity" smallint NOT NULL,
	"first_match" date,
	"origin" text,
	"trivia" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_file" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_status" "semantic"."review_status" DEFAULT 'draft' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "derby_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "semantic"."derby_team" (
	"derby_id" uuid NOT NULL,
	"team_slug" text NOT NULL,
	CONSTRAINT "derby_team_derby_id_team_slug_pk" PRIMARY KEY("derby_id","team_slug")
);
--> statement-breakpoint
CREATE TABLE "semantic"."load_run" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"git_sha" text,
	"teams" smallint NOT NULL,
	"derbies" smallint NOT NULL,
	"competitions" smallint NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "semantic"."team_profile" (
	"slug" text PRIMARY KEY NOT NULL,
	"participant_id" uuid,
	"country_code" text NOT NULL,
	"names" jsonb NOT NULL,
	"labels" jsonb,
	"nicknames" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fans" jsonb,
	"mascot" text,
	"rallying_cries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stadium" jsonb,
	"identity" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"copy_hints" jsonb,
	"source_file" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_status" "semantic"."review_status" DEFAULT 'draft' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrich"."broadcast_option" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"event_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	"region" text,
	"provider_name" text NOT NULL,
	"channel_name" text,
	"medium" "enrich"."broadcast_medium" NOT NULL,
	"access_model" "enrich"."access_model" NOT NULL,
	"url" text,
	"language" text,
	"status" "enrich"."broadcast_status" NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"evidence" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"produced_by" text NOT NULL,
	"superseded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "enrich"."event_context" (
	"event_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"kind" text NOT NULL,
	"content" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"model" text NOT NULL,
	"confidence" numeric(3, 2),
	"review_status" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_context_event_id_locale_kind_created_at_pk" PRIMARY KEY("event_id","locale","kind","created_at")
);
--> statement-breakpoint
CREATE TABLE "ops"."change_feed" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."job_run" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"job" text NOT NULL,
	"status" text NOT NULL,
	"calls_spent" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"stats" jsonb
);
--> statement-breakpoint
CREATE TABLE "ops"."quota_budget" (
	"provider" text DEFAULT 'api-sports' NOT NULL,
	"api" text NOT NULL,
	"day_utc" date NOT NULL,
	"priority" "ops"."quota_priority" NOT NULL,
	"planned" integer NOT NULL,
	CONSTRAINT "quota_budget_provider_api_day_utc_priority_pk" PRIMARY KEY("provider","api","day_utc","priority")
);
--> statement-breakpoint
CREATE TABLE "ops"."quota_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'api-sports' NOT NULL,
	"api" text NOT NULL,
	"day_utc" date NOT NULL,
	"priority" "ops"."quota_priority" NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"remaining_after" integer,
	"job_id" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."sync_cursor" (
	"provider" text DEFAULT 'api-sports' NOT NULL,
	"sport" text NOT NULL,
	"endpoint" text NOT NULL,
	"key" text NOT NULL,
	"cursor" jsonb,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_cursor_provider_sport_endpoint_key_pk" PRIMARY KEY("provider","sport","endpoint","key")
);
--> statement-breakpoint
ALTER TABLE "core"."competition" ADD CONSTRAINT "competition_sport_sport_slug_fk" FOREIGN KEY ("sport") REFERENCES "core"."sport"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."competition" ADD CONSTRAINT "competition_country_code_country_code_fk" FOREIGN KEY ("country_code") REFERENCES "core"."country"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."competition" ADD CONSTRAINT "competition_logo_asset_id_asset_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."country" ADD CONSTRAINT "country_flag_asset_id_asset_id_fk" FOREIGN KEY ("flag_asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event" ADD CONSTRAINT "event_sport_sport_slug_fk" FOREIGN KEY ("sport") REFERENCES "core"."sport"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event" ADD CONSTRAINT "event_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "core"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event" ADD CONSTRAINT "event_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "core"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event" ADD CONSTRAINT "event_stage_id_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "core"."stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event" ADD CONSTRAINT "event_venue_id_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "core"."venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event_incident" ADD CONSTRAINT "event_incident_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event_incident" ADD CONSTRAINT "event_incident_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "core"."participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event_incident" ADD CONSTRAINT "event_incident_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event_incident" ADD CONSTRAINT "event_incident_assist_person_id_person_id_fk" FOREIGN KEY ("assist_person_id") REFERENCES "core"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event_participant" ADD CONSTRAINT "event_participant_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event_participant" ADD CONSTRAINT "event_participant_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "core"."participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event_state_log" ADD CONSTRAINT "event_state_log_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."football_fixture" ADD CONSTRAINT "football_fixture_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."participant" ADD CONSTRAINT "participant_sport_sport_slug_fk" FOREIGN KEY ("sport") REFERENCES "core"."sport"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."participant" ADD CONSTRAINT "participant_country_code_country_code_fk" FOREIGN KEY ("country_code") REFERENCES "core"."country"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."participant" ADD CONSTRAINT "participant_home_venue_id_venue_id_fk" FOREIGN KEY ("home_venue_id") REFERENCES "core"."venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."participant" ADD CONSTRAINT "participant_logo_asset_id_asset_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."person" ADD CONSTRAINT "person_photo_asset_id_asset_id_fk" FOREIGN KEY ("photo_asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."roster" ADD CONSTRAINT "roster_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "core"."participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."roster" ADD CONSTRAINT "roster_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."roster" ADD CONSTRAINT "roster_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "core"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."season" ADD CONSTRAINT "season_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "core"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."stage" ADD CONSTRAINT "stage_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "core"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."standing" ADD CONSTRAINT "standing_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "core"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."standing" ADD CONSTRAINT "standing_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "core"."participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."venue" ADD CONSTRAINT "venue_country_code_country_code_fk" FOREIGN KEY ("country_code") REFERENCES "core"."country"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."venue" ADD CONSTRAINT "venue_image_asset_id_asset_id_fk" FOREIGN KEY ("image_asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic"."competition_profile" ADD CONSTRAINT "competition_profile_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "core"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic"."derby_team" ADD CONSTRAINT "derby_team_derby_id_derby_id_fk" FOREIGN KEY ("derby_id") REFERENCES "semantic"."derby"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic"."derby_team" ADD CONSTRAINT "derby_team_team_slug_team_profile_slug_fk" FOREIGN KEY ("team_slug") REFERENCES "semantic"."team_profile"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic"."team_profile" ADD CONSTRAINT "team_profile_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "core"."participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."broadcast_option" ADD CONSTRAINT "broadcast_option_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."event_context" ADD CONSTRAINT "event_context_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_response_lookup_idx" ON "raw"."api_response" USING btree ("provider","sport","endpoint","request_hash","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "api_response_fetched_at_idx" ON "raw"."api_response" USING btree ("fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_source_url_uq" ON "core"."asset" USING btree ("source_url");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_sport_slug_uq" ON "core"."competition" USING btree ("sport","slug");--> statement-breakpoint
CREATE INDEX "competition_tier_idx" ON "core"."competition" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "event_starts_at_idx" ON "core"."event" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "event_status_idx" ON "core"."event" USING btree ("status");--> statement-breakpoint
CREATE INDEX "event_competition_starts_idx" ON "core"."event" USING btree ("competition_id","starts_at");--> statement-breakpoint
CREATE INDEX "event_sport_starts_idx" ON "core"."event" USING btree ("sport","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_incident_seq_uq" ON "core"."event_incident" USING btree ("event_id","sequence");--> statement-breakpoint
CREATE INDEX "event_participant_participant_idx" ON "core"."event_participant" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "event_state_log_event_idx" ON "core"."event_state_log" USING btree ("event_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "football_fixture_provider_uq" ON "core"."football_fixture" USING btree ("provider_fixture_id");--> statement-breakpoint
CREATE INDEX "participant_sport_country_idx" ON "core"."participant" USING btree ("sport","country_code");--> statement-breakpoint
CREATE INDEX "participant_name_idx" ON "core"."participant" USING btree ("name");--> statement-breakpoint
CREATE INDEX "provider_map_entity_idx" ON "core"."provider_map" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_uq" ON "core"."roster" USING btree ("participant_id","person_id","role","season_id");--> statement-breakpoint
CREATE INDEX "roster_person_idx" ON "core"."roster" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "season_competition_year_uq" ON "core"."season" USING btree ("competition_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_season_label_uq" ON "core"."stage" USING btree ("season_id","provider_label");--> statement-breakpoint
CREATE INDEX "copy_template_lookup_idx" ON "semantic"."copy_template" USING btree ("locale","sport","copy_intent");--> statement-breakpoint
CREATE INDEX "derby_team_slug_idx" ON "semantic"."derby_team" USING btree ("team_slug");--> statement-breakpoint
CREATE INDEX "team_profile_participant_idx" ON "semantic"."team_profile" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "broadcast_option_event_country_idx" ON "enrich"."broadcast_option" USING btree ("event_id","country_code","status");--> statement-breakpoint
CREATE INDEX "change_feed_created_idx" ON "ops"."change_feed" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "job_run_job_started_idx" ON "ops"."job_run" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "quota_ledger_day_idx" ON "ops"."quota_ledger" USING btree ("provider","api","day_utc");