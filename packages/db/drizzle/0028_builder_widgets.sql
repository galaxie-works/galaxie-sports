CREATE TABLE "ops"."publishable_key" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"allowed_origins" text[] NOT NULL,
	"widget_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ops"."widget" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ops"."publishable_key" ADD CONSTRAINT "publishable_key_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."publishable_key" ADD CONSTRAINT "publishable_key_widget_id_widget_id_fk" FOREIGN KEY ("widget_id") REFERENCES "ops"."widget"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."widget" ADD CONSTRAINT "widget_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "publishable_key_hash_uq" ON "ops"."publishable_key" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "publishable_key_tenant_idx" ON "ops"."publishable_key" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "widget_tenant_idx" ON "ops"."widget" USING btree ("tenant_id","archived_at");