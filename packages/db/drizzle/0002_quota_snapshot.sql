CREATE TABLE "ops"."quota_snapshot" (
	"provider" text DEFAULT 'api-sports' NOT NULL,
	"api" text NOT NULL,
	"day_utc" date NOT NULL,
	"provider_used" integer NOT NULL,
	"provider_limit" integer NOT NULL,
	"plan" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_snapshot_provider_api_day_utc_pk" PRIMARY KEY("provider","api","day_utc")
);
