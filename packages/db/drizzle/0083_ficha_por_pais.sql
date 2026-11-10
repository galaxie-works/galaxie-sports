CREATE SCHEMA "engage";
--> statement-breakpoint
CREATE TABLE "engage"."country_policy" (
	"country" text PRIMARY KEY NOT NULL,
	"policy" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "country_policy_key" CHECK ("engage"."country_policy"."country" ~ '^([A-Z]{2}|LATAM)$')
);
--> statement-breakpoint
CREATE TABLE "engage"."country_policy_log" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"country" text NOT NULL,
	"version" integer NOT NULL,
	"policy" jsonb NOT NULL,
	"changed_by" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engage"."tenant_country" (
	"tenant_id" uuid NOT NULL,
	"country" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"hardening" jsonb,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_country_pkey" PRIMARY KEY("tenant_id","country"),
	CONSTRAINT "tenant_country_iso" CHECK ("engage"."tenant_country"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "engage"."tenant_country" ADD CONSTRAINT "tenant_country_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "country_policy_log_version_uq" ON "engage"."country_policy_log" USING btree ("country","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_country_primary_uq" ON "engage"."tenant_country" USING btree ("tenant_id") WHERE "engage"."tenant_country"."is_primary";
--> statement-breakpoint
-- Fichas iniciais (#954): valores de produto, a confirmar com o advogado. Depois daqui, só pelo painel (Ajustes → Engajamento).
INSERT INTO "engage"."country_policy" ("country", "policy", "version", "updated_by") VALUES
  ('BR', '{"minAgeWrite":18,"minAgeParticipate":13,"retention":{"accessLogDays":183,"removedContentDays":90,"moderationDecisionsDays":730},"adsToMinors":false,"gamification":{"materialExchange":false,"marketplace":false,"raffle":false},"prizeCampaign":{"maxValue":null,"excludedRegions":[],"legalClassificationRequired":true},"punishmentNoticeRequired":false,"entity":"ltda","currency":"BRL","dateFormat":"dd/MM/yyyy","timeZone":"America/Sao_Paulo","languages":["pt-BR"],"laws":["ECA Digital (Lei 15.211/2025)","LGPD (Lei 13.709/2018)","Marco Civil da Internet (Lei 12.965/2014)"]}'::jsonb, 1, 'migration'),
  ('AR', '{"minAgeWrite":18,"minAgeParticipate":13,"retention":{"accessLogDays":183,"removedContentDays":90,"moderationDecisionsDays":730},"adsToMinors":false,"gamification":{"materialExchange":false,"marketplace":false,"raffle":false},"prizeCampaign":{"maxValue":null,"excludedRegions":[],"legalClassificationRequired":true},"punishmentNoticeRequired":false,"entity":"ltda","currency":"ARS","dateFormat":"dd/MM/yyyy","timeZone":"America/Argentina/Buenos_Aires","languages":["es"],"laws":["Ley 25.326 de Protección de los Datos Personales"]}'::jsonb, 1, 'migration'),
  ('MX', '{"minAgeWrite":18,"minAgeParticipate":13,"retention":{"accessLogDays":183,"removedContentDays":90,"moderationDecisionsDays":730},"adsToMinors":false,"gamification":{"materialExchange":false,"marketplace":false,"raffle":false},"prizeCampaign":{"maxValue":null,"excludedRegions":[],"legalClassificationRequired":true},"punishmentNoticeRequired":false,"entity":"ltda","currency":"MXN","dateFormat":"dd/MM/yyyy","timeZone":"America/Mexico_City","languages":["es"],"laws":["Ley Federal de Protección de Datos Personales en Posesión de los Particulares (2025)"]}'::jsonb, 1, 'migration'),
  ('CO', '{"minAgeWrite":18,"minAgeParticipate":13,"retention":{"accessLogDays":183,"removedContentDays":90,"moderationDecisionsDays":730},"adsToMinors":false,"gamification":{"materialExchange":false,"marketplace":false,"raffle":false},"prizeCampaign":{"maxValue":null,"excludedRegions":[],"legalClassificationRequired":true},"punishmentNoticeRequired":false,"entity":"ltda","currency":"COP","dateFormat":"dd/MM/yyyy","timeZone":"America/Bogota","languages":["es"],"laws":["Ley 1581 de 2012 (Habeas Data)"]}'::jsonb, 1, 'migration'),
  ('CL', '{"minAgeWrite":18,"minAgeParticipate":13,"retention":{"accessLogDays":183,"removedContentDays":90,"moderationDecisionsDays":730},"adsToMinors":false,"gamification":{"materialExchange":false,"marketplace":false,"raffle":false},"prizeCampaign":{"maxValue":null,"excludedRegions":[],"legalClassificationRequired":true},"punishmentNoticeRequired":false,"entity":"ltda","currency":"CLP","dateFormat":"dd/MM/yyyy","timeZone":"America/Santiago","languages":["es"],"laws":["Ley 19.628","Ley 21.719 (vigente desde dic. 2026)"]}'::jsonb, 1, 'migration'),
  ('PE', '{"minAgeWrite":18,"minAgeParticipate":13,"retention":{"accessLogDays":183,"removedContentDays":90,"moderationDecisionsDays":730},"adsToMinors":false,"gamification":{"materialExchange":false,"marketplace":false,"raffle":false},"prizeCampaign":{"maxValue":null,"excludedRegions":[],"legalClassificationRequired":true},"punishmentNoticeRequired":false,"entity":"ltda","currency":"PEN","dateFormat":"dd/MM/yyyy","timeZone":"America/Lima","languages":["es"],"laws":["Ley 29733 de Protección de Datos Personales"]}'::jsonb, 1, 'migration'),
  ('LATAM', '{"minAgeWrite":18,"minAgeParticipate":13,"retention":{"accessLogDays":183,"removedContentDays":90,"moderationDecisionsDays":730},"adsToMinors":false,"gamification":{"materialExchange":false,"marketplace":false,"raffle":false},"prizeCampaign":{"maxValue":null,"excludedRegions":[],"legalClassificationRequired":true},"punishmentNoticeRequired":false,"entity":"ltda","currency":"USD","dateFormat":"dd/MM/yyyy","timeZone":"America/Panama","languages":["es"],"laws":["Leis locais de proteção de dados (a confirmar por país)"]}'::jsonb, 1, 'migration'),
  ('US', '{"minAgeWrite":18,"minAgeParticipate":13,"retention":{"accessLogDays":183,"removedContentDays":90,"moderationDecisionsDays":730},"adsToMinors":false,"gamification":{"materialExchange":false,"marketplace":false,"raffle":false},"prizeCampaign":{"maxValue":null,"excludedRegions":[],"legalClassificationRequired":true},"punishmentNoticeRequired":false,"entity":"llc","currency":"USD","dateFormat":"MM/dd/yyyy","timeZone":"America/New_York","languages":["en"],"laws":["COPPA","Leis estaduais de privacidade (CCPA/CPRA e outras)"]}'::jsonb, 1, 'migration'),
  ('CA', '{"minAgeWrite":18,"minAgeParticipate":13,"retention":{"accessLogDays":183,"removedContentDays":90,"moderationDecisionsDays":730},"adsToMinors":false,"gamification":{"materialExchange":false,"marketplace":false,"raffle":false},"prizeCampaign":{"maxValue":null,"excludedRegions":[],"legalClassificationRequired":true},"punishmentNoticeRequired":false,"entity":"llc","currency":"CAD","dateFormat":"yyyy-MM-dd","timeZone":"America/Toronto","languages":["en"],"laws":["PIPEDA","Lei 25 do Quebec"]}'::jsonb, 1, 'migration')
ON CONFLICT ("country") DO NOTHING;
--> statement-breakpoint
INSERT INTO "engage"."country_policy_log" ("country", "version", "policy", "changed_by", "reason")
SELECT "country", "version", "policy", "updated_by", 'fichas iniciais (#954)' FROM "engage"."country_policy";