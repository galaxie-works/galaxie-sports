CREATE TABLE "community"."comment" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"post_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"body" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"moderated_by" text,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "comment_visibility" CHECK (visibility in ('public', 'shadow', 'hidden')),
	CONSTRAINT "comment_body_len" CHECK (length("community"."comment"."body") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "community"."post" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"community_id" uuid NOT NULL,
	"author" text NOT NULL,
	"profile_id" uuid,
	"staff_by" text,
	"body" text,
	"auto_kind" text,
	"data" jsonb,
	"attachment_type" text,
	"attachment_id" uuid,
	"photo_url" text,
	"visibility" text DEFAULT 'public' NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"pinned_at" timestamp with time zone,
	"pinned_by" text,
	"moderated_by" text,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "post_author" CHECK (author in ('system', 'staff', 'member')),
	CONSTRAINT "post_visibility" CHECK (visibility in ('public', 'shadow', 'hidden')),
	CONSTRAINT "post_attachment" CHECK (("community"."post"."attachment_type" is null and "community"."post"."attachment_id" is null) or ("community"."post"."attachment_id" is not null and attachment_type in ('event', 'participant', 'person'))),
	CONSTRAINT "post_member_profile" CHECK ("community"."post"."author" <> 'member' or "community"."post"."profile_id" is not null),
	CONSTRAINT "post_member_photo" CHECK ("community"."post"."author" = 'staff' or "community"."post"."photo_url" is null),
	CONSTRAINT "post_content" CHECK ("community"."post"."body" is not null or "community"."post"."auto_kind" is not null),
	CONSTRAINT "post_body_len" CHECK ("community"."post"."body" is null or length("community"."post"."body") between 1 and 5000)
);
--> statement-breakpoint
CREATE TABLE "community"."reaction" (
	"tenant_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" text DEFAULT 'like' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reaction_pkey" PRIMARY KEY("tenant_id","post_id","profile_id"),
	CONSTRAINT "reaction_kind" CHECK (kind in ('like'))
);
--> statement-breakpoint
ALTER TABLE "community"."comment" ADD CONSTRAINT "comment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."comment" ADD CONSTRAINT "comment_post_fk" FOREIGN KEY ("tenant_id","post_id") REFERENCES "community"."post"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."comment" ADD CONSTRAINT "comment_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."post" ADD CONSTRAINT "post_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."post" ADD CONSTRAINT "post_community_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "community"."community"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."post" ADD CONSTRAINT "post_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."reaction" ADD CONSTRAINT "reaction_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."reaction" ADD CONSTRAINT "reaction_post_fk" FOREIGN KEY ("tenant_id","post_id") REFERENCES "community"."post"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."reaction" ADD CONSTRAINT "reaction_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_post_idx" ON "community"."comment" USING btree ("tenant_id","post_id","id");--> statement-breakpoint
CREATE INDEX "comment_purge_idx" ON "community"."comment" USING btree ("purge_at");--> statement-breakpoint
CREATE INDEX "post_feed_idx" ON "community"."post" USING btree ("tenant_id","community_id","id");--> statement-breakpoint
CREATE INDEX "post_pinned_idx" ON "community"."post" USING btree ("tenant_id","community_id","pinned_at") WHERE "community"."post"."pinned_at" is not null;--> statement-breakpoint
CREATE INDEX "post_purge_idx" ON "community"."post" USING btree ("purge_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_auto_uq" ON "community"."post" USING btree ("tenant_id","community_id","auto_kind","attachment_id") WHERE "community"."post"."auto_kind" is not null;