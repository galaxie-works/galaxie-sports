CREATE TABLE "chat"."guidelines_acceptance" (
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guidelines_acceptance_pkey" PRIMARY KEY("tenant_id","profile_id"),
	CONSTRAINT "guidelines_acceptance_version" CHECK ("chat"."guidelines_acceptance"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "chat"."guidelines_acceptance" ADD CONSTRAINT "guidelines_acceptance_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."guidelines_acceptance" ADD CONSTRAINT "guidelines_acceptance_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
