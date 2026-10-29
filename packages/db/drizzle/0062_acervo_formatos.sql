-- Acervo de logos: os formatos do mesmo escudo (SVG, PNG e WebP) ao lado do arquivo servido.
ALTER TABLE "core"."asset" ADD COLUMN IF NOT EXISTS "variants" jsonb;
