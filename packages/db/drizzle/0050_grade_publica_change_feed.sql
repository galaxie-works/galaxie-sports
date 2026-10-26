-- Grade de canais e ofertas (enrich.platform, platform_plan, plan_channel, plan_service, platform_addon): toda
-- escrita publica `lineup` com a entidade `platform:<id>` no ops.change_feed, para o purge das respostas de
-- /v1/platforms e do onde assistir (tags `platform` e `platform:<id>`, TTL de até 24 h). Antes nenhum writer
-- da grade publicava (aprovar, rejeitar, aceitar pedido, pesquisa, logos), e a API seguia servindo a grade
-- velha até o TTL. Trigger em vez de publishChange nos writers: cobre todos (pacote db, demo, ingestor).
-- O tópico é interno (só purga; não vai para SSE nem webhooks). Várias linhas da mesma plataforma na mesma
-- transação viram uma linha só no feed (ops.publish_change deduplica). UPDATE que só mexe em colunas de controle
-- (não servidas pela API: revisita da pesquisa, mudança proposta, fontes, páginas de planos) não publica, como
-- o `last_verified_at` do broadcast_option: sem isso, a revisita diária esvaziaria o cache do onde assistir
-- inteiro (a tag de coleção `platform`) sem nada novo para servir.
CREATE OR REPLACE FUNCTION ops.capture_lineup_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r jsonb;
  v_rows jsonb[] := '{}';
  v_platform text;
  v_seen text[] := '{}';
  v_control text[] := ARRAY['seen_at', 'updated_at', 'proposed_change', 'sources', 'reviewed_by', 'reviewed_at',
    'verification', 'plan_pages', 'plan_pages_hash', 'plan_pages_extracted_at'];
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_rows := v_rows || to_jsonb(NEW); END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_rows := v_rows || to_jsonb(OLD); END IF;
  IF TG_OP = 'UPDATE' AND (v_rows[1] - v_control) = (v_rows[2] - v_control) THEN RETURN NULL; END IF;
  -- a versão nova e a antiga: um plano movido de plataforma purga as duas
  FOREACH r IN ARRAY v_rows LOOP
    v_platform := CASE TG_TABLE_NAME
      WHEN 'platform' THEN r->>'id'
      WHEN 'platform_plan' THEN r->>'platform_id'
      WHEN 'platform_addon' THEN r->>'platform_id'
      -- plan_channel e plan_service: a plataforma do plano (na cascata do DELETE o plano já saiu, e o
      -- trigger do próprio plano já publicou)
      ELSE (SELECT pp.platform_id::text FROM enrich.platform_plan pp WHERE pp.id = (r->>'plan_id')::uuid)
    END;
    IF v_platform IS NOT NULL AND NOT (v_platform = ANY (v_seen)) THEN
      v_seen := v_seen || v_platform;
      PERFORM ops.publish_change('lineup', 'platform', v_platform, jsonb_build_object(
        'changed', jsonb_build_array(TG_TABLE_NAME)));
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER platform_capture_change
AFTER INSERT OR UPDATE OR DELETE ON enrich.platform
FOR EACH ROW EXECUTE FUNCTION ops.capture_lineup_change();--> statement-breakpoint
CREATE TRIGGER platform_plan_capture_change
AFTER INSERT OR UPDATE OR DELETE ON enrich.platform_plan
FOR EACH ROW EXECUTE FUNCTION ops.capture_lineup_change();--> statement-breakpoint
CREATE TRIGGER plan_channel_capture_change
AFTER INSERT OR UPDATE OR DELETE ON enrich.plan_channel
FOR EACH ROW EXECUTE FUNCTION ops.capture_lineup_change();--> statement-breakpoint
CREATE TRIGGER plan_service_capture_change
AFTER INSERT OR UPDATE OR DELETE ON enrich.plan_service
FOR EACH ROW EXECUTE FUNCTION ops.capture_lineup_change();--> statement-breakpoint
CREATE TRIGGER platform_addon_capture_change
AFTER INSERT OR UPDATE OR DELETE ON enrich.platform_addon
FOR EACH ROW EXECUTE FUNCTION ops.capture_lineup_change();
