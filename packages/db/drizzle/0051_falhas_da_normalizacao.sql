CREATE TABLE "ops"."normalize_failure" (
	"provider" text NOT NULL,
	"sport" text NOT NULL,
	"raw_id" bigint NOT NULL,
	"endpoint" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"error" text,
	"first_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"poisoned_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "normalize_failure_provider_sport_raw_id_pk" PRIMARY KEY("provider","sport","raw_id")
);
