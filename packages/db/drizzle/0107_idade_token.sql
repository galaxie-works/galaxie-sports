ALTER TABLE "fan"."profile" ADD COLUMN "age_band_detail" text;--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD COLUMN "age_assurance" text DEFAULT 'self' NOT NULL;--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD COLUMN "age_assurance_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD COLUMN "age_assurance_provider" text;--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD COLUMN "guardian_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD COLUMN "guardian_consent_id" text;--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD COLUMN "guardian_linked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD COLUMN "age_frozen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD CONSTRAINT "profile_age_band_detail" CHECK ("fan"."profile"."age_band_detail" is null or "fan"."profile"."age_band_detail" in ('under13', '13', '14_15', '16_17', '18plus'));--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD CONSTRAINT "profile_age_assurance" CHECK ("fan"."profile"."age_assurance" in ('self', 'estimated', 'verified'));--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD CONSTRAINT "profile_age_assurance_provider" CHECK ("fan"."profile"."age_assurance_provider" is null or length("fan"."profile"."age_assurance_provider") between 1 and 64);--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD CONSTRAINT "profile_guardian_status" CHECK ("fan"."profile"."guardian_status" in ('none', 'pending', 'granted', 'revoked'));--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD CONSTRAINT "profile_guardian_consent" CHECK ("fan"."profile"."guardian_consent_id" is null or length("fan"."profile"."guardian_consent_id") between 1 and 128);