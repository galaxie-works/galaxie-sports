-- Perfil do jogador: os times em que a pessoa aparece nos lances. Idempotente: o banco de dev é
-- compartilhado entre worktrees.
CREATE INDEX IF NOT EXISTS "event_incident_person_idx" ON "core"."event_incident" USING btree ("person_id");
