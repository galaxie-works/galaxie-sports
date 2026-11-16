-- Plataforma comercial, F3 (brief .fila-merge/briefs/plataforma-f3.md, decisão 1; doc 02 §Máquina de estados do tenant):
-- o estado do tenant vira coluna (`api.tenant.state`, CHECK nos 9 estados, `state_since`) com histórico em
-- `billing.tenant_state_event`. Só expande: `status` e `trial_ends_at` ficam e seguem gravados em espelho
-- (`status = 'suspended'` só quando `state = 'suspended'`); a retirada de `status` é um PR `contrair` futuro.
-- No fim, o backfill (idempotente) deriva o estado inicial de cada tenant das colunas de hoje.
CREATE TABLE "billing"."tenant_state_event" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"cause" text NOT NULL,
	"reason" text,
	"actor" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_state_event_from" CHECK ("billing"."tenant_state_event"."from_state" is null or "billing"."tenant_state_event"."from_state" in ('draft', 'pending_review', 'rejected', 'trial', 'trial_expired', 'active', 'past_due', 'suspended', 'cancelled')),
	CONSTRAINT "tenant_state_event_to" CHECK ("billing"."tenant_state_event"."to_state" in ('draft', 'pending_review', 'rejected', 'trial', 'trial_expired', 'active', 'past_due', 'suspended', 'cancelled')),
	CONSTRAINT "tenant_state_event_cause" CHECK ("billing"."tenant_state_event"."cause" in ('signup', 'provision', 'review', 'payment', 'clock', 'admin', 'request', 'migration'))
);
--> statement-breakpoint
ALTER TABLE "api"."tenant" ADD COLUMN "state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."tenant" ADD COLUMN "state_since" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "billing"."tenant_state_event" ADD CONSTRAINT "tenant_state_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_state_event_tenant_idx" ON "billing"."tenant_state_event" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "tenant_state_idx" ON "api"."tenant" USING btree ("state","state_since");--> statement-breakpoint
ALTER TABLE "api"."tenant" ADD CONSTRAINT "tenant_state" CHECK ("api"."tenant"."state" in ('draft', 'pending_review', 'rejected', 'trial', 'trial_expired', 'active', 'past_due', 'suspended', 'cancelled'));--> statement-breakpoint
-- galaxie:backfill-0185:start
-- Migration de dados, idempotente: só os tenants que ainda não têm nenhuma linha em billing.tenant_state_event. Ordem
-- das regras: suspenso → suspended; revisão do cadastro pendente → pending_review, recusada → rejected (antes do
-- prazo do trial, porque o cadastro em revisão também nasce com trial_ends_at); trial vencido → trial_expired;
-- trial em curso ou plano trial → trial; o resto → active. state_since: o fim do trial no vencido, a criação no trial
-- e no active, agora nos demais. Cada tenant ganha um evento `migration` com o que foi lido. Os testes de integração
-- executam este bloco pelo marcador.
WITH computed AS (
	SELECT
		t."id",
		t."status"::text AS "status",
		t."trial_ends_at",
		o."review_status",
		CASE
			WHEN t."status" = 'suspended' THEN 'suspended'
			WHEN o."review_status" = 'pending' THEN 'pending_review'
			WHEN o."review_status" = 'rejected' THEN 'rejected'
			WHEN t."trial_ends_at" IS NOT NULL AND t."trial_ends_at" <= now() THEN 'trial_expired'
			WHEN t."trial_ends_at" > now() OR t."plan" = 'trial' THEN 'trial'
			ELSE 'active'
		END AS "state",
		CASE
			WHEN t."status" = 'suspended' THEN now()
			WHEN o."review_status" IN ('pending', 'rejected') THEN now()
			WHEN t."trial_ends_at" IS NOT NULL AND t."trial_ends_at" <= now() THEN t."trial_ends_at"
			ELSE t."created_at"
		END AS "since"
	FROM "api"."tenant" t
	LEFT JOIN "billing"."organization" o ON o."id" = t."organization_id"
	WHERE NOT EXISTS (SELECT 1 FROM "billing"."tenant_state_event" e WHERE e."tenant_id" = t."id")
), updated AS (
	UPDATE "api"."tenant" t
	SET "state" = c."state", "state_since" = c."since"
	FROM computed c
	WHERE t."id" = c."id"
	RETURNING t."id"
)
INSERT INTO "billing"."tenant_state_event" ("tenant_id", "from_state", "to_state", "cause", "reason", "actor", "payload")
SELECT
	c."id",
	NULL,
	c."state",
	'migration',
	'estado inicial derivado de status, trial_ends_at e review_status (migration 0185)',
	'migration:0185',
	jsonb_build_object('status', c."status", 'trial_ends_at', c."trial_ends_at", 'review_status', c."review_status")
FROM computed c
JOIN updated u ON u."id" = c."id";
-- galaxie:backfill-0185:end
