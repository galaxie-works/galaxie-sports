-- Patrocinadores do cliente (#1021, B10): o cadastro único (categoria de aposta não existe; o banco repete as
-- categorias) e as impressões agregadas por patrocinador, lugar e dia, sem dado do torcedor. Só expansão.
CREATE TABLE "engage"."sponsor" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"link_url" text,
	"logo_light_url" text,
	"logo_dark_url" text,
	"countries" text[] DEFAULT '{}'::text[] NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsor_category" CHECK (category in ('apparel', 'automotive', 'beverage', 'education', 'energy', 'finance', 'food', 'health', 'media', 'retail', 'technology', 'telecom', 'travel', 'other')),
	CONSTRAINT "sponsor_name_len" CHECK (length("engage"."sponsor"."name") between 2 and 80),
	CONSTRAINT "sponsor_urls_https" CHECK (("engage"."sponsor"."link_url" is null or "engage"."sponsor"."link_url" ~ '^https://') and ("engage"."sponsor"."logo_light_url" is null or "engage"."sponsor"."logo_light_url" ~ '^https://') and ("engage"."sponsor"."logo_dark_url" is null or "engage"."sponsor"."logo_dark_url" ~ '^https://')),
	CONSTRAINT "sponsor_countries" CHECK (cardinality("engage"."sponsor"."countries") <= 60),
	CONSTRAINT "sponsor_dates" CHECK ("engage"."sponsor"."ends_at" is null or "engage"."sponsor"."starts_at" is null or "engage"."sponsor"."ends_at" > "engage"."sponsor"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "engage"."sponsor_impression_daily" (
	"tenant_id" uuid NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"surface" text NOT NULL,
	"surface_id" text NOT NULL,
	"day" date NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "sponsor_impression_daily_pkey" PRIMARY KEY("tenant_id","sponsor_id","surface","surface_id","day"),
	CONSTRAINT "sponsor_impression_surface" CHECK (surface in ('chat_room', 'prediction_campaign', 'reward')),
	CONSTRAINT "sponsor_impression_surface_id_len" CHECK (length("engage"."sponsor_impression_daily"."surface_id") between 1 and 200),
	CONSTRAINT "sponsor_impression_nonneg" CHECK ("engage"."sponsor_impression_daily"."impressions" >= 0)
);
--> statement-breakpoint
ALTER TABLE "engage"."sponsor" ADD CONSTRAINT "sponsor_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_tenant_id_uq" ON "engage"."sponsor" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "engage"."sponsor_impression_daily" ADD CONSTRAINT "sponsor_impression_sponsor_fk" FOREIGN KEY ("tenant_id","sponsor_id") REFERENCES "engage"."sponsor"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_tenant_name_uq" ON "engage"."sponsor" USING btree ("tenant_id",lower("name")) WHERE "engage"."sponsor"."archived_at" is null;