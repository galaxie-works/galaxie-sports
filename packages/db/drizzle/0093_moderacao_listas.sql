-- Base de regras de moderação (#969, B7): listas da Galaxie (versionadas, com histórico) e o que cada cliente
-- acrescenta. Só expansão.
CREATE TABLE "engage"."moderation_list" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid,
	"list" text NOT NULL,
	"locale" text NOT NULL,
	"terms" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_list_name" CHECK (list in ('hate', 'threat', 'harassment', 'sexual', 'profanity', 'betting', 'allowed_domains', 'bet_domains', 'exceptions')),
	CONSTRAINT "moderation_list_locale" CHECK ("engage"."moderation_list"."locale" in ('all', 'pt', 'es', 'en')),
	CONSTRAINT "moderation_list_domain_locale" CHECK ("engage"."moderation_list"."list" not in ('allowed_domains', 'bet_domains', 'exceptions') or "engage"."moderation_list"."locale" = 'all'),
	CONSTRAINT "moderation_list_tenant_exceptions" CHECK ("engage"."moderation_list"."tenant_id" is null or "engage"."moderation_list"."list" <> 'exceptions'),
	CONSTRAINT "moderation_list_size" CHECK (cardinality("engage"."moderation_list"."terms") <= 5000)
);
--> statement-breakpoint
CREATE TABLE "engage"."moderation_list_log" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"list_id" uuid NOT NULL,
	"tenant_id" uuid,
	"list" text NOT NULL,
	"locale" text NOT NULL,
	"version" integer NOT NULL,
	"terms" text[] NOT NULL,
	"changed_by" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "engage"."moderation_list" ADD CONSTRAINT "moderation_list_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engage"."moderation_list_log" ADD CONSTRAINT "moderation_list_log_list_id_moderation_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "engage"."moderation_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_list_base_uq" ON "engage"."moderation_list" USING btree ("list","locale") WHERE "engage"."moderation_list"."tenant_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_list_tenant_uq" ON "engage"."moderation_list" USING btree ("tenant_id","list","locale") WHERE "engage"."moderation_list"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_list_log_version_uq" ON "engage"."moderation_list_log" USING btree ("list_id","version");--> statement-breakpoint
