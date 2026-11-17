-- Plataforma comercial, F3 (brief .fila-merge/briefs/plataforma-f3.md, decisão 9; doc 01 §A loja de features; PL3):
-- `billing.module_trial` registra o teste de um módulo ligado pela loja, uma vez por módulo e organização (índice
-- único). Só expande: tabela nova, sem mexer no que existe. Os direitos do teste em si são `tenant_override`
-- (`module_grant` e `tier` com `valid_until = ends_at`, `reason = 'module_trial'`), gravados na mesma transação. As duas
-- FKs são `restrict`: a linha é a prova de que a organização já usou o teste e não some com a marca nem com a organização.
CREATE TABLE "billing"."module_trial" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"started_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_trial_period" CHECK ("billing"."module_trial"."ends_at" > "billing"."module_trial"."started_at")
);
--> statement-breakpoint
ALTER TABLE "billing"."module_trial" ADD CONSTRAINT "module_trial_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "billing"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."module_trial" ADD CONSTRAINT "module_trial_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "module_trial_organization_module_uq" ON "billing"."module_trial" USING btree ("organization_id","module");--> statement-breakpoint
CREATE INDEX "module_trial_tenant_idx" ON "billing"."module_trial" USING btree ("tenant_id","ends_at");