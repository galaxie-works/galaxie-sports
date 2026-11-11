CREATE TABLE "api"."tenant_role_permission" (
	"tenant_id" uuid NOT NULL,
	"role" text NOT NULL,
	"action" text NOT NULL,
	"allowed" boolean NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_role_permission_tenant_id_role_action_pk" PRIMARY KEY("tenant_id","role","action"),
	CONSTRAINT "tenant_role_permission_role" CHECK ("api"."tenant_role_permission"."role" in ('admin', 'senior_moderator', 'moderator', 'volunteer'))
);
--> statement-breakpoint
ALTER TABLE "api"."tenant_member_event" ALTER COLUMN "member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."tenant_role_permission" ADD CONSTRAINT "tenant_role_permission_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;