-- Acervo oficial de logos: versão escura do logo e logos dos canais na biblioteca de emissoras.
-- Idempotente (IF NOT EXISTS): as colunas podem ter sido criadas à mão no banco de dev antes da migration.
ALTER TABLE "enrich"."broadcaster" ADD COLUMN IF NOT EXISTS "logo_dark_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "enrich"."broadcaster" ADD COLUMN IF NOT EXISTS "channel_logos" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "enrich"."broadcaster" ADD CONSTRAINT "broadcaster_logo_dark_asset_id_asset_id_fk" FOREIGN KEY ("logo_dark_asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
