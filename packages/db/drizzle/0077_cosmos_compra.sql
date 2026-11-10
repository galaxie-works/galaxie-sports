CREATE TYPE "cosmos"."purchase_status" AS ENUM('pending', 'paid', 'failed', 'canceled', 'expired');--> statement-breakpoint
CREATE TABLE "cosmos"."package" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"name" text NOT NULL,
	"credits" numeric(14, 3) NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"market" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_credits_positive" CHECK ("cosmos"."package"."credits" > 0),
	CONSTRAINT "package_price_positive" CHECK ("cosmos"."package"."price_cents" > 0),
	CONSTRAINT "package_currency" CHECK ("cosmos"."package"."currency" in ('brl', 'usd')),
	CONSTRAINT "package_market_iso2" CHECK ("cosmos"."package"."market" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "cosmos"."purchase_intent" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"package_id" uuid,
	"credits" numeric(14, 3) NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "cosmos"."purchase_status" DEFAULT 'pending' NOT NULL,
	"user_id" text,
	"checkout_session_id" text,
	"payment_intent_id" text,
	"invoice_id" text,
	"ledger_id" uuid,
	"failure_reason" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_intent_checkout_session_id_unique" UNIQUE("checkout_session_id"),
	CONSTRAINT "purchase_intent_credits_positive" CHECK ("cosmos"."purchase_intent"."credits" > 0),
	CONSTRAINT "purchase_intent_amount_positive" CHECK ("cosmos"."purchase_intent"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "cosmos"."stripe_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"purchase_intent_id" uuid,
	"outcome" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cosmos"."purchase_intent" ADD CONSTRAINT "purchase_intent_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmos"."purchase_intent" ADD CONSTRAINT "purchase_intent_package_id_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "cosmos"."package"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "package_market_idx" ON "cosmos"."package" USING btree ("market","active");--> statement-breakpoint
CREATE INDEX "purchase_intent_tenant_idx" ON "cosmos"."purchase_intent" USING btree ("tenant_id","id" DESC NULLS LAST);