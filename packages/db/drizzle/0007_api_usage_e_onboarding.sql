CREATE TABLE "api"."usage_daily" (
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"route" text NOT NULL,
	"requests" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_daily_tenant_id_day_route_pk" PRIMARY KEY("tenant_id","day","route")
);
--> statement-breakpoint
ALTER TABLE "api"."api_key" ADD COLUMN "env" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."tenant" ADD COLUMN "daily_request_quota" integer;--> statement-breakpoint
ALTER TABLE "api"."usage_daily" ADD CONSTRAINT "usage_daily_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_daily_day_idx" ON "api"."usage_daily" USING btree ("day");