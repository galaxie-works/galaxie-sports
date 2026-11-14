CREATE TABLE "api"."access_error_daily" (
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"reason" text NOT NULL,
	"key_prefix" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	CONSTRAINT "access_error_daily_tenant_id_day_reason_key_prefix_detail_pk" PRIMARY KEY("tenant_id","day","reason","key_prefix","detail")
);
--> statement-breakpoint
ALTER TABLE "api"."webhook_delivery" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "api"."webhook_delivery" ADD COLUMN "response_excerpt" text;--> statement-breakpoint
ALTER TABLE "api"."access_error_daily" ADD CONSTRAINT "access_error_daily_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_error_daily_day_idx" ON "api"."access_error_daily" USING btree ("day");