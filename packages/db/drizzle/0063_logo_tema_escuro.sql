-- Logo para o tema escuro enviado no painel (canal, streaming ou plataforma), ao lado do logo claro.
ALTER TABLE "enrich"."broadcaster" ADD COLUMN IF NOT EXISTS "custom_logo_dark_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "enrich"."platform" ADD COLUMN IF NOT EXISTS "custom_logo_dark_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "enrich"."logo_upload" ADD COLUMN IF NOT EXISTS "variant" text DEFAULT 'light' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "enrich"."broadcaster" ADD CONSTRAINT "broadcaster_custom_logo_dark_asset_id_asset_id_fk" FOREIGN KEY ("custom_logo_dark_asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "enrich"."platform" ADD CONSTRAINT "platform_custom_logo_dark_asset_id_asset_id_fk" FOREIGN KEY ("custom_logo_dark_asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
