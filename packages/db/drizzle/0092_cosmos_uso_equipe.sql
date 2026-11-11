CREATE TABLE "cosmos"."staff_usage" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"route" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_usage_outcome" CHECK ("cosmos"."staff_usage"."outcome" in ('ok', 'error', 'pending'))
);
--> statement-breakpoint
ALTER TABLE "cosmos"."staff_usage" ADD CONSTRAINT "staff_usage_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_usage_user_idx" ON "cosmos"."staff_usage" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "staff_usage_tenant_idx" ON "cosmos"."staff_usage" USING btree ("tenant_id","id" DESC NULLS LAST);