CREATE TABLE "ops"."quality_failure" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"sport" text NOT NULL,
	"item_key" text NOT NULL,
	"label" text NOT NULL,
	"current" text,
	"expected" text,
	"link" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."quality_result" (
	"run_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"sport" text NOT NULL,
	"severity" text NOT NULL,
	"status" text NOT NULL,
	"checked" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"detail" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "quality_result_run_id_rule_id_sport_pk" PRIMARY KEY("run_id","rule_id","sport")
);
--> statement-breakpoint
CREATE TABLE "ops"."quality_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"sport" text NOT NULL,
	"area" text NOT NULL,
	"severity" text NOT NULL,
	"description" jsonb NOT NULL,
	"origin" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."quality_run" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"rules" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "ops"."quality_failure" ADD CONSTRAINT "quality_failure_run_id_quality_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "ops"."quality_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."quality_result" ADD CONSTRAINT "quality_result_run_id_quality_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "ops"."quality_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quality_failure_run_idx" ON "ops"."quality_failure" USING btree ("run_id","rule_id","sport");--> statement-breakpoint
CREATE INDEX "quality_result_rule_idx" ON "ops"."quality_result" USING btree ("rule_id","sport");--> statement-breakpoint
CREATE INDEX "quality_run_started_idx" ON "ops"."quality_run" USING btree ("started_at");