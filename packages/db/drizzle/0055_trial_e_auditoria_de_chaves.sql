CREATE TABLE "api"."api_key_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key_kind" text NOT NULL,
	"key_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api"."tenant" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api"."api_key_event" ADD CONSTRAINT "api_key_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_event_tenant_idx" ON "api"."api_key_event" USING btree ("tenant_id","created_at");