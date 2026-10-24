CREATE TABLE "enrich"."plan_channel" (
	"plan_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"access" text NOT NULL,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_change" jsonb,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_channel_plan_id_channel_id_pk" PRIMARY KEY("plan_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "enrich"."plan_service" (
	"plan_id" uuid NOT NULL,
	"service_id" text NOT NULL,
	"access" text NOT NULL,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_change" jsonb,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_service_plan_id_service_id_pk" PRIMARY KEY("plan_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "enrich"."platform" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"country" text NOT NULL,
	"website" text,
	"logo_asset_id" uuid,
	"broadcaster_id" text,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_change" jsonb,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrich"."platform_plan" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"platform_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"price_text" text,
	"url" text,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_change" jsonb,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."lineup_review_request" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"message" text NOT NULL,
	"proposed" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "api"."tenant" ADD COLUMN "operator_platform_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."tenant" ADD COLUMN "show_other_operators" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."tenant" ADD COLUMN "operator_email_domains" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "enrich"."plan_channel" ADD CONSTRAINT "plan_channel_plan_id_platform_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "enrich"."platform_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."plan_channel" ADD CONSTRAINT "plan_channel_channel_id_broadcaster_id_fk" FOREIGN KEY ("channel_id") REFERENCES "enrich"."broadcaster"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."plan_service" ADD CONSTRAINT "plan_service_plan_id_platform_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "enrich"."platform_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."plan_service" ADD CONSTRAINT "plan_service_service_id_broadcaster_id_fk" FOREIGN KEY ("service_id") REFERENCES "enrich"."broadcaster"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."platform" ADD CONSTRAINT "platform_logo_asset_id_asset_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."platform" ADD CONSTRAINT "platform_broadcaster_id_broadcaster_id_fk" FOREIGN KEY ("broadcaster_id") REFERENCES "enrich"."broadcaster"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."platform_plan" ADD CONSTRAINT "platform_plan_platform_id_platform_id_fk" FOREIGN KEY ("platform_id") REFERENCES "enrich"."platform"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lineup_review_request" ADD CONSTRAINT "lineup_review_request_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_channel_channel_idx" ON "enrich"."plan_channel" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "plan_service_service_idx" ON "enrich"."plan_service" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_slug_uq" ON "enrich"."platform" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "platform_country_idx" ON "enrich"."platform" USING btree ("country","kind");--> statement-breakpoint
CREATE INDEX "platform_broadcaster_idx" ON "enrich"."platform" USING btree ("broadcaster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_plan_slug_uq" ON "enrich"."platform_plan" USING btree ("platform_id","slug");--> statement-breakpoint
CREATE INDEX "platform_plan_country_idx" ON "enrich"."platform_plan" USING btree ("country");--> statement-breakpoint
CREATE INDEX "platform_plan_seen_idx" ON "enrich"."platform_plan" USING btree ("seen_at");--> statement-breakpoint
CREATE INDEX "lineup_review_request_tenant_idx" ON "ops"."lineup_review_request" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "lineup_review_request_status_idx" ON "ops"."lineup_review_request" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "lineup_review_request_target_idx" ON "ops"."lineup_review_request" USING btree ("target_type","target_id");--> statement-breakpoint
ALTER TABLE "api"."tenant" ADD CONSTRAINT "tenant_operator_platform_id_platform_id_fk" FOREIGN KEY ("operator_platform_id") REFERENCES "enrich"."platform"("id") ON DELETE set null ON UPDATE no action;