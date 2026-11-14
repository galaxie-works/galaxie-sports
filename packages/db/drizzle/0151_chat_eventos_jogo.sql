CREATE TABLE "chat"."game_message" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"event_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_message_kind" CHECK (kind in ('kickoff', 'goal', 'red_card', 'var', 'half_time', 'full_time'))
);
--> statement-breakpoint
ALTER TABLE "chat"."tenant_config" ADD COLUMN "event_kinds" text[];--> statement-breakpoint
CREATE UNIQUE INDEX "game_message_source_uq" ON "chat"."game_message" USING btree ("event_id","source_key");--> statement-breakpoint
CREATE INDEX "game_message_event_idx" ON "chat"."game_message" USING btree ("event_id","id");