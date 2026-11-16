CREATE SCHEMA "community";
--> statement-breakpoint
CREATE TABLE "community"."acceptance" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acceptance_pkey" PRIMARY KEY("tenant_id","community_id","profile_id","version")
);
--> statement-breakpoint
CREATE TABLE "community"."community" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"anchor_type" text NOT NULL,
	"anchor_id" text NOT NULL,
	"join_mode" text DEFAULT 'open' NOT NULL,
	"member_posts" boolean DEFAULT true NOT NULL,
	"chat_enabled" boolean DEFAULT false NOT NULL,
	"history_days" integer,
	"state" text DEFAULT 'active' NOT NULL,
	"state_by" text,
	"state_at" timestamp with time zone,
	"terms_version" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "community_anchor_type" CHECK (anchor_type in ('sport', 'competition', 'participant', 'person')),
	CONSTRAINT "community_anchor_id_len" CHECK (length("community"."community"."anchor_id") between 1 and 80),
	CONSTRAINT "community_join_mode" CHECK (join_mode in ('open', 'approval', 'closed')),
	CONSTRAINT "community_state" CHECK (state in ('active', 'archived', 'suspended')),
	CONSTRAINT "community_history_days" CHECK ("community"."community"."history_days" is null or "community"."community"."history_days" between 1 and 730),
	CONSTRAINT "community_terms_version" CHECK ("community"."community"."terms_version" is null or "community"."community"."terms_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "community"."invite" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"community_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invite_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "invite_code_hash" CHECK ("community"."invite"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "invite_max_uses" CHECK ("community"."invite"."max_uses" is null or "community"."invite"."max_uses" between 1 and 100000),
	CONSTRAINT "invite_uses" CHECK ("community"."invite"."uses" >= 0 and ("community"."invite"."max_uses" is null or "community"."invite"."uses" <= "community"."invite"."max_uses"))
);
--> statement-breakpoint
CREATE TABLE "community"."join_request" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"community_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	CONSTRAINT "join_request_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "join_request_state" CHECK (state in ('pending', 'approved', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "community"."membership" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"removed_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_pkey" PRIMARY KEY("tenant_id","community_id","profile_id"),
	CONSTRAINT "membership_state" CHECK (state in ('active', 'left', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "community"."scope_rule" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" text,
	CONSTRAINT "scope_rule_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "scope_rule_kind" CHECK (kind in ('sport', 'competition', 'competition_participants', 'participant', 'person')),
	CONSTRAINT "scope_rule_target_len" CHECK (length("community"."scope_rule"."target") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "community"."terms_version" (
	"tenant_id" uuid NOT NULL,
	"community_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" jsonb NOT NULL,
	"published_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_version_pkey" PRIMARY KEY("tenant_id","community_id","version"),
	CONSTRAINT "terms_version_positive" CHECK ("community"."terms_version"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "community"."acceptance" ADD CONSTRAINT "acceptance_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."acceptance" ADD CONSTRAINT "acceptance_terms_fk" FOREIGN KEY ("tenant_id","community_id","version") REFERENCES "community"."terms_version"("tenant_id","community_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."acceptance" ADD CONSTRAINT "acceptance_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."community" ADD CONSTRAINT "community_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."invite" ADD CONSTRAINT "invite_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."invite" ADD CONSTRAINT "invite_community_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "community"."community"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."join_request" ADD CONSTRAINT "join_request_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."join_request" ADD CONSTRAINT "join_request_community_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "community"."community"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."join_request" ADD CONSTRAINT "join_request_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."membership" ADD CONSTRAINT "membership_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."membership" ADD CONSTRAINT "membership_community_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "community"."community"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."membership" ADD CONSTRAINT "membership_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."scope_rule" ADD CONSTRAINT "scope_rule_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."terms_version" ADD CONSTRAINT "terms_version_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."terms_version" ADD CONSTRAINT "terms_version_community_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "community"."community"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_anchor_uq" ON "community"."community" USING btree ("tenant_id","anchor_type","anchor_id");--> statement-breakpoint
CREATE INDEX "community_state_idx" ON "community"."community" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "invite_code_uq" ON "community"."invite" USING btree ("tenant_id","code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "join_request_pending_uq" ON "community"."join_request" USING btree ("tenant_id","community_id","profile_id") WHERE "community"."join_request"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "join_request_queue_idx" ON "community"."join_request" USING btree ("tenant_id","community_id","state","created_at");--> statement-breakpoint
CREATE INDEX "membership_profile_idx" ON "community"."membership" USING btree ("tenant_id","profile_id","state");--> statement-breakpoint
CREATE INDEX "membership_community_idx" ON "community"."membership" USING btree ("tenant_id","community_id","state","joined_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scope_rule_active_uq" ON "community"."scope_rule" USING btree ("tenant_id","kind","target") WHERE "community"."scope_rule"."removed_at" is null;