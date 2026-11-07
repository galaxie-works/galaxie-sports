-- Estatísticas do time por temporada (#893): o agregado de `teams/statistics` da api-sports no nosso formato,
-- renovado pelo espelho diário (#855). Tabela nova, sem dados a migrar.
CREATE TABLE "core"."team_season_stat" (
	"participant_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"played" integer,
	"won" integer,
	"drawn" integer,
	"lost" integer,
	"goals_for" integer,
	"goals_against" integer,
	"clean_sheets" integer,
	"failed_to_score" integer,
	"form" text,
	"stats" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_season_stat_participant_id_season_id_pk" PRIMARY KEY("participant_id","season_id")
);
--> statement-breakpoint
ALTER TABLE "core"."team_season_stat" ADD CONSTRAINT "team_season_stat_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "core"."participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."team_season_stat" ADD CONSTRAINT "team_season_stat_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "core"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_season_stat_season_idx" ON "core"."team_season_stat" USING btree ("season_id");
