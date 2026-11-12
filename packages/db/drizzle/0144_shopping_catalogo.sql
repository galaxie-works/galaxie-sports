-- Shopping (#914, épico #909): lojas de afiliado da Galaxie por país, a ficha de cada entidade (time, seleção,
-- campeonato, atleta, piloto), o jeito de achar os produtos dela em cada loja e os produtos âncora curados. Sem imagem
-- nem preço (vêm do conector da loja). Só expansão.
CREATE TABLE "engage"."shop_entity" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"kit_brand" text,
	"kit_season" text,
	"reviewed_season" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_entity_kind" CHECK (entity_kind in ('competition', 'participant', 'person')),
	CONSTRAINT "shop_entity_kit_brand_len" CHECK ("engage"."shop_entity"."kit_brand" is null or length("engage"."shop_entity"."kit_brand") between 2 and 40),
	CONSTRAINT "shop_entity_seasons" CHECK (("engage"."shop_entity"."kit_season" is null or "engage"."shop_entity"."kit_season" ~ '^[0-9]{4}(/[0-9]{2})?$') and ("engage"."shop_entity"."reviewed_season" is null or "engage"."shop_entity"."reviewed_season" ~ '^[0-9]{4}(/[0-9]{2})?$'))
);
--> statement-breakpoint
CREATE TABLE "engage"."shop_entity_store" (
	"entity_id" uuid NOT NULL,
	"store_id" text NOT NULL,
	"lookup_kind" text NOT NULL,
	"lookup_value" text NOT NULL,
	"page_url" text,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_entity_store_pkey" PRIMARY KEY("entity_id","store_id"),
	CONSTRAINT "shop_entity_store_lookup_kind" CHECK (lookup_kind in ('category', 'official_seller', 'product_list', 'team_page', 'team_slug')),
	CONSTRAINT "shop_entity_store_lookup_len" CHECK (length("engage"."shop_entity_store"."lookup_value") between 1 and 500),
	CONSTRAINT "shop_entity_store_page_https" CHECK ("engage"."shop_entity_store"."page_url" is null or "engage"."shop_entity_store"."page_url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "engage"."shop_product" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"entity_id" uuid NOT NULL,
	"store_id" text NOT NULL,
	"store_product_id" text NOT NULL,
	"product_type" text NOT NULL,
	"title" text NOT NULL,
	"season" text,
	"url" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"suggested_by" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_product_type" CHECK (product_type in ('away_kit', 'ball', 'cap', 'champion', 'commemorative', 'home_kit', 'jacket', 'mug', 'other', 'scarf', 'third_kit', 'training')),
	CONSTRAINT "shop_product_status" CHECK (status in ('approved', 'rejected', 'suggested')),
	CONSTRAINT "shop_product_store_item_len" CHECK (length("engage"."shop_product"."store_product_id") between 1 and 120),
	CONSTRAINT "shop_product_title_len" CHECK (length("engage"."shop_product"."title") between 2 and 160),
	CONSTRAINT "shop_product_season" CHECK ("engage"."shop_product"."season" is null or "engage"."shop_product"."season" ~ '^[0-9]{4}(/[0-9]{2})?$'),
	CONSTRAINT "shop_product_url_https" CHECK ("engage"."shop_product"."url" ~ '^https://'),
	CONSTRAINT "shop_product_position" CHECK ("engage"."shop_product"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "engage"."shop_store" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"network" text NOT NULL,
	"home_url" text,
	"active" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_store_id_format" CHECK ("engage"."shop_store"."id" ~ '^[a-z0-9_]{2,40}$'),
	CONSTRAINT "shop_store_name_len" CHECK (length("engage"."shop_store"."name") between 2 and 60),
	CONSTRAINT "shop_store_country_format" CHECK ("engage"."shop_store"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "shop_store_network" CHECK (network in ('amazon', 'awin', 'direct', 'impact', 'mercado_livre')),
	CONSTRAINT "shop_store_home_https" CHECK ("engage"."shop_store"."home_url" is null or "engage"."shop_store"."home_url" ~ '^https://')
);
--> statement-breakpoint
ALTER TABLE "engage"."shop_entity_store" ADD CONSTRAINT "shop_entity_store_entity_id_shop_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "engage"."shop_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engage"."shop_entity_store" ADD CONSTRAINT "shop_entity_store_store_id_shop_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "engage"."shop_store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engage"."shop_product" ADD CONSTRAINT "shop_product_entity_id_shop_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "engage"."shop_entity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engage"."shop_product" ADD CONSTRAINT "shop_product_store_id_shop_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "engage"."shop_store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_entity_ref_uq" ON "engage"."shop_entity" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "shop_entity_store_store_idx" ON "engage"."shop_entity_store" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_product_store_item_uq" ON "engage"."shop_product" USING btree ("entity_id","store_id","store_product_id");--> statement-breakpoint
CREATE INDEX "shop_product_entity_idx" ON "engage"."shop_product" USING btree ("entity_id","store_id","position");--> statement-breakpoint
CREATE INDEX "shop_product_store_idx" ON "engage"."shop_product" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "shop_store_country_idx" ON "engage"."shop_store" USING btree ("country","position");