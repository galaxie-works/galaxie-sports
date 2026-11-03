ALTER TABLE "ops"."job_request" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "ops"."job_request" ADD COLUMN "params" jsonb;--> statement-breakpoint
ALTER TABLE "ops"."job_request" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."job_request" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."job_request" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "ops"."job_request" ADD COLUMN "checkpoint" jsonb;--> statement-breakpoint
ALTER TABLE "ops"."job_request" ADD COLUMN "locked_by" text;--> statement-breakpoint
ALTER TABLE "ops"."job_request" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."job_request" ADD COLUMN "run_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops"."job_request" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "ops"."job_request" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "ops"."job_run" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "ops"."job_run" ADD COLUMN "resumed_from" uuid;--> statement-breakpoint
CREATE INDEX "job_request_queue_idx" ON "ops"."job_request" USING btree ("priority" DESC NULLS LAST,"run_after") WHERE "ops"."job_request"."status" = 'pending' and "ops"."job_request"."type" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "job_request_dedupe_idx" ON "ops"."job_request" USING btree ("type","dedupe_key") WHERE "ops"."job_request"."dedupe_key" is not null and "ops"."job_request"."status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "job_run_request_idx" ON "ops"."job_run" USING btree ("request_id","started_at") WHERE "ops"."job_run"."request_id" is not null;