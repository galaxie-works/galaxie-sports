CREATE TABLE "ops"."widget_theme" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"theme" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops"."widget_theme" ADD CONSTRAINT "widget_theme_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "widget_theme_tenant_name_uq" ON "ops"."widget_theme" USING btree ("tenant_id","name");