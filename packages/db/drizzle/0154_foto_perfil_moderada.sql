-- Foto de perfil na moderação de imagem (#1025): só expansão, três colunas novas que nascem nulas. O CHECK só aceita
-- o que a versão anterior já grava (null), então ela continua funcionando.
ALTER TABLE "fan"."profile" ADD COLUMN "avatar_status" text;--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD COLUMN "avatar_ref" text;--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD COLUMN "avatar_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fan"."profile" ADD CONSTRAINT "profile_avatar_status" CHECK ("fan"."profile"."avatar_status" is null or "fan"."profile"."avatar_status" in ('pending', 'visible', 'held'));
