-- O aviso de vídeos relacionados deixa de levar ids de vídeo (docs/12 §2.1): a poda do feed mantém a última linha
-- de cada jogo sem prazo, e os ids passariam dos 30 dias da política do YouTube. Idempotente.
UPDATE "ops"."change_feed"
   SET "payload" = "payload" - 'data'
 WHERE "topic" = 'event.related_content_changed'
   AND "payload" ? 'data';
