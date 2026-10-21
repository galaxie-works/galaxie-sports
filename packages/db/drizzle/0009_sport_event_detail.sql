CREATE TABLE "core"."sport_event_detail" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"sport" text NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"kind" text NOT NULL,
	"summary" jsonb NOT NULL,
	"detail" jsonb,
	"detail_fetched_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."sport_event_detail" ADD CONSTRAINT "sport_event_detail_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."sport_event_detail" ADD CONSTRAINT "sport_event_detail_sport_sport_slug_fk" FOREIGN KEY ("sport") REFERENCES "core"."sport"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sport_event_detail_provider_uq" ON "core"."sport_event_detail" USING btree ("provider","sport","provider_event_id");