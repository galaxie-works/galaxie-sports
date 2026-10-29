CREATE TABLE "ops"."llm_usage_daily" (
	"day_utc" date NOT NULL,
	"budget_day" date NOT NULL,
	"band" text DEFAULT '' NOT NULL,
	"agent" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"tier" text NOT NULL,
	"outcome" text NOT NULL,
	"calls" integer NOT NULL,
	"input_tokens" bigint NOT NULL,
	"output_tokens" bigint NOT NULL,
	"web_searches" integer NOT NULL,
	"cost_usd" numeric(14, 6),
	"aggregated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_usage_daily_day_utc_budget_day_band_agent_provider_model_tier_outcome_pk" PRIMARY KEY("day_utc","budget_day","band","agent","provider","model","tier","outcome")
);
--> statement-breakpoint
ALTER TABLE "raw"."api_response" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raw"."api_response" ADD COLUMN "seen_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "raw"."api_response" ADD COLUMN "retention" text DEFAULT 'keep' NOT NULL;