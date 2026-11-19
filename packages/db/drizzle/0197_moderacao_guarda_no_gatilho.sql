-- Guarda legal no gatilho da auditoria (#1296, defesa em profundidade): a linha da auditoria de um caso sob guarda
-- (legal_hold_until no futuro) não é alterada nem apagada, nem pelo apagamento automático nem pela exclusão a pedido.
-- O resto da regra da 0095 fica igual (só inclusão; tenant apagado leva tudo junto).
CREATE OR REPLACE FUNCTION engage.moderation_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'engage.moderation_audit é só de inclusão' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM api.tenant WHERE id = OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  IF OLD.case_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM engage.moderation_case c
        WHERE c.tenant_id = OLD.tenant_id AND c.id = OLD.case_id AND c.legal_hold_until > now()) THEN
    RAISE EXCEPTION 'engage.moderation_audit: caso sob guarda legal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_setting('engage.moderation_purge', true) = 'on' AND OLD.purge_at <= now() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'engage.moderation_audit é só de inclusão' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- UPDATE: só tirar o conteúdo, sem mexer em mais nada
  IF NEW.content IS NULL AND OLD.content IS NOT NULL
     AND (to_jsonb(NEW) - 'content' - 'content_purge_at') = (to_jsonb(OLD) - 'content' - 'content_purge_at')
     AND (current_setting('engage.moderation_erasure', true) = 'on'
          OR (current_setting('engage.moderation_purge', true) = 'on' AND OLD.content_purge_at <= now())) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'engage.moderation_audit é só de inclusão' USING ERRCODE = 'insufficient_privilege';
END;
$$;
