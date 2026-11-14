CREATE TABLE "fan"."age_verification" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_session_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"path" text,
	"result_band" text,
	"last_event_id" text,
	"decided_at" timestamp with time zone,
	"metered_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "age_verification_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "age_verification_provider" CHECK (provider in ('didit')),
	CONSTRAINT "age_verification_status" CHECK (status in ('pending', 'approved', 'declined', 'review', 'abandoned', 'expired')),
	CONSTRAINT "age_verification_path" CHECK (path is null or path in ('estimate', 'document')),
	CONSTRAINT "age_verification_result_band" CHECK (result_band is null or result_band in ('under13', '13', '14_15', '16_17', '18plus')),
	CONSTRAINT "age_verification_session_len" CHECK (length("fan"."age_verification"."provider_session_id") between 1 and 128),
	CONSTRAINT "age_verification_event_len" CHECK (last_event_id is null or length(last_event_id) between 1 and 128),
	CONSTRAINT "age_verification_decided" CHECK ((status = 'pending' and decided_at is null) or (status <> 'pending' and decided_at is not null)),
	CONSTRAINT "age_verification_approved_band" CHECK (status <> 'approved' or result_band is not null)
);
--> statement-breakpoint
ALTER TABLE "fan"."age_verification" ADD CONSTRAINT "age_verification_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fan"."age_verification" ADD CONSTRAINT "age_verification_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "age_verification_provider_session_uq" ON "fan"."age_verification" USING btree ("provider","provider_session_id");--> statement-breakpoint
CREATE INDEX "age_verification_profile_idx" ON "fan"."age_verification" USING btree ("tenant_id","profile_id","created_at");--> statement-breakpoint
CREATE INDEX "age_verification_purge_idx" ON "fan"."age_verification" USING btree ("decided_at") WHERE "fan"."age_verification"."purged_at" is null and "fan"."age_verification"."decided_at" is not null;