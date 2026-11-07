-- Palpites e odds por jogo (docs/04 §2.4): core.event_prediction (um palpite por jogo), core.bookmaker (casas;
-- o ID do fornecedor fica no provider_map) e core.event_odds (foto mais recente das odds pré-jogo de cada casa no
-- jogo, mercados e seleções com chaves nossas). Só tabelas novas: nada é reescrito.
CREATE TABLE "core"."bookmaker" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmaker_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "core"."event_odds" (
	"event_id" uuid NOT NULL,
	"bookmaker_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"markets" jsonb NOT NULL,
	"source_updated_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_odds_event_id_bookmaker_id_pk" PRIMARY KEY("event_id","bookmaker_id")
);
--> statement-breakpoint
CREATE TABLE "core"."event_prediction" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"winner_participant_id" uuid,
	"win_or_draw" boolean,
	"prob_home" numeric(5, 2),
	"prob_draw" numeric(5, 2),
	"prob_away" numeric(5, 2),
	"goals" jsonb,
	"comparison" jsonb,
	"recent_form" jsonb,
	"advice" text,
	"winner_comment" text,
	"observed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."event_odds" ADD CONSTRAINT "event_odds_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event_odds" ADD CONSTRAINT "event_odds_bookmaker_id_bookmaker_id_fk" FOREIGN KEY ("bookmaker_id") REFERENCES "core"."bookmaker"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event_prediction" ADD CONSTRAINT "event_prediction_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."event_prediction" ADD CONSTRAINT "event_prediction_winner_participant_id_participant_id_fk" FOREIGN KEY ("winner_participant_id") REFERENCES "core"."participant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_prediction_winner_idx" ON "core"."event_prediction" USING btree ("winner_participant_id");