-- Códigos com mais de um país na api-sports: GB (Inglaterra, Escócia, País de Gales e Irlanda do Norte têm código
-- próprio, GB-ENG etc.) e UA (Crimeia). O nome do código é sempre o do país: "Reino Unido", nunca "Wales".
-- Idempotente; o catálogo grava o mesmo nome canônico (canonicalCountryName).
INSERT INTO "core"."country" ("code", "name")
VALUES
  ('GB', '{"en": "United Kingdom", "pt-BR": "Reino Unido", "es": "Reino Unido"}'::jsonb),
  ('UA', '{"en": "Ukraine", "pt-BR": "Ucrânia", "es": "Ucrania"}'::jsonb)
ON CONFLICT ("code") DO UPDATE SET "name" = "core"."country"."name" || excluded."name";
