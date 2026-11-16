CREATE TABLE "engage"."moderation_note" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author" text NOT NULL,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_note_body_len" CHECK (length("engage"."moderation_note"."body") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "chat"."room" ADD COLUMN "pinned_message_id" uuid;--> statement-breakpoint
ALTER TABLE "chat"."room" ADD COLUMN "pinned_by" text;--> statement-breakpoint
ALTER TABLE "chat"."room" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat"."room" ADD COLUMN "shield" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "engage"."moderation_note" ADD CONSTRAINT "moderation_note_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engage"."moderation_note" ADD CONSTRAINT "moderation_note_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_note_profile_idx" ON "engage"."moderation_note" USING btree ("tenant_id","profile_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_note_purge_idx" ON "engage"."moderation_note" USING btree ("purge_at");
