-- Gamificação (#904): jogo assistido = presença verificada em pelo menos 2/3 do jogo (decisão de 16/11). A Conquista
-- "Fiel" passa a contar e ganha a descrição nova. Só muda a linha do Catálogo da Galaxie; nada do torcedor.
UPDATE "game"."catalog_achievement"
   SET "active" = true,
       "inactive_reason" = NULL,
       "description" = '{"pt":"Acompanhe ao vivo pelo menos 2/3 de um jogo.","es":"Sigue en vivo al menos 2/3 de un partido.","en":"Watch at least 2/3 of a match live."}'::jsonb,
       "updated_at" = now()
 WHERE "id" = 'loyalty.watched';
