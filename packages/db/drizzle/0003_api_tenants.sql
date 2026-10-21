CREATE SCHEMA "api";
--> statement-breakpoint
CREATE TYPE "api"."tenant_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "api"."api_key" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"label" text,
	"scopes" text[],
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api"."backfill_request" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'api-sports' NOT NULL,
	"sport" text NOT NULL,
	"endpoint" text NOT NULL,
	"params" jsonb NOT NULL,
	"request_hash" text NOT NULL,
	"priority" text DEFAULT 'ADHOC' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"tenant_id" uuid,
	"first_requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api"."tenant" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"plan" text NOT NULL,
	"modules" text[] NOT NULL,
	"markets" text[] DEFAULT '{}' NOT NULL,
	"sports" text[] DEFAULT '{}' NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 120 NOT NULL,
	"status" "api"."tenant_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "api"."api_key" ADD CONSTRAINT "api_key_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."backfill_request" ADD CONSTRAINT "backfill_request_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_prefix_uq" ON "api"."api_key" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "api_key_tenant_idx" ON "api"."api_key" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "backfill_request_hash_uq" ON "api"."backfill_request" USING btree ("request_hash");--> statement-breakpoint
CREATE INDEX "backfill_request_status_idx" ON "api"."backfill_request" USING btree ("status","last_requested_at");