CREATE TABLE "enrich"."broadcast_audit" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"option_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	"sample_date" date NOT NULL,
	"reason" text NOT NULL,
	"verdict" text,
	"reviewer" text,
	"note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrich"."broadcast_correction" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"event_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	"action" text NOT NULL,
	"option_id" uuid,
	"previous_option_id" uuid,
	"actor" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reported_at" timestamp with time zone,
	"change_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrich"."wtw_run" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"run_key" text NOT NULL,
	"event_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	"window" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by" text DEFAULT 'scheduler' NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"provider" text,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6),
	"stats" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."llm_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"day_utc" date NOT NULL,
	"agent" text NOT NULL,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"tier" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"web_searches" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6),
	"outcome" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrich"."broadcast_option" ADD COLUMN "broadcaster_id" text;--> statement-breakpoint
ALTER TABLE "enrich"."broadcast_option" ADD COLUMN "source_kind" text;--> statement-breakpoint
ALTER TABLE "enrich"."broadcast_option" ADD COLUMN "conflict" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enrich"."broadcast_option" ADD COLUMN "flags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "enrich"."broadcast_option" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "enrich"."broadcast_option" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "enrich"."broadcast_option" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrich"."broadcast_audit" ADD CONSTRAINT "broadcast_audit_option_id_broadcast_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "enrich"."broadcast_option"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."broadcast_audit" ADD CONSTRAINT "broadcast_audit_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."broadcast_correction" ADD CONSTRAINT "broadcast_correction_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."wtw_run" ADD CONSTRAINT "wtw_run_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "core"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_audit_option_day_uq" ON "enrich"."broadcast_audit" USING btree ("option_id","sample_date");--> statement-breakpoint
CREATE INDEX "broadcast_audit_pending_idx" ON "enrich"."broadcast_audit" USING btree ("verdict","sample_date");--> statement-breakpoint
CREATE INDEX "broadcast_correction_event_idx" ON "enrich"."broadcast_correction" USING btree ("event_id","country_code","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wtw_run_key_uq" ON "enrich"."wtw_run" USING btree ("run_key");--> statement-breakpoint
CREATE INDEX "wtw_run_status_idx" ON "enrich"."wtw_run" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "wtw_run_event_idx" ON "enrich"."wtw_run" USING btree ("event_id","country_code");--> statement-breakpoint
CREATE INDEX "llm_usage_day_agent_idx" ON "ops"."llm_usage" USING btree ("day_utc","agent");--> statement-breakpoint
CREATE INDEX "broadcast_option_current_idx" ON "enrich"."broadcast_option" USING btree ("event_id","country_code") WHERE "enrich"."broadcast_option"."superseded_by" is null;