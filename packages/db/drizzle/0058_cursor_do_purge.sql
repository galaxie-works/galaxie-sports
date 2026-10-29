CREATE TABLE "api"."change_feed_cursor" (
	"name" text PRIMARY KEY NOT NULL,
	"last_change_id" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
