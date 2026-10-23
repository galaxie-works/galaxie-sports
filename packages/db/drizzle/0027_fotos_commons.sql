-- Acervo de fotos de licença livre da Wikimedia Commons (assets:commons): foto de carro, origem `commons`,
-- crédito por imagem, fotos por participante e o vínculo do perfil semântico da F1 ao F1DB. Idempotente: o
-- banco de dev é compartilhado entre worktrees.
ALTER TYPE "core"."asset_kind" ADD VALUE IF NOT EXISTS 'car' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "core"."asset_origin" ADD VALUE IF NOT EXISTS 'commons';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."asset_credit" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"page_url" text NOT NULL,
	"author" text,
	"author_url" text,
	"license" text NOT NULL,
	"license_url" text,
	"credit" text,
	"attribution_required" boolean DEFAULT true NOT NULL,
	"share_alike" boolean DEFAULT false NOT NULL,
	"date_taken" text,
	"original_width" integer,
	"original_height" integer,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "core"."participant_photo" (
	"participant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"role" text NOT NULL,
	"season_year" smallint,
	"rank" smallint DEFAULT 0 NOT NULL,
	"selected_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_photo_participant_id_asset_id_role_pk" PRIMARY KEY("participant_id","asset_id","role")
);
--> statement-breakpoint
ALTER TABLE "semantic"."team_profile" ADD COLUMN IF NOT EXISTS "f1db_id" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "core"."asset_credit" ADD CONSTRAINT "asset_credit_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "core"."asset"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "core"."participant_photo" ADD CONSTRAINT "participant_photo_participant_id_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "core"."participant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "core"."participant_photo" ADD CONSTRAINT "participant_photo_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "core"."asset"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "participant_photo_role_idx" ON "core"."participant_photo" USING btree ("participant_id","role","season_year");
