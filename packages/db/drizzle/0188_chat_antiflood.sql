ALTER TABLE "chat"."tenant_config" ADD COLUMN "flood_max_per_minute" integer;--> statement-breakpoint
ALTER TABLE "chat"."tenant_config" ADD COLUMN "flood_block_seconds" integer;--> statement-breakpoint
ALTER TABLE "chat"."tenant_config" ADD CONSTRAINT "tenant_config_flood_max" CHECK ("chat"."tenant_config"."flood_max_per_minute" is null or "chat"."tenant_config"."flood_max_per_minute" between 3 and 60);--> statement-breakpoint
ALTER TABLE "chat"."tenant_config" ADD CONSTRAINT "tenant_config_flood_block" CHECK ("chat"."tenant_config"."flood_block_seconds" is null or "chat"."tenant_config"."flood_block_seconds" between 30 and 1800);
