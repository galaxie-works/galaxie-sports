-- Fila única da moderação (#953, B8): casos, denúncias, bloqueio entre torcedores, a Escada, apelações e o
-- registro de auditoria imutável. Só expansão. Os índices únicos (tenant_id, id) vêm antes das FKs compostas.
CREATE TABLE "engage"."fan_block" (
	"tenant_id" uuid NOT NULL,
	"blocker_profile_id" uuid NOT NULL,
	"blocked_profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fan_block_pkey" PRIMARY KEY("tenant_id","blocker_profile_id","blocked_profile_id"),
	CONSTRAINT "fan_block_self" CHECK ("engage"."fan_block"."blocker_profile_id" <> "engage"."fan_block"."blocked_profile_id")
);
--> statement-breakpoint
CREATE TABLE "engage"."moderation_appeal" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sanction_id" uuid NOT NULL,
	"stage" smallint NOT NULL,
	"statement" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"route" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"case_id" uuid,
	"decided_by" text,
	"decided_by_kind" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_appeal_stage" CHECK ("engage"."moderation_appeal"."stage" in (1, 2)),
	CONSTRAINT "moderation_appeal_status" CHECK ("engage"."moderation_appeal"."status" in ('pending', 'upheld', 'overturned')),
	CONSTRAINT "moderation_appeal_route" CHECK ("engage"."moderation_appeal"."route" in ('team', 'galaxie')),
	CONSTRAINT "moderation_appeal_second_person" CHECK ("engage"."moderation_appeal"."stage" = 1 or "engage"."moderation_appeal"."decided_by_kind" is distinct from 'cosmos'),
	CONSTRAINT "moderation_appeal_statement" CHECK ("engage"."moderation_appeal"."statement" is null or length("engage"."moderation_appeal"."statement") <= 1000),
	CONSTRAINT "moderation_appeal_decided" CHECK (("engage"."moderation_appeal"."status" = 'pending') = ("engage"."moderation_appeal"."decided_at" is null) and ("engage"."moderation_appeal"."status" = 'pending') = ("engage"."moderation_appeal"."decided_by" is null))
);
--> statement-breakpoint
CREATE TABLE "engage"."moderation_audit" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"actor_kind" text NOT NULL,
	"action" text NOT NULL,
	"subject_profile_id" uuid,
	"case_id" uuid,
	"sanction_id" uuid,
	"appeal_id" uuid,
	"reason" text,
	"rules" jsonb,
	"content" text,
	"content_purge_at" timestamp with time zone,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_audit_actor_kind" CHECK ("engage"."moderation_audit"."actor_kind" in ('person', 'cosmos', 'galaxie', 'system', 'fan')),
	CONSTRAINT "moderation_audit_action" CHECK (length("engage"."moderation_audit"."action") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "engage"."moderation_case" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"target_profile_id" uuid,
	"module" text NOT NULL,
	"room" text,
	"community" text,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"severity" integer NOT NULL,
	"report_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"hidden_at" timestamp with time zone,
	"content" text,
	"content_purge_at" timestamp with time zone,
	"detail" jsonb,
	"sanction_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"purge_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_case_source" CHECK ("engage"."moderation_case"."source" in ('report', 'filter', 'cosmos', 'appeal')),
	CONSTRAINT "moderation_case_target" CHECK ("engage"."moderation_case"."target_type" in ('message', 'comment', 'post', 'profile', 'community_name', 'league_name', 'behavior')),
	CONSTRAINT "moderation_case_module" CHECK ("engage"."moderation_case"."module" in ('chat', 'communities', 'gamification', 'shopping', 'profile')),
	CONSTRAINT "moderation_case_status" CHECK ("engage"."moderation_case"."status" in ('open', 'resolved', 'dismissed')),
	CONSTRAINT "moderation_case_target_id" CHECK (length("engage"."moderation_case"."target_id") between 1 and 200),
	CONSTRAINT "moderation_case_content" CHECK ("engage"."moderation_case"."content" is null or length("engage"."moderation_case"."content") <= 10000),
	CONSTRAINT "moderation_case_appeal" CHECK (("engage"."moderation_case"."source" = 'appeal') = ("engage"."moderation_case"."sanction_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "engage"."moderation_report" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"reporter_profile_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_report_reason" CHECK ("engage"."moderation_report"."reason" in ('hate', 'harassment', 'threat', 'sexual', 'spam', 'betting', 'personal_data', 'other')),
	CONSTRAINT "moderation_report_note" CHECK ("engage"."moderation_report"."note" is null or length("engage"."moderation_report"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "engage"."moderation_sanction" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"account_id" uuid,
	"level" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text,
	"reason" text NOT NULL,
	"case_id" uuid,
	"decided_by" text NOT NULL,
	"decided_by_kind" text NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"purge_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_sanction_level" CHECK ("engage"."moderation_sanction"."level" in ('warning', 'mute', 'suspension', 'expulsion', 'ban')),
	CONSTRAINT "moderation_sanction_scope" CHECK ("engage"."moderation_sanction"."scope" in ('place', 'community', 'tenant')),
	CONSTRAINT "moderation_sanction_decider" CHECK ("engage"."moderation_sanction"."decided_by_kind" in ('person', 'cosmos', 'galaxie', 'system')),
	CONSTRAINT "moderation_sanction_hidden" CHECK (not "engage"."moderation_sanction"."hidden" or ("engage"."moderation_sanction"."level" = 'mute' and "engage"."moderation_sanction"."ends_at" is not null)),
	CONSTRAINT "moderation_sanction_hidden_person" CHECK (not "engage"."moderation_sanction"."hidden" or "engage"."moderation_sanction"."decided_by_kind" = 'person'),
	CONSTRAINT "moderation_sanction_reason" CHECK (length("engage"."moderation_sanction"."reason") between 1 and 500),
	CONSTRAINT "moderation_sanction_dates" CHECK ("engage"."moderation_sanction"."ends_at" is null or "engage"."moderation_sanction"."ends_at" > "engage"."moderation_sanction"."starts_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_appeal_stage_uq" ON "engage"."moderation_appeal" USING btree ("tenant_id","sanction_id","stage");
--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_case_tenant_id_uq" ON "engage"."moderation_case" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_case_open_target_uq" ON "engage"."moderation_case" USING btree ("tenant_id","target_type","target_id") WHERE "engage"."moderation_case"."status" = 'open' and "engage"."moderation_case"."source" <> 'appeal';
--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_report_once_uq" ON "engage"."moderation_report" USING btree ("tenant_id","case_id","reporter_profile_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_sanction_tenant_id_uq" ON "engage"."moderation_sanction" USING btree ("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "engage"."fan_block" ADD CONSTRAINT "fan_block_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."fan_block" ADD CONSTRAINT "fan_block_blocker_fk" FOREIGN KEY ("tenant_id","blocker_profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."fan_block" ADD CONSTRAINT "fan_block_blocked_fk" FOREIGN KEY ("tenant_id","blocked_profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."moderation_appeal" ADD CONSTRAINT "moderation_appeal_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."moderation_appeal" ADD CONSTRAINT "moderation_appeal_sanction_fk" FOREIGN KEY ("tenant_id","sanction_id") REFERENCES "engage"."moderation_sanction"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."moderation_appeal" ADD CONSTRAINT "moderation_appeal_case_fk" FOREIGN KEY ("tenant_id","case_id") REFERENCES "engage"."moderation_case"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."moderation_audit" ADD CONSTRAINT "moderation_audit_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."moderation_case" ADD CONSTRAINT "moderation_case_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."moderation_case" ADD CONSTRAINT "moderation_case_target_profile_fk" FOREIGN KEY ("tenant_id","target_profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."moderation_case" ADD CONSTRAINT "moderation_case_sanction_fk" FOREIGN KEY ("tenant_id","sanction_id") REFERENCES "engage"."moderation_sanction"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."moderation_report" ADD CONSTRAINT "moderation_report_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."moderation_report" ADD CONSTRAINT "moderation_report_case_fk" FOREIGN KEY ("tenant_id","case_id") REFERENCES "engage"."moderation_case"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."moderation_report" ADD CONSTRAINT "moderation_report_reporter_fk" FOREIGN KEY ("tenant_id","reporter_profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."moderation_sanction" ADD CONSTRAINT "moderation_sanction_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."moderation_sanction" ADD CONSTRAINT "moderation_sanction_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."moderation_sanction" ADD CONSTRAINT "moderation_sanction_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "fan"."account"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engage"."moderation_sanction" ADD CONSTRAINT "moderation_sanction_case_fk" FOREIGN KEY ("tenant_id","case_id") REFERENCES "engage"."moderation_case"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "fan_block_blocked_idx" ON "engage"."fan_block" USING btree ("tenant_id","blocked_profile_id");
--> statement-breakpoint
CREATE INDEX "moderation_appeal_galaxie_idx" ON "engage"."moderation_appeal" USING btree ("due_at") WHERE "engage"."moderation_appeal"."route" = 'galaxie' and "engage"."moderation_appeal"."status" = 'pending';
--> statement-breakpoint
CREATE INDEX "moderation_audit_tenant_idx" ON "engage"."moderation_audit" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX "moderation_audit_subject_idx" ON "engage"."moderation_audit" USING btree ("tenant_id","subject_profile_id");
--> statement-breakpoint
CREATE INDEX "moderation_audit_purge_idx" ON "engage"."moderation_audit" USING btree ("purge_at");
--> statement-breakpoint
CREATE INDEX "moderation_case_queue_idx" ON "engage"."moderation_case" USING btree ("tenant_id","status","severity" DESC NULLS LAST,"created_at");
--> statement-breakpoint
CREATE INDEX "moderation_case_purge_idx" ON "engage"."moderation_case" USING btree ("purge_at");
--> statement-breakpoint
CREATE INDEX "moderation_report_reporter_idx" ON "engage"."moderation_report" USING btree ("tenant_id","reporter_profile_id","created_at");
--> statement-breakpoint
CREATE INDEX "moderation_report_case_idx" ON "engage"."moderation_report" USING btree ("tenant_id","case_id");
--> statement-breakpoint
CREATE INDEX "moderation_sanction_profile_idx" ON "engage"."moderation_sanction" USING btree ("tenant_id","profile_id");
--> statement-breakpoint
CREATE INDEX "moderation_sanction_account_idx" ON "engage"."moderation_sanction" USING btree ("tenant_id","account_id") WHERE "engage"."moderation_sanction"."account_id" is not null;
--> statement-breakpoint
-- Registro de auditoria imutável: ninguém altera nem apaga, nem o dono do cliente. Só passam o expurgo por relógio
-- (engage.moderation_purge = on na transação; apaga a linha vencida ou tira o conteúdo vencido) e a exclusão do
-- torcedor (engage.moderation_erasure = on; só tira o conteúdo). A exclusão em cascata do tenant inteiro também
-- passa: o DELETE só é aceito quando o cliente já não existe (não vale gatilho próprio chamando DELETE).
-- Supõe api.tenant sem RLS: com RLS, a função precisa virar SECURITY DEFINER com search_path fixo.
CREATE FUNCTION engage.moderation_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'engage.moderation_audit é só de inclusão' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM api.tenant WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
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
--> statement-breakpoint
CREATE TRIGGER moderation_audit_guard BEFORE UPDATE OR DELETE ON engage.moderation_audit
  FOR EACH ROW EXECUTE FUNCTION engage.moderation_audit_guard();
--> statement-breakpoint
CREATE TRIGGER moderation_audit_no_truncate BEFORE TRUNCATE ON engage.moderation_audit
  FOR EACH STATEMENT EXECUTE FUNCTION engage.moderation_audit_guard();
