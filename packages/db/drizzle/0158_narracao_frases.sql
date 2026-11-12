CREATE TABLE "ops"."narration_template" (
	"key" text NOT NULL,
	"lang" text NOT NULL,
	"variants" text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "narration_template_key_lang_pk" PRIMARY KEY("key","lang")
);
--> statement-breakpoint
CREATE TABLE "ops"."narration_template_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"lang" text NOT NULL,
	"action" text NOT NULL,
	"old_variants" text[],
	"new_variants" text[],
	"changed_by" text NOT NULL,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "narration_template_log_changed_idx" ON "ops"."narration_template_log" USING btree ("changed_at");