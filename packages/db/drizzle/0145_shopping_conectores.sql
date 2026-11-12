-- Conectores do Shopping (#916, épico #909): matriz loja × caminho do cliente, configuração não secreta na rede e
-- credenciais da conta da Galaxie cifradas pelo cofre do painel. Só expansão (colunas com DEFAULT ou opcionais).
ALTER TABLE "engage"."shop_store" ADD COLUMN "client_paths" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "engage"."shop_store" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "engage"."shop_store" ADD COLUMN "credentials_sealed" text;--> statement-breakpoint
ALTER TABLE "engage"."shop_store" ADD COLUMN "credentials_hint" text;--> statement-breakpoint
ALTER TABLE "engage"."shop_store" ADD COLUMN "credentials_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "engage"."shop_store" ADD COLUMN "credentials_updated_by" text;--> statement-breakpoint
ALTER TABLE "engage"."shop_store" ADD CONSTRAINT "shop_store_client_paths" CHECK ("engage"."shop_store"."client_paths" <@ array['client_code', 'subnetwork']::text[]);--> statement-breakpoint
ALTER TABLE "engage"."shop_store" ADD CONSTRAINT "shop_store_credentials_sealed" CHECK ("engage"."shop_store"."credentials_sealed" is null or "engage"."shop_store"."credentials_sealed" like 'enc:%');