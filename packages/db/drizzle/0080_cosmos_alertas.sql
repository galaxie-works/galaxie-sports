CREATE TYPE "cosmos"."recharge_status" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "cosmos"."auto_recharge" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"package_id" uuid,
	"threshold_credits" numeric(14, 3) NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"stripe_customer_id" text,
	"last_failure_at" timestamp with time zone,
	"last_failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_recharge_threshold_positive" CHECK ("cosmos"."auto_recharge"."threshold_credits" > 0)
);
--> statement-breakpoint
CREATE TABLE "cosmos"."balance_alert" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"cycle_started_at" timestamp with time zone NOT NULL,
	"available" numeric(14, 3) NOT NULL,
	"cycle_base" numeric(14, 3) NOT NULL,
	"emailed_at" timestamp with time zone,
	"webhook_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_alert_level" CHECK ("cosmos"."balance_alert"."level" in (80, 90, 100))
);
--> statement-breakpoint
CREATE TABLE "cosmos"."recharge_attempt" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"package_id" uuid,
	"credits" numeric(14, 3) NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "cosmos"."recharge_status" DEFAULT 'pending' NOT NULL,
	"payment_intent_id" text,
	"stripe_customer_id" text,
	"payment_method_id" text,
	"ledger_id" uuid,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recharge_attempt_payment_intent_id_unique" UNIQUE("payment_intent_id")
);
--> statement-breakpoint
ALTER TABLE "cosmos"."wallet" ADD COLUMN "trial_remaining" numeric(14, 3) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cosmos"."wallet" ADD COLUMN "trial_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cosmos"."wallet" ADD COLUMN "cycle_base" numeric(14, 3) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cosmos"."wallet" ADD COLUMN "cycle_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cosmos"."wallet" ADD COLUMN "alert_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cosmos"."wallet" ADD COLUMN "block_reason" text;--> statement-breakpoint
ALTER TABLE "cosmos"."wallet" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cosmos"."auto_recharge" ADD CONSTRAINT "auto_recharge_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmos"."auto_recharge" ADD CONSTRAINT "auto_recharge_package_id_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "cosmos"."package"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmos"."balance_alert" ADD CONSTRAINT "balance_alert_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmos"."recharge_attempt" ADD CONSTRAINT "recharge_attempt_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmos"."recharge_attempt" ADD CONSTRAINT "recharge_attempt_package_id_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "cosmos"."package"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "balance_alert_once_per_cycle" ON "cosmos"."balance_alert" USING btree ("tenant_id","level","cycle_started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recharge_attempt_one_open" ON "cosmos"."recharge_attempt" USING btree ("tenant_id") WHERE "cosmos"."recharge_attempt"."status" in ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "wallet_trial_expiry_idx" ON "cosmos"."wallet" USING btree ("trial_expires_at") WHERE "cosmos"."wallet"."trial_remaining" > 0;--> statement-breakpoint
ALTER TABLE "cosmos"."wallet" ADD CONSTRAINT "wallet_trial_remaining_non_negative" CHECK ("cosmos"."wallet"."trial_remaining" >= 0);--> statement-breakpoint
ALTER TABLE "cosmos"."wallet" ADD CONSTRAINT "wallet_alert_level" CHECK ("cosmos"."wallet"."alert_level" in (0, 80, 90, 100));--> statement-breakpoint
-- carteiras criadas antes desta migration: o ciclo de alertas começa agora, com o saldo de hoje
UPDATE "cosmos"."wallet" SET "cycle_base" = "available", "cycle_started_at" = now() WHERE "cycle_started_at" IS NULL;--> statement-breakpoint
-- teste concedido antes desta migration: o que sobrar dele (até o saldo livre) vence 90 dias depois da concessão
UPDATE "cosmos"."wallet" AS w SET "trial_remaining" = LEAST(w."available", t."credits"), "trial_expires_at" = t."granted_at" + interval '90 days' FROM (SELECT "tenant_id", sum("credits") AS "credits", min("created_at") AS "granted_at" FROM "cosmos"."ledger" WHERE "kind" = 'trial' GROUP BY "tenant_id") AS t WHERE t."tenant_id" = w."tenant_id" AND w."trial_granted" AND w."trial_expires_at" IS NULL;