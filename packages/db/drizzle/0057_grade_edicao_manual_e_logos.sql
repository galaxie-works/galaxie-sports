CREATE TABLE "enrich"."logo_upload" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"previous_asset_id" uuid,
	"uploaded_by" text NOT NULL,
	"reverted_at" timestamp with time zone,
	"reverted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrich"."broadcaster" ADD COLUMN "custom_logo_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "enrich"."plan_channel" ADD COLUMN "manual_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "enrich"."plan_service" ADD COLUMN "manual_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "enrich"."platform" ADD COLUMN "custom_logo_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "enrich"."platform" ADD COLUMN "manual_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "enrich"."platform_addon" ADD COLUMN "manual_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "enrich"."platform_plan" ADD COLUMN "manual_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "enrich"."logo_upload" ADD CONSTRAINT "logo_upload_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."logo_upload" ADD CONSTRAINT "logo_upload_previous_asset_id_asset_id_fk" FOREIGN KEY ("previous_asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "logo_upload_target_idx" ON "enrich"."logo_upload" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
ALTER TABLE "enrich"."broadcaster" ADD CONSTRAINT "broadcaster_custom_logo_asset_id_asset_id_fk" FOREIGN KEY ("custom_logo_asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrich"."platform" ADD CONSTRAINT "platform_custom_logo_asset_id_asset_id_fk" FOREIGN KEY ("custom_logo_asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;