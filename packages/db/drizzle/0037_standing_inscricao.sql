-- Idempotente: era a 0034 (renumerada: depende da 0035 do #260 e da 0036 do #261).
ALTER TABLE "core"."standing" ADD COLUMN IF NOT EXISTS "entry" jsonb;
