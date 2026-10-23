-- Acervo customizado de logos (assets:acervo + flag ASSETS_CUSTOM_LOGOS): origem por asset e o logo do
-- acervo ao lado do logo do fornecedor, sem substituí-lo. Idempotente: o banco de dev é compartilhado
-- entre worktrees.
DO $$ BEGIN
	CREATE TYPE "core"."asset_origin" AS ENUM('provider', 'acervo');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "core"."asset" ADD COLUMN IF NOT EXISTS "origin" "core"."asset_origin" DEFAULT 'provider' NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."asset" ADD COLUMN IF NOT EXISTS "acervo" text;--> statement-breakpoint
ALTER TABLE "core"."competition" ADD COLUMN IF NOT EXISTS "custom_logo_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."participant" ADD COLUMN IF NOT EXISTS "custom_logo_asset_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "core"."competition" ADD CONSTRAINT "competition_custom_logo_asset_id_asset_id_fk" FOREIGN KEY ("custom_logo_asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "core"."participant" ADD CONSTRAINT "participant_custom_logo_asset_id_asset_id_fk" FOREIGN KEY ("custom_logo_asset_id") REFERENCES "core"."asset"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
