CREATE TABLE "cosmos"."credit_request" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_request_status" CHECK ("cosmos"."credit_request"."status" in ('open', 'approved', 'declined', 'canceled')),
	CONSTRAINT "credit_request_reason" CHECK (length(trim("cosmos"."credit_request"."reason")) between 5 and 500),
	CONSTRAINT "credit_request_decided" CHECK (("cosmos"."credit_request"."status" = 'open') = ("cosmos"."credit_request"."decided_at" is null))
);
--> statement-breakpoint
ALTER TABLE "cosmos"."credit_request" ADD CONSTRAINT "credit_request_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_request_open_uq" ON "cosmos"."credit_request" USING btree ("tenant_id","requested_by") WHERE "cosmos"."credit_request"."status" = 'open';--> statement-breakpoint
CREATE INDEX "credit_request_tenant_idx" ON "cosmos"."credit_request" USING btree ("tenant_id","id" DESC NULLS LAST);