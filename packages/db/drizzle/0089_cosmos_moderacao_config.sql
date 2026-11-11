CREATE TABLE "cosmos"."moderation_config" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text DEFAULT '' NOT NULL,
	"config" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_config_scope_kind" CHECK ("cosmos"."moderation_config"."scope_kind" in ('tenant', 'room', 'community')),
	CONSTRAINT "moderation_config_scope_id" CHECK (("cosmos"."moderation_config"."scope_kind" = 'tenant') = ("cosmos"."moderation_config"."scope_id" = ''))
);
--> statement-breakpoint
CREATE TABLE "cosmos"."moderation_config_log" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text DEFAULT '' NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb,
	"changed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cosmos"."moderation_config" ADD CONSTRAINT "moderation_config_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmos"."moderation_config_log" ADD CONSTRAINT "moderation_config_log_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_config_scope_uq" ON "cosmos"."moderation_config" USING btree ("tenant_id","scope_kind","scope_id");--> statement-breakpoint
CREATE INDEX "moderation_config_log_scope_idx" ON "cosmos"."moderation_config_log" USING btree ("tenant_id","scope_kind","scope_id","id" DESC NULLS LAST);