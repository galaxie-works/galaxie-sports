-- Plataforma comercial, F2 Identidade (#1136; docs 02 e 03 da plataforma, sabatina PL2, PL9, PL16, PL17 e PL23):
-- a organização que assina e paga acima da marca, seus membros (Dono e financeiro valem na organização inteira),
-- o domínio comprovado por TXT, o registro de toda ação da equipe Galaxie, a ligação `api.tenant.organization_id`
-- e a validade do convite em `api.tenant_member`. Só expande: `organization_id` fica nula até o PR `contrair`
-- que a torna obrigatória. No fim, a migration de dados (idempotente) cria uma organização por marca existente.
CREATE TABLE "billing"."domain" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"host" text NOT NULL,
	"txt_token" text DEFAULT 'galaxie-verify=' || replace(gen_random_uuid()::text, '-', '') NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_host_format" CHECK ("billing"."domain"."host" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$')
);
--> statement-breakpoint
CREATE TABLE "billing"."organization" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"billing_entity" text NOT NULL,
	"capacity_tier" text DEFAULT 'C1' NOT NULL,
	"locale" text,
	"timezone" text,
	"legal_name" text,
	"tax_id" text,
	"billing_email" text,
	"billing_address" jsonb,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	"terms_accepted_by" text,
	"terms_accepted_ip" text,
	"review_status" text DEFAULT 'none' NOT NULL,
	"stripe_customer_id" text,
	"is_galaxie" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organization_country_iso2" CHECK ("billing"."organization"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "organization_currency" CHECK ("billing"."organization"."currency" in ('usd', 'brl')),
	CONSTRAINT "organization_billing_entity" CHECK ("billing"."organization"."billing_entity" in ('llc', 'ltda')),
	CONSTRAINT "organization_capacity_tier" CHECK ("billing"."organization"."capacity_tier" in ('C1', 'C2', 'C3', 'C4')),
	CONSTRAINT "organization_review_status" CHECK ("billing"."organization"."review_status" in ('none', 'pending', 'approved', 'rejected')),
	CONSTRAINT "organization_terms" CHECK (("billing"."organization"."terms_version" is null) = ("billing"."organization"."terms_accepted_at" is null))
);
--> statement-breakpoint
CREATE TABLE "billing"."organization_member" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_member_role" CHECK ("billing"."organization_member"."role" in ('owner', 'billing'))
);
--> statement-breakpoint
CREATE TABLE "billing"."staff_action" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid,
	"organization_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_staff_action_target" CHECK ("billing"."staff_action"."tenant_id" is not null or "billing"."staff_action"."organization_id" is not null),
	CONSTRAINT "billing_staff_action_reason" CHECK (length(trim("billing"."staff_action"."reason")) >= 5)
);
--> statement-breakpoint
ALTER TABLE "api"."tenant" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."tenant_member" ADD COLUMN "invite_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing"."domain" ADD CONSTRAINT "domain_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."organization_member" ADD CONSTRAINT "organization_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "billing"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."staff_action" ADD CONSTRAINT "staff_action_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."staff_action" ADD CONSTRAINT "staff_action_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "billing"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_tenant_host_uq" ON "billing"."domain" USING btree ("tenant_id","host");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_verified_host_uq" ON "billing"."domain" USING btree ("host") WHERE "billing"."domain"."verified_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_txt_token_uq" ON "billing"."domain" USING btree ("txt_token");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_member_user_uq" ON "billing"."organization_member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_member_user_idx" ON "billing"."organization_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "billing_staff_action_tenant_idx" ON "billing"."staff_action" USING btree ("tenant_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "billing_staff_action_organization_idx" ON "billing"."staff_action" USING btree ("organization_id","id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "api"."tenant" ADD CONSTRAINT "tenant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "billing"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_organization_idx" ON "api"."tenant" USING btree ("organization_id");--> statement-breakpoint
-- galaxie:backfill-0178:start
-- Migration de dados, idempotente (rodar de novo não cria nada a mais): uma organização por marca que ainda não tem
-- a sua, com o mesmo slug e nome. País = primeiro mercado do tenant quando é um ISO2 válido, senão BR; moeda e
-- entidade pela ficha do país (BRL/Ltda no Brasil, USD/LLC fora); faixa = a da marca, ou C1. `is_galaxie` vale para
-- o slug `galaxie`: o código não fixa o slug do tenant próprio (hoje são ids em ajuste de runtime), então o painel
-- marca o cliente zero à mão se o slug for outro. Os testes de integração executam este bloco pelo marcador.
INSERT INTO "billing"."organization" ("slug", "name", "country", "currency", "billing_entity", "capacity_tier", "is_galaxie", "created_by")
SELECT
	t."slug",
	t."name",
	c."country",
	CASE WHEN c."country" = 'BR' THEN 'brl' ELSE 'usd' END,
	CASE WHEN c."country" = 'BR' THEN 'ltda' ELSE 'llc' END,
	coalesce(t."capacity_tier", 'C1'),
	t."slug" = 'galaxie',
	'migration:0178'
FROM "api"."tenant" t
CROSS JOIN LATERAL (SELECT CASE WHEN t."markets"[1] ~ '^[A-Z]{2}$' THEN t."markets"[1] ELSE 'BR' END AS "country") c
WHERE t."organization_id" IS NULL
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
UPDATE "api"."tenant" t
SET "organization_id" = o."id"
FROM "billing"."organization" o
WHERE t."organization_id" IS NULL AND o."slug" = t."slug";--> statement-breakpoint
-- cada Dono de marca (usuário do console) vira Dono da organização da marca, uma vez só
INSERT INTO "billing"."organization_member" ("organization_id", "user_id", "role", "invited_by", "accepted_at")
SELECT DISTINCT ON (t."organization_id", m."user_id")
	t."organization_id",
	m."user_id",
	'owner',
	'migration:0178',
	coalesce(m."accepted_at", now())
FROM "api"."tenant_member" m
JOIN "api"."tenant" t ON t."id" = m."tenant_id"
WHERE m."role" = 'owner' AND m."user_id" IS NOT NULL AND t."organization_id" IS NOT NULL
ORDER BY t."organization_id", m."user_id", m."accepted_at" NULLS LAST
ON CONFLICT ("organization_id", "user_id") DO NOTHING;
-- galaxie:backfill-0178:end
