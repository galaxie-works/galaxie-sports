CREATE TABLE "core"."explore_summary" (
	"sport" text NOT NULL,
	"market" text NOT NULL,
	"data" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "explore_summary_sport_market_pk" PRIMARY KEY("sport","market")
);
