-- Presença ao vivo verificada (#906, B9): janelas de presença por jogo (fan, dado pessoal) e o limite de jogos ao
-- mesmo tempo que o cliente escolheu (engage). Só expansão.
CREATE TABLE "fan"."presence_window" (
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_interaction_at" timestamp with time zone NOT NULL,
	"heartbeats" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "presence_window_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "presence_window_order" CHECK ("fan"."presence_window"."last_seen_at" >= "fan"."presence_window"."started_at"),
	CONSTRAINT "presence_window_interaction" CHECK ("fan"."presence_window"."last_interaction_at" <= "fan"."presence_window"."last_seen_at"),
	CONSTRAINT "presence_window_heartbeats" CHECK ("fan"."presence_window"."heartbeats" >= 1)
);
--> statement-breakpoint
CREATE TABLE "engage"."presence_limit" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"max_games" smallint NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presence_limit_range" CHECK ("engage"."presence_limit"."max_games" between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "fan"."presence_window" ADD CONSTRAINT "presence_window_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fan"."presence_window" ADD CONSTRAINT "presence_window_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engage"."presence_limit" ADD CONSTRAINT "presence_limit_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "presence_window_lookup_idx" ON "fan"."presence_window" USING btree ("tenant_id","profile_id","event_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "presence_window_open_idx" ON "fan"."presence_window" USING btree ("tenant_id","profile_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "presence_window_purge_idx" ON "fan"."presence_window" USING btree ("last_seen_at");