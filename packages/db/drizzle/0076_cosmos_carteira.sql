CREATE SCHEMA "cosmos";
--> statement-breakpoint
CREATE TYPE "cosmos"."ledger_kind" AS ENUM('trial', 'trial_expiry', 'purchase', 'usage', 'refund', 'adjustment', 'quota_change');--> statement-breakpoint
CREATE TYPE "cosmos"."reservation_status" AS ENUM('open', 'settled', 'released', 'expired');--> statement-breakpoint
CREATE TYPE "cosmos"."wallet_status" AS ENUM('active', 'blocked');--> statement-breakpoint
CREATE TABLE "cosmos"."function_def" (
	"name" text PRIMARY KEY NOT NULL,
	"min_credits" numeric(14, 3) NOT NULL,
	"permission" text NOT NULL,
	"screen" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "function_def_min_positive" CHECK ("cosmos"."function_def"."min_credits" > 0)
);
--> statement-breakpoint
CREATE TABLE "cosmos"."ledger" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "cosmos"."ledger_kind" NOT NULL,
	"credits" numeric(14, 3) NOT NULL,
	"balance_before" numeric(14, 3) NOT NULL,
	"balance_after" numeric(14, 3) NOT NULL,
	"function_name" text,
	"scope" text,
	"user_id" text,
	"reservation_id" uuid,
	"tokens_in" integer,
	"tokens_cached" integer,
	"tokens_out" integer,
	"cost_usd" numeric(14, 6),
	"model" text,
	"note" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_balance_matches" CHECK ("cosmos"."ledger"."balance_after" - "cosmos"."ledger"."balance_before" = "cosmos"."ledger"."credits"),
	CONSTRAINT "ledger_balance_non_negative" CHECK ("cosmos"."ledger"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cosmos"."reservation" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"function_name" text NOT NULL,
	"credits" numeric(14, 3) NOT NULL,
	"scope" text,
	"user_id" text,
	"credit_usd" numeric(18, 10),
	"multiplier" numeric(8, 3) NOT NULL,
	"min_credits" numeric(14, 3) NOT NULL,
	"status" "cosmos"."reservation_status" DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"charged_credits" numeric(14, 3),
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_credits_positive" CHECK ("cosmos"."reservation"."credits" > 0)
);
--> statement-breakpoint
CREATE TABLE "cosmos"."wallet" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"available" numeric(14, 3) DEFAULT 0 NOT NULL,
	"reserved" numeric(14, 3) DEFAULT 0 NOT NULL,
	"received_total" numeric(14, 3) DEFAULT 0 NOT NULL,
	"status" "cosmos"."wallet_status" DEFAULT 'active' NOT NULL,
	"trial_granted" boolean DEFAULT false NOT NULL,
	"multiplier" numeric(8, 3) DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_available_non_negative" CHECK ("cosmos"."wallet"."available" >= 0),
	CONSTRAINT "wallet_reserved_non_negative" CHECK ("cosmos"."wallet"."reserved" >= 0),
	CONSTRAINT "wallet_multiplier_positive" CHECK ("cosmos"."wallet"."multiplier" > 0)
);
--> statement-breakpoint
ALTER TABLE "cosmos"."ledger" ADD CONSTRAINT "ledger_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmos"."reservation" ADD CONSTRAINT "reservation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmos"."wallet" ADD CONSTRAINT "wallet_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_tenant_id_idx" ON "cosmos"."ledger" USING btree ("tenant_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ledger_tenant_function_idx" ON "cosmos"."ledger" USING btree ("tenant_id","function_name","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ledger_tenant_scope_idx" ON "cosmos"."ledger" USING btree ("tenant_id","scope","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ledger_usage_day_idx" ON "cosmos"."ledger" USING btree ("created_at") WHERE "cosmos"."ledger"."kind" = 'usage';--> statement-breakpoint
CREATE INDEX "reservation_open_idx" ON "cosmos"."reservation" USING btree ("expires_at") WHERE "cosmos"."reservation"."status" = 'open';--> statement-breakpoint
CREATE INDEX "reservation_tenant_idx" ON "cosmos"."reservation" USING btree ("tenant_id","id" DESC NULLS LAST);