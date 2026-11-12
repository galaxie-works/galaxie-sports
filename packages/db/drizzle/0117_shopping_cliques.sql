-- Cliques do Shopping (#918, épico #909): um por linha, agregável por jogo, entidade, loja e origem. Sem dado
-- pessoal (nada de IP, e-mail ou id do torcedor). Só expansão.
CREATE TABLE "engage"."shop_click" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"clicked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"store_id" text NOT NULL,
	"origin" text NOT NULL,
	"tenant_id" uuid,
	"widget_id" text,
	"country" text,
	"locale" text,
	CONSTRAINT "shop_click_origin" CHECK (origin in ('client', 'galaxie_app', 'galaxie_site')),
	CONSTRAINT "shop_click_entity_kind" CHECK (entity_kind in ('competition', 'participant', 'person')),
	CONSTRAINT "shop_click_client_tenant" CHECK (("engage"."shop_click"."origin" = 'client') = ("engage"."shop_click"."tenant_id" is not null)),
	CONSTRAINT "shop_click_country" CHECK ("engage"."shop_click"."country" is null or "engage"."shop_click"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "shop_click_locale" CHECK ("engage"."shop_click"."locale" is null or length("engage"."shop_click"."locale") between 2 and 10),
	CONSTRAINT "shop_click_widget_len" CHECK ("engage"."shop_click"."widget_id" is null or length("engage"."shop_click"."widget_id") between 1 and 80)
);
--> statement-breakpoint
CREATE INDEX "shop_click_event_idx" ON "engage"."shop_click" USING btree ("event_id","clicked_at");--> statement-breakpoint
CREATE INDEX "shop_click_entity_idx" ON "engage"."shop_click" USING btree ("entity_kind","entity_id","clicked_at");--> statement-breakpoint
CREATE INDEX "shop_click_store_idx" ON "engage"."shop_click" USING btree ("store_id","clicked_at");--> statement-breakpoint
CREATE INDEX "shop_click_tenant_idx" ON "engage"."shop_click" USING btree ("tenant_id","clicked_at");