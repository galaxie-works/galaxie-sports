-- Códigos com mais de um país na api-sports: GB (Inglaterra, Escócia, País de Gales e Irlanda do Norte têm código
-- próprio, GB-ENG etc.) e UA (Crimeia). O nome do código é sempre o do país: "Reino Unido", nunca "Wales".
-- Só corrige a linha que já existe (país fora do catálogo não é criado); o catálogo grava o mesmo nome canônico
-- (canonicalCountryName). Idempotente.
UPDATE "core"."country"
   SET "name" = "name" || '{"en": "United Kingdom", "pt-BR": "Reino Unido", "es": "Reino Unido"}'::jsonb
 WHERE "code" = 'GB';--> statement-breakpoint
UPDATE "core"."country"
   SET "name" = "name" || '{"en": "Ukraine", "pt-BR": "Ucrânia", "es": "Ucrania"}'::jsonb
 WHERE "code" = 'UA';
