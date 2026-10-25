CREATE TABLE "ops"."change_feed_prune" (
	"name" text PRIMARY KEY NOT NULL,
	"max_deleted_id" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
