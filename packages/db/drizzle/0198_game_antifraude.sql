CREATE TABLE "game"."profile_freeze" (
	"tenant_id" uuid NOT NULL,
	"program_country" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"signal_id" uuid,
	"frozen_by" text NOT NULL,
	"reason" text,
	"frozen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_freeze_pkey" PRIMARY KEY("tenant_id","program_country","profile_id"),
	CONSTRAINT "profile_freeze_reason_len" CHECK ("game"."profile_freeze"."reason" is null or length("game"."profile_freeze"."reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "game"."fraud_signal" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "game"."profile_freeze" ADD CONSTRAINT "profile_freeze_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."profile_freeze" ADD CONSTRAINT "profile_freeze_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."profile_freeze" ADD CONSTRAINT "profile_freeze_program_fk" FOREIGN KEY ("tenant_id","program_country") REFERENCES "game"."program"("tenant_id","program_country") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fraud_signal_dedupe_uq" ON "game"."fraud_signal" USING btree ("tenant_id","dedupe_key");