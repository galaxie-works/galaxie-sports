CREATE TABLE "api"."tenant_member" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text,
	"profile_id" uuid,
	"role" text NOT NULL,
	"scope" jsonb,
	"invited_by" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_member_one_identity" CHECK (("api"."tenant_member"."user_id" is null) <> ("api"."tenant_member"."profile_id" is null)),
	CONSTRAINT "tenant_member_role" CHECK ("api"."tenant_member"."role" in ('owner', 'admin', 'senior_moderator', 'moderator', 'volunteer')),
	CONSTRAINT "tenant_member_volunteer_is_profile" CHECK ("api"."tenant_member"."role" <> 'volunteer' or "api"."tenant_member"."profile_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "api"."tenant_member_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"from_role" text,
	"to_role" text,
	"subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api"."tenant_member" ADD CONSTRAINT "tenant_member_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."tenant_member_event" ADD CONSTRAINT "tenant_member_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_member_user_uq" ON "api"."tenant_member" USING btree ("tenant_id","user_id") WHERE "api"."tenant_member"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_member_profile_uq" ON "api"."tenant_member" USING btree ("tenant_id","profile_id") WHERE "api"."tenant_member"."profile_id" is not null;--> statement-breakpoint
CREATE INDEX "tenant_member_user_idx" ON "api"."tenant_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tenant_member_event_tenant_idx" ON "api"."tenant_member_event" USING btree ("tenant_id","created_at");