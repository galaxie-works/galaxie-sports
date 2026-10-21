ALTER TABLE "semantic"."competition_profile" ADD COLUMN "api_sports_league_id" integer;--> statement-breakpoint
ALTER TABLE "semantic"."competition_profile" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "semantic"."copy_template" ADD COLUMN "key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "semantic"."copy_template" ADD COLUMN "source_file" text;--> statement-breakpoint
ALTER TABLE "semantic"."copy_template" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "semantic"."copy_template" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "semantic"."derby" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "semantic"."load_run" ADD COLUMN "copy_templates" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "semantic"."load_run" ADD COLUMN "stats" jsonb;--> statement-breakpoint
ALTER TABLE "semantic"."team_profile" ADD COLUMN "kind" text DEFAULT 'club' NOT NULL;--> statement-breakpoint
ALTER TABLE "semantic"."team_profile" ADD COLUMN "api_sports_team_id" integer;--> statement-breakpoint
ALTER TABLE "semantic"."team_profile" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "semantic"."team_profile" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "semantic"."team_profile" ADD COLUMN "founded" date;--> statement-breakpoint
ALTER TABLE "semantic"."team_profile" ADD COLUMN "colors" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "semantic"."team_profile" ADD COLUMN "rivals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "semantic"."team_profile" ADD COLUMN "world_cup_titles" smallint;--> statement-breakpoint
ALTER TABLE "semantic"."team_profile" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "core"."event" ADD CONSTRAINT "event_derby_id_derby_id_fk" FOREIGN KEY ("derby_id") REFERENCES "semantic"."derby"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "copy_template_key_uq" ON "semantic"."copy_template" USING btree ("key");--> statement-breakpoint
CREATE INDEX "team_profile_api_sports_idx" ON "semantic"."team_profile" USING btree ("api_sports_team_id");