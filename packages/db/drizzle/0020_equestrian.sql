CREATE SCHEMA "equestrian";
--> statement-breakpoint
CREATE TABLE "equestrian"."athlete" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"participant_id" uuid,
	"fei_id" text,
	"name_as_published" text NOT NULL,
	"display_name" text NOT NULL,
	"first_name" text,
	"family_name" text,
	"gender" text,
	"birth_date" date,
	"birth_date_raw" text,
	"nationality" text,
	"competing_for" text,
	"registry_status_raw" text,
	"history_coverage" text DEFAULT 'not_collected' NOT NULL,
	"displayed_total_raw" text,
	"collected_results" integer,
	"source" text NOT NULL,
	"source_url" text,
	"observed_at" timestamp with time zone,
	"import_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equestrian"."competition" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"discipline" text DEFAULT 'jumping' NOT NULL,
	"name" text NOT NULL,
	"level" text,
	"stars" integer,
	"level_kind" text,
	"date" date,
	"date_raw" text,
	"venue" text,
	"country_code" text,
	"height_cm" integer,
	"article_code" text,
	"article_text" text,
	"judging" text,
	"is_grand_prix" boolean DEFAULT false NOT NULL,
	"schedule_number" text,
	"show_key" text,
	"show_start" date,
	"show_end" date,
	"prize_total" numeric(14, 2),
	"prize_currency" text,
	"prize_total_raw" text,
	"displayed_entries" integer,
	"observed_entries" integer,
	"all_entries_observed" boolean DEFAULT false NOT NULL,
	"fei_reference_code" text,
	"source_url" text,
	"observed_at" timestamp with time zone,
	"import_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equestrian"."horse" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"fei_id" text,
	"name" text NOT NULL,
	"name_variants" jsonb,
	"birth_name" text,
	"complete_name" text,
	"birth_date" date,
	"birth_date_raw" text,
	"gender" text,
	"castrated" text,
	"color" text,
	"breed" text,
	"studbook" text,
	"breeder" text,
	"sire" text,
	"dam" text,
	"dam_sire" text,
	"birth_country" text,
	"admin_nf" text,
	"registry_status_raw" text,
	"profile_status" text DEFAULT 'pending' NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"observed_at" timestamp with time zone,
	"import_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equestrian"."horse_owner" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"horse_id" uuid NOT NULL,
	"owner_name" text NOT NULL,
	"nationality" text,
	"since_raw" text,
	"percentage_raw" text,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"source_url" text,
	"observed_at" timestamp with time zone,
	"import_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "equestrian"."import_run" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"source" text NOT NULL,
	"license" text NOT NULL,
	"package_name" text NOT NULL,
	"package_sha256" text NOT NULL,
	"schema_version" integer,
	"counts" jsonb,
	"notes" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "equestrian"."ranking_observation" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"ranking_name" text NOT NULL,
	"athlete_id" uuid,
	"horse_id" uuid,
	"horse_name_as_published" text,
	"rank" integer,
	"rank_raw" text,
	"points" numeric(10, 2),
	"points_raw" text,
	"edition" text,
	"coverage" text,
	"source_url" text,
	"observed_at" timestamp with time zone,
	"import_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "equestrian"."result" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"source_kind" text NOT NULL,
	"competition_id" uuid,
	"athlete_id" uuid,
	"athlete_name_as_published" text NOT NULL,
	"horse_id" uuid,
	"horse_name_as_published" text,
	"country_code" text,
	"country_basis" text,
	"date" date,
	"position" integer,
	"position_raw" text,
	"status" text DEFAULT 'unknown' NOT NULL,
	"score_raw" text,
	"score_parse_status" text,
	"penalties" numeric(8, 2),
	"penalties_jumping" numeric(8, 2),
	"penalties_time" numeric(8, 2),
	"time_seconds" numeric(8, 2),
	"score_parts" jsonb,
	"round_cells" jsonb,
	"published_breakdown" jsonb,
	"prize_amount" numeric(14, 2),
	"prize_currency" text,
	"prize_raw" text,
	"quality_flags" jsonb,
	"source_url" text,
	"observed_at" timestamp with time zone,
	"import_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equestrian"."round" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"event_key" text NOT NULL,
	"stage" text NOT NULL,
	"date" date,
	"date_precision" text,
	"event_start" date,
	"event_end" date,
	"athlete_id" uuid,
	"athlete_name_as_published" text NOT NULL,
	"horse_id" uuid,
	"horse_name_as_published" text,
	"country_code" text,
	"bib" text,
	"rank_raw" text,
	"status" text,
	"penalties_jumping" numeric(8, 2),
	"penalties_time" numeric(8, 2),
	"score" numeric(8, 2),
	"score_raw" text,
	"score_semantics" text,
	"time_seconds" numeric(8, 2),
	"source_url" text,
	"source_pdf_page" integer,
	"source_document_sha256" text,
	"observed_at" timestamp with time zone,
	"import_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equestrian"."source_disagreement" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"athlete_id" uuid,
	"event_key" text,
	"field" text NOT NULL,
	"values" jsonb NOT NULL,
	"resolution" text,
	"import_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "equestrian"."team_result" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"event_key" text NOT NULL,
	"country_code" text NOT NULL,
	"position" integer,
	"position_raw" text,
	"score_raw" text,
	"prize_raw" text,
	"members" jsonb,
	"arithmetic" jsonb,
	"source_url" text,
	"source_pdf_page" integer,
	"observed_at" timestamp with time zone,
	"import_run_id" uuid
);
--> statement-breakpoint
ALTER TABLE "equestrian"."athlete" ADD CONSTRAINT "athlete_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "core"."participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."athlete" ADD CONSTRAINT "athlete_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "equestrian"."import_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."competition" ADD CONSTRAINT "competition_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "equestrian"."import_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."horse" ADD CONSTRAINT "horse_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "equestrian"."import_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."horse_owner" ADD CONSTRAINT "horse_owner_horse_id_horse_id_fk" FOREIGN KEY ("horse_id") REFERENCES "equestrian"."horse"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."horse_owner" ADD CONSTRAINT "horse_owner_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "equestrian"."import_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."ranking_observation" ADD CONSTRAINT "ranking_observation_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "equestrian"."athlete"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."ranking_observation" ADD CONSTRAINT "ranking_observation_horse_id_horse_id_fk" FOREIGN KEY ("horse_id") REFERENCES "equestrian"."horse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."ranking_observation" ADD CONSTRAINT "ranking_observation_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "equestrian"."import_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."result" ADD CONSTRAINT "result_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "equestrian"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."result" ADD CONSTRAINT "result_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "equestrian"."athlete"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."result" ADD CONSTRAINT "result_horse_id_horse_id_fk" FOREIGN KEY ("horse_id") REFERENCES "equestrian"."horse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."result" ADD CONSTRAINT "result_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "equestrian"."import_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."round" ADD CONSTRAINT "round_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "equestrian"."athlete"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."round" ADD CONSTRAINT "round_horse_id_horse_id_fk" FOREIGN KEY ("horse_id") REFERENCES "equestrian"."horse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."round" ADD CONSTRAINT "round_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "equestrian"."import_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."source_disagreement" ADD CONSTRAINT "source_disagreement_athlete_id_athlete_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "equestrian"."athlete"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."source_disagreement" ADD CONSTRAINT "source_disagreement_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "equestrian"."import_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equestrian"."team_result" ADD CONSTRAINT "team_result_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "equestrian"."import_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "athlete_fei_id_uq" ON "equestrian"."athlete" USING btree ("fei_id");--> statement-breakpoint
CREATE INDEX "athlete_competing_for_idx" ON "equestrian"."athlete" USING btree ("competing_for");--> statement-breakpoint
CREATE INDEX "athlete_display_name_idx" ON "equestrian"."athlete" USING btree ("display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_source_uq" ON "equestrian"."competition" USING btree ("source","source_key");--> statement-breakpoint
CREATE INDEX "competition_date_idx" ON "equestrian"."competition" USING btree ("date");--> statement-breakpoint
CREATE INDEX "competition_country_idx" ON "equestrian"."competition" USING btree ("country_code","date");--> statement-breakpoint
CREATE UNIQUE INDEX "horse_fei_id_uq" ON "equestrian"."horse" USING btree ("fei_id");--> statement-breakpoint
CREATE INDEX "horse_name_idx" ON "equestrian"."horse" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "horse_owner_source_uq" ON "equestrian"."horse_owner" USING btree ("source","source_key");--> statement-breakpoint
CREATE INDEX "horse_owner_horse_idx" ON "equestrian"."horse_owner" USING btree ("horse_id");--> statement-breakpoint
CREATE INDEX "import_run_source_idx" ON "equestrian"."import_run" USING btree ("source","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ranking_observation_source_uq" ON "equestrian"."ranking_observation" USING btree ("source","source_key");--> statement-breakpoint
CREATE INDEX "ranking_observation_name_idx" ON "equestrian"."ranking_observation" USING btree ("ranking_name","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "result_source_uq" ON "equestrian"."result" USING btree ("source","source_key");--> statement-breakpoint
CREATE INDEX "result_athlete_date_idx" ON "equestrian"."result" USING btree ("athlete_id","date");--> statement-breakpoint
CREATE INDEX "result_horse_date_idx" ON "equestrian"."result" USING btree ("horse_id","date");--> statement-breakpoint
CREATE INDEX "result_competition_idx" ON "equestrian"."result" USING btree ("competition_id","position");--> statement-breakpoint
CREATE INDEX "result_country_date_idx" ON "equestrian"."result" USING btree ("country_code","date");--> statement-breakpoint
CREATE UNIQUE INDEX "round_source_uq" ON "equestrian"."round" USING btree ("source","source_key");--> statement-breakpoint
CREATE INDEX "round_event_stage_idx" ON "equestrian"."round" USING btree ("event_key","stage");--> statement-breakpoint
CREATE INDEX "round_athlete_idx" ON "equestrian"."round" USING btree ("athlete_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_disagreement_source_uq" ON "equestrian"."source_disagreement" USING btree ("source","source_key");--> statement-breakpoint
CREATE INDEX "source_disagreement_athlete_idx" ON "equestrian"."source_disagreement" USING btree ("athlete_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_result_source_uq" ON "equestrian"."team_result" USING btree ("source","source_key");--> statement-breakpoint
CREATE INDEX "team_result_event_idx" ON "equestrian"."team_result" USING btree ("event_key");--> statement-breakpoint
INSERT INTO "core"."sport" ("slug", "name") VALUES ('equestrian', '{"pt-BR":"Hipismo","es":"Hípica","es-AR":"Hípica","en":"Equestrian"}'::jsonb) ON CONFLICT ("slug") DO NOTHING;
