CREATE SCHEMA "fan";
--> statement-breakpoint
CREATE TABLE "fan"."account" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"external_account_id" text NOT NULL,
	"holder_adult" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "account_holder_adult" CHECK ("fan"."account"."holder_adult" in ('yes', 'no', 'unknown')),
	CONSTRAINT "account_external_len" CHECK (length("fan"."account"."external_account_id") between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "fan"."erasure_log" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"erased_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erasure_log_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "fan"."profile" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"account_id" uuid NOT NULL,
	"external_profile_id" text,
	"nickname" text,
	"avatar_url" text,
	"age_band" text NOT NULL,
	"country" text NOT NULL,
	"locale" text NOT NULL,
	"favorite_team_id" uuid,
	"visibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "profile_age_band" CHECK ("fan"."profile"."age_band" in ('under13', '13_17', '18plus')),
	CONSTRAINT "profile_country" CHECK ("fan"."profile"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "profile_erased" CHECK (("fan"."profile"."deleted_at" is null and "fan"."profile"."external_profile_id" is not null) or ("fan"."profile"."deleted_at" is not null and "fan"."profile"."external_profile_id" is null and "fan"."profile"."nickname" is null and "fan"."profile"."avatar_url" is null))
);
--> statement-breakpoint
ALTER TABLE "fan"."account" ADD CONSTRAINT "account_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fan"."erasure_log" ADD CONSTRAINT "erasure_log_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD CONSTRAINT "profile_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD CONSTRAINT "profile_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "fan"."account"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_external_uq" ON "fan"."account" USING btree ("tenant_id","external_account_id");--> statement-breakpoint
CREATE INDEX "erasure_log_profile_idx" ON "fan"."erasure_log" USING btree ("tenant_id","profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_external_uq" ON "fan"."profile" USING btree ("tenant_id","account_id","external_profile_id") WHERE "fan"."profile"."external_profile_id" is not null;--> statement-breakpoint
CREATE INDEX "profile_account_idx" ON "fan"."profile" USING btree ("tenant_id","account_id");