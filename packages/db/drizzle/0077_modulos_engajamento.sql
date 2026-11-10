CREATE TABLE "api"."module_usage_monthly" (
	"tenant_id" uuid NOT NULL,
	"month" date NOT NULL,
	"module" text NOT NULL,
	"metric" text NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"epoch" text,
	"epoch_base" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_usage_monthly_tenant_id_month_module_metric_pk" PRIMARY KEY("tenant_id","month","module","metric")
);
--> statement-breakpoint
CREATE TABLE "api"."tenant_module_limit" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" integer NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_module_limit_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "api"."module_usage_monthly" ADD CONSTRAINT "module_usage_monthly_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."tenant_module_limit" ADD CONSTRAINT "tenant_module_limit_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "module_usage_monthly_month_idx" ON "api"."module_usage_monthly" USING btree ("month");