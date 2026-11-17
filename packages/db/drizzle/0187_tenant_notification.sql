-- Plataforma comercial, F3 (brief .fila-merge/briefs/plataforma-f3.md, decisão 11; doc 02 §O trial, "e-mail no dia 23
-- e no dia 29", e §Provisionamento, passo 9): `billing.tenant_notification` registra cada e-mail do ciclo de vida
-- (boas-vindas, lembretes do trial, trial vencido, teste de módulo acabando, suspensão, cancelamento) mandado aos Donos
-- e ao Financeiro da organização. A idempotência é o índice único por tenant, `kind` e `ref`: quem envia grava a linha
-- antes de enviar e a segunda rodada do dia não envia de novo. Só expande: tabela nova, sem mexer no que existe.
CREATE TABLE "billing"."tenant_notification" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone,
	"recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing"."tenant_notification" ADD CONSTRAINT "tenant_notification_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_notification_tenant_kind_ref_uq" ON "billing"."tenant_notification" USING btree ("tenant_id","kind","ref");--> statement-breakpoint
CREATE INDEX "tenant_notification_tenant_idx" ON "billing"."tenant_notification" USING btree ("tenant_id","created_at");