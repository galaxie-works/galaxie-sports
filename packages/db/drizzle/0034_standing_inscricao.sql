-- Idempotente: pode ser renumerada no merge (outras frentes também abriram a 0034).
ALTER TABLE "core"."standing" ADD COLUMN IF NOT EXISTS "entry" jsonb;
