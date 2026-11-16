-- Texto de pré e pós-jogo no tom da marca (#1009): o guia de tom do cliente e a função, já ativa com o mínimo aprovado.
CREATE TABLE "cosmos"."brand_voice" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"tone" text NOT NULL,
	"avoid" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"length" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_voice_tone" CHECK ("cosmos"."brand_voice"."tone" in ('formal', 'fan', 'young')),
	CONSTRAINT "brand_voice_length" CHECK ("cosmos"."brand_voice"."length" in ('short', 'medium', 'long'))
);
--> statement-breakpoint
ALTER TABLE "cosmos"."brand_voice" ADD CONSTRAINT "brand_voice_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "cosmos"."function_def" ("name", "min_credits", "permission", "screen", "active")
VALUES ('match.text', 20, 'settings.manage', '/eventos', true)
ON CONFLICT ("name") DO NOTHING;
