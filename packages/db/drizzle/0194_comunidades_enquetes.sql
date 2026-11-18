CREATE TABLE "community"."poll" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"scope" text NOT NULL,
	"community_id" uuid,
	"event_id" uuid,
	"kind" text DEFAULT 'free' NOT NULL,
	"question" text,
	"created_by" text NOT NULL,
	"closes_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "poll_scope" CHECK (scope in ('community', 'room')),
	CONSTRAINT "poll_kind" CHECK (kind in ('free', 'man_of_match')),
	CONSTRAINT "poll_scope_target" CHECK (("community"."poll"."scope" = 'community' and "community"."poll"."community_id" is not null) or ("community"."poll"."scope" = 'room' and "community"."poll"."community_id" is null and "community"."poll"."event_id" is not null)),
	CONSTRAINT "poll_mom_event" CHECK ("community"."poll"."kind" <> 'man_of_match' or "community"."poll"."event_id" is not null),
	CONSTRAINT "poll_question" CHECK ("community"."poll"."kind" = 'man_of_match' or "community"."poll"."question" is not null),
	CONSTRAINT "poll_question_len" CHECK ("community"."poll"."question" is null or length("community"."poll"."question") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "community"."poll_option" (
	"tenant_id" uuid NOT NULL,
	"poll_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"position" integer NOT NULL,
	"label" text,
	"person_id" uuid,
	"participant_id" uuid,
	CONSTRAINT "poll_option_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "poll_option_content" CHECK ("community"."poll_option"."label" is not null or "community"."poll_option"."person_id" is not null),
	CONSTRAINT "poll_option_label_len" CHECK ("community"."poll_option"."label" is null or length("community"."poll_option"."label") between 1 and 120),
	CONSTRAINT "poll_option_position" CHECK ("community"."poll_option"."position" between 0 and 59)
);
--> statement-breakpoint
CREATE TABLE "community"."poll_vote" (
	"tenant_id" uuid NOT NULL,
	"poll_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_vote_pkey" PRIMARY KEY("tenant_id","poll_id","profile_id")
);
--> statement-breakpoint
ALTER TABLE "community"."poll" ADD CONSTRAINT "poll_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."poll" ADD CONSTRAINT "poll_community_fk" FOREIGN KEY ("tenant_id","community_id") REFERENCES "community"."community"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."poll_option" ADD CONSTRAINT "poll_option_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."poll_option" ADD CONSTRAINT "poll_option_poll_fk" FOREIGN KEY ("tenant_id","poll_id") REFERENCES "community"."poll"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."poll_vote" ADD CONSTRAINT "poll_vote_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."poll_vote" ADD CONSTRAINT "poll_vote_poll_fk" FOREIGN KEY ("tenant_id","poll_id") REFERENCES "community"."poll"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."poll_vote" ADD CONSTRAINT "poll_vote_option_fk" FOREIGN KEY ("tenant_id","option_id") REFERENCES "community"."poll_option"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community"."poll_vote" ADD CONSTRAINT "poll_vote_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poll_community_idx" ON "community"."poll" USING btree ("tenant_id","community_id","id");--> statement-breakpoint
CREATE INDEX "poll_event_idx" ON "community"."poll" USING btree ("tenant_id","event_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_mom_room_uq" ON "community"."poll" USING btree ("tenant_id","event_id") WHERE "community"."poll"."kind" = 'man_of_match' and "community"."poll"."scope" = 'room';--> statement-breakpoint
CREATE UNIQUE INDEX "poll_mom_community_uq" ON "community"."poll" USING btree ("tenant_id","community_id","event_id") WHERE "community"."poll"."kind" = 'man_of_match' and "community"."poll"."scope" = 'community';--> statement-breakpoint
CREATE UNIQUE INDEX "poll_option_position_uq" ON "community"."poll_option" USING btree ("tenant_id","poll_id","position");--> statement-breakpoint
CREATE INDEX "poll_vote_option_idx" ON "community"."poll_vote" USING btree ("tenant_id","poll_id","option_id");--> statement-breakpoint
CREATE INDEX "poll_vote_created_idx" ON "community"."poll_vote" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "participation_daily_ref_idx" ON "game"."participation_daily" USING btree ("tenant_id","profile_id","action","ref");