CREATE INDEX "moderation_list_log_changed_idx" ON "engage"."moderation_list_log" USING btree ("created_at");
--> statement-breakpoint
-- listas base iniciais (versão 1), as mesmas de DEFAULT_MODERATION_LISTS em @galaxie/engage; daí em diante a tela da Galaxie
INSERT INTO "engage"."moderation_list" ("list", "locale", "terms", "version", "updated_by") VALUES
  ('hate', 'all', ARRAY['nigger*', 'nigga*', 'sieg heil', '1488']::text[], 1, 'migration'),
  ('hate', 'pt', ARRAY['macac*', 'crioul*', 'negrinh*', 'tiziu', 'senzala', 'volta pra senzala', 'viado', 'viadinho', 'viadao', 'boiol*', 'sapatao', 'traveco*', 'baianada', 'paraiba de merda', 'nordestino de merda', 'judeu de merda', 'nazist*', 'hitler tinha razao']::text[], 1, 'migration'),
  ('hate', 'es', ARRAY['mono de mierda', 'negro de mierda', 'sudaca*', 'paragua de mierda', 'puto de mierda', 'maricon*', 'trolo*', 'indio de mierda', 'villero de mierda', 'judio de mierda']::text[], 1, 'migration'),
  ('hate', 'en', ARRAY['monkey boy', 'go back to africa', 'faggot*', 'tranny*', 'white power', 'heil hitler']::text[], 1, 'migration'),
  ('threat', 'pt', ARRAY['vou te matar', 'vou matar voce', 'te pego na saida', 'sei onde voce mora', 'voce vai morrer', 'vc vai morrer', 'tu vai morrer', 'voces vao morrer', 'vcs vao morrer', 'vai morrer desgracado', 'vai morrer seu*', 'merece morrer', 'vou te quebrar', 'vou te explodir', 'vou explodir voce*', 'vou explodir vc', 'vou explodir sua*', 'vou explodir seu*', 'vou explodir o estadio']::text[], 1, 'migration'),
  ('threat', 'es', ARRAY['te voy a matar', 'te mato', 'se donde vivis', 'se donde vives', 'vas a morir', 'te espero a la salida']::text[], 1, 'migration'),
  ('threat', 'en', ARRAY['i will kill you', 'ill kill you', 'gonna kill you', 'i know where you live', 'you will die']::text[], 1, 'migration'),
  ('harassment', 'pt', ARRAY['se mata', 'se mate', 'ninguem gosta de voce', 'lixo humano', 'aborto da natureza']::text[], 1, 'migration'),
  ('harassment', 'es', ARRAY['matate', 'suicidate', 'nadie te quiere', 'basura humana']::text[], 1, 'migration'),
  ('harassment', 'en', ARRAY['kill yourself', 'kys', 'nobody loves you', 'human trash']::text[], 1, 'migration'),
  ('sexual', 'pt', ARRAY['manda nudes', 'manda nude', 'pack do pezinho', 'chupa meu*', 'senta no meu*']::text[], 1, 'migration'),
  ('sexual', 'es', ARRAY['manda nudes', 'mandame fotos desnuda', 'chupame la*']::text[], 1, 'migration'),
  ('sexual', 'en', ARRAY['send nudes', 'suck my*']::text[], 1, 'migration'),
  ('profanity', 'pt', ARRAY['porra', 'caralh*', 'puta que pariu', 'fdp', 'filho da puta', 'arrombad*', 'otari*', 'merda', 'cuzao', 'buceta']::text[], 1, 'migration'),
  ('profanity', 'es', ARRAY['concha de tu madre', 'la concha de*', 'hijo de puta', 'hdp', 'pelotudo*', 'boludo de mierda', 'mierda', 'carajo', 'pendejo*', 'chinga tu madre']::text[], 1, 'migration'),
  ('profanity', 'en', ARRAY['fuck*', 'motherfucker*', 'shit', 'bullshit', 'asshole*', 'bitch*', 'cunt*']::text[], 1, 'migration'),
  ('betting', 'all', ARRAY['bet365', 'betano', 'sportingbet', 'betfair', 'pixbet', 'estrelabet', 'esportes da sorte', '1xbet', 'bwin', 'codere', 'betway', 'betsson', 'rivalo', 'novibet', 'superbet', 'betnacional', 'kto', 'f12bet', 'mrjack', 'luva bet', 'casa de aposta*', 'casas de aposta*', 'casa de apuesta*', 'casas de apuesta*', 'apostas esportivas', 'apuestas deportivas', 'sports betting', 'odds turbinad*', 'cupom de aposta', 'codigo de bonus', 'link na bio', 'tigrinho', 'fortune tiger', 'aviator']::text[], 1, 'migration'),
  ('allowed_domains', 'all', ARRAY['galaxie.sports', 'galaxie.works']::text[], 1, 'migration'),
  ('bet_domains', 'all', ARRAY['bet', 'bet365.com', 'betano.com', 'sportingbet.com', 'betfair.com', 'pixbet.com', 'estrelabet.com', 'esportesdasorte.com', 'blaze.com', 'stake.com', '1xbet.com', 'bwin.com', 'codere.com', 'betway.com', 'betsson.com', 'rivalo.com', 'novibet.com', 'superbet.com', 'betnacional.com', 'kto.com', 'f12.bet', 'caliente.mx']::text[], 1, 'migration'),
  ('exceptions', 'all', ARRAY['macacao', 'macacoes']::text[], 1, 'migration')

ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "engage"."moderation_list_log" ("list_id", "tenant_id", "list", "locale", "version", "terms", "changed_by", "reason")
  SELECT id, NULL, list, locale, 1, terms, 'migration', 'listas iniciais (#969)' FROM "engage"."moderation_list"
  WHERE tenant_id IS NULL AND version = 1
  ON CONFLICT DO NOTHING;
