CREATE TABLE "core"."competition_title" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"competition_id" uuid NOT NULL,
	"participant_id" uuid,
	"season_year" smallint NOT NULL,
	"season_label" text NOT NULL,
	"decided_on" date NOT NULL,
	"edition_qid" text NOT NULL,
	"winner_qid" text NOT NULL,
	"competition_qid" text NOT NULL,
	"source" text DEFAULT 'wikidata' NOT NULL,
	"source_ref" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."competition_title_coverage" (
	"competition_id" uuid PRIMARY KEY NOT NULL,
	"competition_qid" text NOT NULL,
	"first_year" smallint,
	"latest_year" smallint,
	"complete_through" smallint,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."competition_title" ADD CONSTRAINT "competition_title_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "core"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."competition_title" ADD CONSTRAINT "competition_title_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "core"."participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."competition_title_coverage" ADD CONSTRAINT "competition_title_coverage_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "core"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competition_title_uq" ON "core"."competition_title" USING btree ("competition_id","edition_qid","winner_qid");--> statement-breakpoint
CREATE INDEX "competition_title_team_idx" ON "core"."competition_title" USING btree ("participant_id","competition_id","decided_on");