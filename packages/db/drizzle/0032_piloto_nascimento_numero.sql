-- Idempotente: a base de dev já tinha estas colunas de quando a migration era a 0030/0031 (renumerada no merge).
ALTER TABLE "core"."participant" ADD COLUMN IF NOT EXISTS "birth_date" date;--> statement-breakpoint
ALTER TABLE "core"."participant" ADD COLUMN IF NOT EXISTS "birth_place" text;--> statement-breakpoint
ALTER TABLE "core"."participant" ADD COLUMN IF NOT EXISTS "birth_country_code" text;--> statement-breakpoint
ALTER TABLE "core"."participant" ADD COLUMN IF NOT EXISTS "number" smallint;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'participant_birth_country_code_country_code_fk') THEN
    ALTER TABLE "core"."participant" ADD CONSTRAINT "participant_birth_country_code_country_code_fk" FOREIGN KEY ("birth_country_code") REFERENCES "core"."country"("code") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
