ALTER TABLE "engage"."moderation_case" ADD COLUMN "child_safety" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "engage"."moderation_case" ADD COLUMN "legal_hold_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "engage"."moderation_case" ADD COLUMN "authority_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "engage"."moderation_case" ADD COLUMN "authority_reported_by" text;--> statement-breakpoint
ALTER TABLE "engage"."moderation_case" ADD COLUMN "authority_reference" text;--> statement-breakpoint
ALTER TABLE "chat"."message" ADD COLUMN "legal_hold_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "engage"."moderation_case" ADD CONSTRAINT "moderation_case_authority_ref" CHECK ("engage"."moderation_case"."authority_reference" is null or length("engage"."moderation_case"."authority_reference") between 1 and 200);--> statement-breakpoint
ALTER TABLE "engage"."moderation_case" ADD CONSTRAINT "moderation_case_authority_report" CHECK (("engage"."moderation_case"."authority_reported_at" is null) = ("engage"."moderation_case"."authority_reported_by" is null));
