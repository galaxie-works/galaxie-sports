-- Configuração da operação em tempo de execução (painel Ajustes → Operação): sobrescritas e histórico,
-- env relatado por contêiner, pedidos de "rodar agora" e checagens. Idempotente: o banco de dev é
-- compartilhado entre worktrees.
CREATE TABLE IF NOT EXISTS "ops"."job_request" (
	"id" uuid PRIMARY KEY DEFAULT public.uuid_generate_v7() NOT NULL,
	"job" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"picked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"run_id" uuid,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ops"."runtime_check" (
	"service" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_check_service_name_pk" PRIMARY KEY("service","name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ops"."runtime_env" (
	"service" text NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"configured" boolean NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_env_service_key_pk" PRIMARY KEY("service","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ops"."runtime_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"value_type" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ops"."runtime_setting_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"action" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_request_status_idx" ON "ops"."job_request" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_setting_log_changed_idx" ON "ops"."runtime_setting_log" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_setting_log_key_idx" ON "ops"."runtime_setting_log" USING btree ("key","changed_at");