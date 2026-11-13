-- Cota da carteira da Cosmos por sala e produto (#1116): só expansão, uma tabela nova.
CREATE TABLE "cosmos"."wallet_quota" (
	"tenant_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_quota_tenant_id_scope_pk" PRIMARY KEY("tenant_id","scope"),
	CONSTRAINT "wallet_quota_percent" CHECK ("cosmos"."wallet_quota"."percent" > 0 and "cosmos"."wallet_quota"."percent" <= 100)
);
--> statement-breakpoint
ALTER TABLE "cosmos"."wallet_quota" ADD CONSTRAINT "wallet_quota_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;