CREATE TABLE "api"."webhook_cursor" (
	"name" text PRIMARY KEY NOT NULL,
	"last_change_id" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api"."webhook_delivery" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"change_id" bigint NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"response_code" integer,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api"."webhook_endpoint" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"topics" text[] DEFAULT '{}' NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api"."webhook_delivery" ADD CONSTRAINT "webhook_delivery_endpoint_id_webhook_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "api"."webhook_endpoint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_endpoint_change_uq" ON "api"."webhook_delivery" USING btree ("endpoint_id","change_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_due_idx" ON "api"."webhook_delivery" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_tenant_idx" ON "api"."webhook_endpoint" USING btree ("tenant_id","active");--> statement-breakpoint
-- ─── Captura de mudanças (docs/05 §5) ──────────────────────────────────────────────────────────
-- SQL escrito à mão: funções e triggers que levam toda mudança relevante ao ops.change_feed
-- (+ NOTIFY ops_change_feed), sem depender de cada writer lembrar de chamar publishChange().

-- União de dois arrays JSON preservando a ordem de primeira ocorrência (sem repetição).
CREATE OR REPLACE FUNCTION ops.jsonb_array_union(a jsonb, b jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_agg(u.e ORDER BY u.ord), '[]'::jsonb)
  FROM (
    SELECT s.e, min(s.ord) AS ord
    FROM (
      SELECT x.e, x.ord FROM jsonb_array_elements(coalesce(a, '[]'::jsonb)) WITH ORDINALITY AS x(e, ord)
      UNION ALL
      SELECT y.e, y.ord + 1000000000 FROM jsonb_array_elements(coalesce(b, '[]'::jsonb)) WITH ORDINALITY AS y(e, ord)
    ) s
    GROUP BY s.e
  ) u
$$;--> statement-breakpoint
-- Funde dois payloads da mesma mudança (mesma transação): valores novos prevalecem; `changed`,
-- `tags` e listas dentro de `data` acumulam; `previous` fica com o estado anterior à transação.
CREATE OR REPLACE FUNCTION ops.merge_change_payload(a jsonb, b jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  r jsonb;
  d jsonb;
  k text;
BEGIN
  IF a IS NULL OR jsonb_typeof(a) <> 'object' THEN RETURN b; END IF;
  IF b IS NULL OR jsonb_typeof(b) <> 'object' THEN RETURN a; END IF;
  r := a || b;
  FOREACH k IN ARRAY ARRAY['changed', 'tags'] LOOP
    IF jsonb_typeof(a -> k) = 'array' AND jsonb_typeof(b -> k) = 'array' THEN
      r := jsonb_set(r, ARRAY[k], ops.jsonb_array_union(a -> k, b -> k));
    END IF;
  END LOOP;
  IF a ? 'previous' THEN r := jsonb_set(r, '{previous}', a -> 'previous'); END IF;
  IF jsonb_typeof(a -> 'data') = 'object' AND jsonb_typeof(b -> 'data') = 'object' THEN
    d := (a -> 'data') || (b -> 'data');
    FOR k IN SELECT jsonb_object_keys(b -> 'data') LOOP
      IF jsonb_typeof(a -> 'data' -> k) = 'array' AND jsonb_typeof(b -> 'data' -> k) = 'array' THEN
        d := jsonb_set(d, ARRAY[k], ops.jsonb_array_union(a -> 'data' -> k, b -> 'data' -> k));
      END IF;
    END LOOP;
    r := jsonb_set(r, '{data}', d);
  END IF;
  RETURN r;
END
$$;--> statement-breakpoint
-- Ponto único de publicação (triggers e publishChange()). Deduplica dentro da transação:
-- created_at = now() é o instante de início da transação, então a mesma (tópico, entidade) publicada
-- duas vezes na mesma transação vira uma única linha com os payloads fundidos. O NOTIFY só é
-- entregue no commit, e NOTIFYs idênticos na mesma transação são colapsados pelo Postgres.
CREATE OR REPLACE FUNCTION ops.publish_change(p_topic text, p_entity_type text, p_entity_id text, p_payload jsonb DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_id bigint;
BEGIN
  SELECT id INTO v_id FROM ops.change_feed
   WHERE created_at = now() AND topic = p_topic AND entity_type = p_entity_type AND entity_id = p_entity_id
   ORDER BY id DESC LIMIT 1
   FOR UPDATE;
  IF v_id IS NULL THEN
    INSERT INTO ops.change_feed (topic, entity_type, entity_id, payload, created_at)
    VALUES (p_topic, p_entity_type, p_entity_id, p_payload, now())
    RETURNING id INTO v_id;
  ELSE
    UPDATE ops.change_feed SET payload = ops.merge_change_payload(payload, p_payload) WHERE id = v_id;
  END IF;
  PERFORM pg_notify('ops_change_feed', v_id::text);
  RETURN v_id;
END
$$;--> statement-breakpoint
-- core.event: estado (status/detalhe/relógio) → event.status_changed; placar → event.score_changed.
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
      'data', jsonb_build_object('score', NEW.score)));
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER event_capture_change
AFTER UPDATE OF status, status_detail, clock, score ON core.event
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.status_detail IS DISTINCT FROM NEW.status_detail
      OR OLD.clock IS DISTINCT FROM NEW.clock OR OLD.score IS DISTINCT FROM NEW.score)
EXECUTE FUNCTION ops.capture_event_change();--> statement-breakpoint
-- core.event_incident: lance novo → event.incident_added. Lances de eventos que começaram há mais
-- de 2 dias (bootstrap, reprocessamento histórico) não viram notificação.
CREATE OR REPLACE FUNCTION ops.capture_incident_added() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  e record;
BEGIN
  SELECT id, sport, competition_id, starts_at INTO e FROM core.event WHERE id = NEW.event_id;
  IF e.id IS NULL OR e.starts_at < now() - interval '2 days' THEN RETURN NULL; END IF;
  PERFORM ops.publish_change('event.incident_added', 'event', NEW.event_id::text, jsonb_build_object(
    'event_id', e.id, 'sport', e.sport, 'competition_id', e.competition_id,
    'changed', '["incidents"]'::jsonb,
    'data', jsonb_build_object('incidents', jsonb_build_array(jsonb_build_object(
      'id', NEW.id, 'sequence', NEW.sequence, 'minute', NEW.minute, 'extra', NEW.extra,
      'type', NEW.type, 'detail', NEW.detail, 'participant_id', NEW.participant_id,
      'person_id', NEW.person_id)))));
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER event_incident_capture_insert
AFTER INSERT ON core.event_incident
FOR EACH ROW EXECUTE FUNCTION ops.capture_incident_added();--> statement-breakpoint
-- enrich.broadcast_option: inclusão, correção ou remoção → where_to_watch.changed (entidade
-- `where_to_watch:<event_id>`, purga também `event:<event_id>`). Só reverificar (last_verified_at) não notifica.
CREATE OR REPLACE FUNCTION ops.capture_broadcast_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_event uuid;
  v_country text;
  e record;
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'last_verified_at') = (to_jsonb(OLD) - 'last_verified_at') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_event := OLD.event_id; v_country := OLD.country_code;
  ELSE
    v_event := NEW.event_id; v_country := NEW.country_code;
  END IF;
  SELECT id, sport, competition_id INTO e FROM core.event WHERE id = v_event;
  PERFORM ops.publish_change('where_to_watch.changed', 'where_to_watch', v_event::text, jsonb_build_object(
    'event_id', v_event, 'sport', e.sport, 'competition_id', e.competition_id,
    'changed', '["where_to_watch"]'::jsonb,
    'data', jsonb_build_object('countries', jsonb_build_array(v_country)),
    'tags', jsonb_build_array('event:' || v_event::text)));
  IF TG_OP = 'UPDATE' AND OLD.event_id IS DISTINCT FROM NEW.event_id THEN
    PERFORM ops.publish_change('where_to_watch.changed', 'where_to_watch', OLD.event_id::text, jsonb_build_object(
      'event_id', OLD.event_id, 'sport', e.sport, 'competition_id', e.competition_id,
      'changed', '["where_to_watch"]'::jsonb,
      'data', jsonb_build_object('countries', jsonb_build_array(OLD.country_code)),
      'tags', jsonb_build_array('event:' || OLD.event_id::text)));
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER broadcast_option_capture_change
AFTER INSERT OR UPDATE OR DELETE ON enrich.broadcast_option
FOR EACH ROW EXECUTE FUNCTION ops.capture_broadcast_change();--> statement-breakpoint
-- enrich.event_context: cenário/resumo publicado (ou revisado) → event.context_published.
CREATE OR REPLACE FUNCTION ops.capture_context_published() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  e record;
BEGIN
  IF NEW.review_status = 'rejected' THEN RETURN NULL; END IF;
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
$$;--> statement-breakpoint
CREATE TRIGGER event_context_capture_published
AFTER INSERT OR UPDATE ON enrich.event_context
FOR EACH ROW EXECUTE FUNCTION ops.capture_context_published();