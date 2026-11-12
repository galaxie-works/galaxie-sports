-- #640: sinal explícito de gol anulado no SSE e nos webhooks. Recria as funções de captura da 0008:
-- * core.event_incident: `event.incident_added` leva `data.goal_cancelled = true` quando o lance novo é um VAR de
--   gol anulado (`Goal cancelled`, `Goal Disallowed - ...`), do fornecedor ou inferido pela Galaxie depois de o gol
--   ficar fora da timeline (packages/core-writer/src/retracted-goals.ts). Só o lance confirma a anulação: o placar do
--   fornecedor oscila sozinho (resposta velha, gol que volta), e uma queda de placar não basta para mandar desfazer.
-- * core.event: `event.score_changed` passa a levar `previous.score`, para o cliente comparar sem guardar estado.
-- Só acrescenta campos ao payload (contrato aditivo); os triggers continuam os mesmos.
CREATE OR REPLACE FUNCTION ops.capture_event_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  base jsonb := jsonb_build_object('event_id', NEW.id, 'sport', NEW.sport, 'competition_id', NEW.competition_id);
  changed text[] := '{}';
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN changed := changed || 'status'::text; END IF;
  IF NEW.status_detail IS DISTINCT FROM OLD.status_detail THEN changed := changed || 'status_detail'::text; END IF;
  IF NEW.clock IS DISTINCT FROM OLD.clock THEN changed := changed || 'clock'::text; END IF;
  IF cardinality(changed) > 0 THEN
    PERFORM ops.publish_change('event.status_changed', 'event', NEW.id::text, base || jsonb_build_object(
      'changed', to_jsonb(changed),
      'data', jsonb_build_object('status', NEW.status, 'status_detail', NEW.status_detail, 'clock', NEW.clock),
      'previous', jsonb_build_object('status', OLD.status)));
  END IF;
  IF NEW.score IS DISTINCT FROM OLD.score THEN
    PERFORM ops.publish_change('event.score_changed', 'event', NEW.id::text, base || jsonb_build_object(
      'changed', '["score"]'::jsonb,
      'data', jsonb_build_object('score', NEW.score),
      'previous', jsonb_build_object('score', OLD.score)));
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION ops.capture_incident_added() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  e record;
  inc_data jsonb;
BEGIN
  SELECT id, sport, competition_id, starts_at INTO e FROM core.event WHERE id = NEW.event_id;
  IF e.id IS NULL OR e.starts_at < now() - interval '2 days' THEN RETURN NULL; END IF;
  inc_data := jsonb_build_object('incidents', jsonb_build_array(jsonb_build_object(
    'id', NEW.id, 'sequence', NEW.sequence, 'minute', NEW.minute, 'extra', NEW.extra,
    'type', NEW.type, 'detail', NEW.detail, 'participant_id', NEW.participant_id,
    'person_id', NEW.person_id)));
  IF lower(NEW.type) = 'var' AND btrim(coalesce(NEW.detail, '')) ~* '^goal (cancel+ed|disallowed)\y' THEN
    inc_data := inc_data || jsonb_build_object('goal_cancelled', true);
  END IF;
  PERFORM ops.publish_change('event.incident_added', 'event', NEW.event_id::text, jsonb_build_object(
    'event_id', e.id, 'sport', e.sport, 'competition_id', e.competition_id,
    'changed', '["incidents"]'::jsonb,
    'data', inc_data));
  RETURN NULL;
END
$$;
