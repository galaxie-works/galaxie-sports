-- Circuit breaker dos webhooks (#360): sequência de falhas por endpoint e a desativação automática, mostrada no
-- portal do cliente. Só expansão (colunas opcionais).
ALTER TABLE "api"."webhook_endpoint" ADD COLUMN "failing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api"."webhook_endpoint" ADD COLUMN "auto_disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api"."webhook_endpoint" ADD COLUMN "auto_disabled_reason" text;