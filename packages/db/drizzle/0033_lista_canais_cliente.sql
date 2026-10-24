CREATE TABLE "api"."tenant_channel_list" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"default_country" text,
	"markets" text[] NOT NULL,
	"channels" jsonb NOT NULL,
	"proposed" jsonb NOT NULL,
	"overrides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed" jsonb,
	"status" text DEFAULT 'review' NOT NULL,
	"ai_status" text DEFAULT 'not_needed' NOT NULL,
	"ai_note" text,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" text,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api"."tenant_channel_list" ADD CONSTRAINT "tenant_channel_list_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;