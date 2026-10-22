-- Textos livres por idioma (data/knowledge/i18n, docs/06 §3.3). Idempotente: o banco de dev é
-- compartilhado entre worktrees.
ALTER TABLE "semantic"."derby" ADD COLUMN IF NOT EXISTS "text_locale" text DEFAULT 'pt-BR' NOT NULL;--> statement-breakpoint
ALTER TABLE "semantic"."derby" ADD COLUMN IF NOT EXISTS "texts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "semantic"."team_profile" ADD COLUMN IF NOT EXISTS "text_locale" text DEFAULT 'pt-BR' NOT NULL;--> statement-breakpoint
ALTER TABLE "semantic"."team_profile" ADD COLUMN IF NOT EXISTS "texts" jsonb DEFAULT '{}'::jsonb NOT NULL;
