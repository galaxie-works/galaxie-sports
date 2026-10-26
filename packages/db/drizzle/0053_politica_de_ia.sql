ALTER TABLE "ops"."llm_usage" ADD COLUMN "budget_day" date;--> statement-breakpoint
ALTER TABLE "ops"."llm_usage" ADD COLUMN "band" text;--> statement-breakpoint
CREATE INDEX "llm_usage_budget_day_band_idx" ON "ops"."llm_usage" USING btree (coalesce("budget_day", "day_utc"),"band");