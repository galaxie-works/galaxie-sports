CREATE SCHEMA "billing";
--> statement-breakpoint
CREATE TABLE "billing"."catalog_version" (
	"version" text PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."price" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"item_kind" text NOT NULL,
	"item_key" text NOT NULL,
	"tier_value" integer,
	"market" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"interval" text NOT NULL,
	"starting_at" boolean DEFAULT true NOT NULL,
	"stripe_price_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"catalog_version" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_item_kind" CHECK ("billing"."price"."item_kind" in ('plan', 'module', 'tier', 'addon', 'capacity')),
	CONSTRAINT "price_interval" CHECK ("billing"."price"."interval" in ('month', 'year', 'one_time', 'metered')),
	CONSTRAINT "price_currency" CHECK ("billing"."price"."currency" in ('usd', 'brl')),
	CONSTRAINT "price_market_iso2" CHECK ("billing"."price"."market" ~ '^[A-Z]{2}$'),
	CONSTRAINT "price_amount_nonnegative" CHECK ("billing"."price"."amount_minor" >= 0),
	CONSTRAINT "price_tier_value" CHECK (("billing"."price"."item_kind" = 'tier') = ("billing"."price"."tier_value" is not null))
);
--> statement-breakpoint
CREATE TABLE "billing"."tenant_override" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"value" integer,
	"reason" text NOT NULL,
	"granted_by" text NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_override_kind" CHECK ("billing"."tenant_override"."kind" in ('module_grant', 'module_revoke', 'tier', 'addon', 'feature_grant')),
	CONSTRAINT "tenant_override_value" CHECK (("billing"."tenant_override"."kind" in ('tier', 'addon')) = ("billing"."tenant_override"."value" is not null) and ("billing"."tenant_override"."value" is null or "billing"."tenant_override"."value" >= 0)),
	CONSTRAINT "tenant_override_reason" CHECK (length(trim("billing"."tenant_override"."reason")) > 0),
	CONSTRAINT "tenant_override_revoked" CHECK (("billing"."tenant_override"."revoked_at" is null) = ("billing"."tenant_override"."revoked_by" is null))
);
--> statement-breakpoint
ALTER TABLE "api"."tenant" ADD COLUMN "catalog_version" text;--> statement-breakpoint
ALTER TABLE "api"."tenant" ADD COLUMN "capacity_tier" text;--> statement-breakpoint
ALTER TABLE "billing"."price" ADD CONSTRAINT "price_catalog_version_catalog_version_version_fk" FOREIGN KEY ("catalog_version") REFERENCES "billing"."catalog_version"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."tenant_override" ADD CONSTRAINT "tenant_override_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "price_active_uq" ON "billing"."price" USING btree ("item_kind","item_key",coalesce("tier_value", -1),"market","currency","interval") WHERE "billing"."price"."active";--> statement-breakpoint
CREATE INDEX "price_item_idx" ON "billing"."price" USING btree ("item_kind","item_key");--> statement-breakpoint
CREATE INDEX "tenant_override_tenant_idx" ON "billing"."tenant_override" USING btree ("tenant_id","valid_until");