CREATE SCHEMA "chat";
--> statement-breakpoint
CREATE TABLE "chat"."message" (
	"tenant_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"body" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "message_visibility" CHECK (visibility in ('public', 'shadow', 'hidden')),
	CONSTRAINT "message_body_len" CHECK (length("chat"."message"."body") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "chat"."room" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"event_id" uuid NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"slow_mode_seconds" integer,
	"strictness" text,
	"state_by" text,
	"state_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "room_state" CHECK (state in ('open', 'frozen', 'read_only_peak')),
	CONSTRAINT "room_strictness" CHECK ("chat"."room"."strictness" is null or strictness in ('standard', 'strict')),
	CONSTRAINT "room_slow_mode" CHECK ("chat"."room"."slow_mode_seconds" is null or "chat"."room"."slow_mode_seconds" between 0 and 600)
);
--> statement-breakpoint
CREATE TABLE "chat"."tenant_config" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"open_before_minutes" integer,
	"close_after_minutes" integer,
	"slow_mode_seconds" integer,
	"strictness" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_config_open" CHECK ("chat"."tenant_config"."open_before_minutes" is null or "chat"."tenant_config"."open_before_minutes" between 0 and 1440),
	CONSTRAINT "tenant_config_close" CHECK ("chat"."tenant_config"."close_after_minutes" is null or "chat"."tenant_config"."close_after_minutes" between 0 and 1440),
	CONSTRAINT "tenant_config_slow" CHECK ("chat"."tenant_config"."slow_mode_seconds" is null or "chat"."tenant_config"."slow_mode_seconds" between 0 and 600),
	CONSTRAINT "tenant_config_strictness" CHECK ("chat"."tenant_config"."strictness" is null or strictness in ('standard', 'strict'))
);
--> statement-breakpoint
ALTER TABLE "chat"."message" ADD CONSTRAINT "message_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."message" ADD CONSTRAINT "message_room_fk" FOREIGN KEY ("tenant_id","room_id") REFERENCES "chat"."room"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."message" ADD CONSTRAINT "message_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."room" ADD CONSTRAINT "room_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."tenant_config" ADD CONSTRAINT "tenant_config_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_room_idx" ON "chat"."message" USING btree ("tenant_id","room_id","id");--> statement-breakpoint
CREATE INDEX "message_author_idx" ON "chat"."message" USING btree ("tenant_id","room_id","profile_id","created_at");--> statement-breakpoint
CREATE INDEX "message_purge_idx" ON "chat"."message" USING btree ("purge_at");--> statement-breakpoint
CREATE UNIQUE INDEX "room_event_uq" ON "chat"."room" USING btree ("tenant_id","event_id");