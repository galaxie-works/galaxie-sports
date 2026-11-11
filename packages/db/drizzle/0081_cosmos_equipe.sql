CREATE TABLE "cosmos"."staff_action" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_action_reason" CHECK (length(trim("cosmos"."staff_action"."reason")) >= 5)
);
--> statement-breakpoint
ALTER TABLE "cosmos"."staff_action" ADD CONSTRAINT "staff_action_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_action_tenant_idx" ON "cosmos"."staff_action" USING btree ("tenant_id","id" DESC NULLS LAST);