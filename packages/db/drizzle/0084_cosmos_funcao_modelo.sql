ALTER TABLE "cosmos"."function_def" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "cosmos"."function_def" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "cosmos"."function_def" ADD CONSTRAINT "function_def_provider" CHECK ("cosmos"."function_def"."provider" is null or "cosmos"."function_def"."provider" in ('anthropic', 'openai', 'gemini', 'deepseek'));--> statement-breakpoint
ALTER TABLE "cosmos"."function_def" ADD CONSTRAINT "function_def_model_needs_provider" CHECK ("cosmos"."function_def"."model" is null or "cosmos"."function_def"."provider" is not null);