-- enrich.event_context: rejeitar um texto que já estava no ar também purga o cache. O trigger da 0008 saía sem
-- publicar quando review_status virava 'rejected', e o texto rejeitado ficava até 1 h no cache (e na CDN).
-- A rejeição publica no tópico interno `event_context.rejected` (só purga: não vai para SSE nem webhooks),
-- com a mesma entidade e as mesmas tags da publicação. Inserir uma linha já rejeitada, ou mexer numa que já
-- estava rejeitada, segue sem publicar (nunca foi servida). O resto da função é o mesmo da 0008.
CREATE OR REPLACE FUNCTION ops.capture_context_published() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  e record;
BEGIN
  IF NEW.review_status = 'rejected' THEN
    IF TG_OP = 'UPDATE' AND OLD.review_status IS DISTINCT FROM 'rejected' THEN
      PERFORM ops.publish_change('event_context.rejected', 'event_context', NEW.event_id::text, jsonb_build_object(
        'event_id', NEW.event_id,
        'data', jsonb_build_object('contexts', jsonb_build_array(
          jsonb_build_object('locale', NEW.locale, 'kind', NEW.kind, 'review_status', NEW.review_status))),
        'tags', jsonb_build_array('event:' || NEW.event_id::text)));
    END IF;
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.content IS NOT DISTINCT FROM OLD.content
     AND NEW.review_status IS NOT DISTINCT FROM OLD.review_status THEN
    RETURN NULL;
  END IF;
  SELECT id, sport, competition_id INTO e FROM core.event WHERE id = NEW.event_id;
  PERFORM ops.publish_change('event.context_published', 'event_context', NEW.event_id::text, jsonb_build_object(
    'event_id', NEW.event_id, 'sport', e.sport, 'competition_id', e.competition_id,
    'changed', '["context"]'::jsonb,
    'data', jsonb_build_object('contexts', jsonb_build_array(
      jsonb_build_object('locale', NEW.locale, 'kind', NEW.kind, 'review_status', NEW.review_status))),
    'tags', jsonb_build_array('event:' || NEW.event_id::text)));
  RETURN NULL;
END
$$;
