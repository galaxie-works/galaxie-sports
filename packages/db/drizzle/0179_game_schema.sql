-- Gamificação (#904, #905): schema `game` com programa (cliente + país), regras versionadas, Palpite, soma por período do
-- Ranking, Catálogo de Conquistas, Degraus, Cartas, sinal de participação, auditoria só de acréscimo e alertas antifraude.
-- Só cria: nada existente muda.
CREATE SCHEMA "game";
--> statement-breakpoint
CREATE TABLE "game"."achievement_progress" (
	"tenant_id" uuid NOT NULL,
	"program_country" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"achievement_id" text NOT NULL,
	"season" text DEFAULT 'all' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievement_progress_pkey" PRIMARY KEY("tenant_id","program_country","profile_id","achievement_id","season"),
	CONSTRAINT "achievement_progress_season" CHECK ("game"."achievement_progress"."season" = 'all' or "game"."achievement_progress"."season" ~ '^[0-9]{4}(-[0-9]{2,4})?$'),
	CONSTRAINT "achievement_progress_count" CHECK ("game"."achievement_progress"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "game"."audit_log" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"program_country" text NOT NULL,
	"profile_id" uuid,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"source_event" text,
	"rule_version" integer,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "audit_log_kind" CHECK (kind in ('prediction.placed', 'prediction.scored', 'prediction.reverted', 'prediction.voided', 'participation.counted', 'achievement.step_reached', 'achievement.completed', 'card.granted', 'level.reached', 'program.rules_changed', 'program.achievement_changed', 'fraud.flagged')),
	CONSTRAINT "audit_log_subject_len" CHECK (length("game"."audit_log"."subject") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "game"."card_grant" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"program_country" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"card_key" text NOT NULL,
	"achievement_id" text NOT NULL,
	"season" text DEFAULT 'all' NOT NULL,
	"step" smallint NOT NULL,
	"rule_version" integer NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_grant_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "card_grant_step" CHECK ("game"."card_grant"."step" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "game"."catalog_achievement" (
	"id" text PRIMARY KEY NOT NULL,
	"sport" text,
	"category" text NOT NULL,
	"family" text NOT NULL,
	"rule" jsonb NOT NULL,
	"stepped" boolean DEFAULT true NOT NULL,
	"seasonal" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"inactive_reason" text,
	"name" jsonb NOT NULL,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_achievement_id" CHECK ("game"."catalog_achievement"."id" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$' and length("game"."catalog_achievement"."id") <= 80),
	CONSTRAINT "catalog_achievement_category" CHECK (category in ('participation', 'hit', 'moment', 'consumption')),
	CONSTRAINT "catalog_achievement_inactive" CHECK ("game"."catalog_achievement"."active" or "game"."catalog_achievement"."inactive_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "game"."catalog_step" (
	"achievement_id" text NOT NULL,
	"step" smallint NOT NULL,
	"threshold" integer NOT NULL,
	"bonus_points" integer DEFAULT 0 NOT NULL,
	"card_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_step_pkey" PRIMARY KEY("achievement_id","step"),
	CONSTRAINT "catalog_step_step" CHECK ("game"."catalog_step"."step" between 1 and 5),
	CONSTRAINT "catalog_step_threshold" CHECK ("game"."catalog_step"."threshold" >= 1),
	CONSTRAINT "catalog_step_bonus" CHECK ("game"."catalog_step"."bonus_points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "game"."fraud_signal" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"program_country" text NOT NULL,
	"account_id" uuid,
	"profile_id" uuid,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fraud_signal_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "fraud_signal_status" CHECK ("game"."fraud_signal"."status" in ('open', 'dismissed', 'confirmed')),
	CONSTRAINT "fraud_signal_target" CHECK ("game"."fraud_signal"."account_id" is not null or "game"."fraud_signal"."profile_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "game"."level_def" (
	"level" smallint PRIMARY KEY NOT NULL,
	"min_points" bigint NOT NULL,
	"name" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "level_def_level" CHECK ("game"."level_def"."level" >= 1),
	CONSTRAINT "level_def_min_points" CHECK ("game"."level_def"."min_points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "game"."participation_daily" (
	"tenant_id" uuid NOT NULL,
	"program_country" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"day" date NOT NULL,
	"action" text NOT NULL,
	"ref" text NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participation_daily_pkey" PRIMARY KEY("tenant_id","program_country","profile_id","action","ref"),
	CONSTRAINT "participation_daily_action" CHECK (action in ('poll', 'trivia', 'watched', 'consumption')),
	CONSTRAINT "participation_daily_points" CHECK ("game"."participation_daily"."points" >= 0),
	CONSTRAINT "participation_daily_ref_len" CHECK (length("game"."participation_daily"."ref") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "game"."period_points" (
	"tenant_id" uuid NOT NULL,
	"program_country" text NOT NULL,
	"period" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"points" bigint DEFAULT 0 NOT NULL,
	"full_hits" integer DEFAULT 0 NOT NULL,
	"reached_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_points_pkey" PRIMARY KEY("tenant_id","program_country","period","profile_id"),
	CONSTRAINT "period_points_period" CHECK ("game"."period_points"."period" ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$'),
	CONSTRAINT "period_points_nonneg" CHECK ("game"."period_points"."points" >= 0 and "game"."period_points"."full_hits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "game"."prediction" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"program_country" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"value" jsonb NOT NULL,
	"lock_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"provisional_points" integer DEFAULT 0 NOT NULL,
	"final_points" integer,
	"full_hit" boolean DEFAULT false NOT NULL,
	"rule_version" integer NOT NULL,
	"scored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prediction_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "prediction_kind" CHECK (kind in ('exact_score', 'winner', 'quantity')),
	CONSTRAINT "prediction_state" CHECK (state in ('open', 'locked', 'final', 'void')),
	CONSTRAINT "prediction_subject" CHECK (("game"."prediction"."kind" = 'quantity' and length("game"."prediction"."subject") between 1 and 40) or ("game"."prediction"."kind" <> 'quantity' and "game"."prediction"."subject" = '')),
	CONSTRAINT "prediction_points_nonneg" CHECK ("game"."prediction"."provisional_points" >= 0 and ("game"."prediction"."final_points" is null or "game"."prediction"."final_points" >= 0)),
	CONSTRAINT "prediction_final_shape" CHECK (("game"."prediction"."state" = 'final') = ("game"."prediction"."final_points" is not null))
);
--> statement-breakpoint
CREATE TABLE "game"."program" (
	"tenant_id" uuid NOT NULL,
	"program_country" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"rule_version" integer DEFAULT 1 NOT NULL,
	"time_zone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_pkey" PRIMARY KEY("tenant_id","program_country"),
	CONSTRAINT "program_country" CHECK ("game"."program"."program_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "program_status" CHECK (status in ('active', 'paused')),
	CONSTRAINT "program_rule_version" CHECK ("game"."program"."rule_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "game"."program_achievement" (
	"tenant_id" uuid NOT NULL,
	"program_country" text NOT NULL,
	"achievement_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"thresholds" integer[],
	"custom" boolean DEFAULT false NOT NULL,
	"definition" jsonb,
	"rule_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_achievement_pkey" PRIMARY KEY("tenant_id","program_country","achievement_id"),
	CONSTRAINT "program_achievement_custom" CHECK ("game"."program_achievement"."custom" = ("game"."program_achievement"."definition" is not null)),
	CONSTRAINT "program_achievement_thresholds" CHECK ("game"."program_achievement"."thresholds" is null or (cardinality("game"."program_achievement"."thresholds") between 1 and 5))
);
--> statement-breakpoint
CREATE TABLE "game"."rule_version" (
	"tenant_id" uuid NOT NULL,
	"program_country" text NOT NULL,
	"version" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_version_pkey" PRIMARY KEY("tenant_id","program_country","version"),
	CONSTRAINT "rule_version_positive" CHECK ("game"."rule_version"."version" >= 1),
	CONSTRAINT "rule_version_note_len" CHECK ("game"."rule_version"."note" is null or length("game"."rule_version"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "game"."step_grant" (
	"tenant_id" uuid NOT NULL,
	"program_country" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"achievement_id" text NOT NULL,
	"season" text DEFAULT 'all' NOT NULL,
	"step" smallint NOT NULL,
	"threshold" integer NOT NULL,
	"bonus_points" integer DEFAULT 0 NOT NULL,
	"rule_version" integer NOT NULL,
	"source_event" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "step_grant_pkey" PRIMARY KEY("tenant_id","program_country","profile_id","achievement_id","season","step"),
	CONSTRAINT "step_grant_step" CHECK ("game"."step_grant"."step" between 1 and 5),
	CONSTRAINT "step_grant_source_len" CHECK (length("game"."step_grant"."source_event") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "game"."achievement_progress" ADD CONSTRAINT "achievement_progress_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."achievement_progress" ADD CONSTRAINT "achievement_progress_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."achievement_progress" ADD CONSTRAINT "achievement_progress_program_fk" FOREIGN KEY ("tenant_id","program_country") REFERENCES "game"."program"("tenant_id","program_country") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."card_grant" ADD CONSTRAINT "card_grant_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."card_grant" ADD CONSTRAINT "card_grant_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."card_grant" ADD CONSTRAINT "card_grant_program_fk" FOREIGN KEY ("tenant_id","program_country") REFERENCES "game"."program"("tenant_id","program_country") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."catalog_step" ADD CONSTRAINT "catalog_step_achievement_id_catalog_achievement_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "game"."catalog_achievement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."fraud_signal" ADD CONSTRAINT "fraud_signal_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."participation_daily" ADD CONSTRAINT "participation_daily_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."participation_daily" ADD CONSTRAINT "participation_daily_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."participation_daily" ADD CONSTRAINT "participation_daily_program_fk" FOREIGN KEY ("tenant_id","program_country") REFERENCES "game"."program"("tenant_id","program_country") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."period_points" ADD CONSTRAINT "period_points_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."period_points" ADD CONSTRAINT "period_points_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."period_points" ADD CONSTRAINT "period_points_program_fk" FOREIGN KEY ("tenant_id","program_country") REFERENCES "game"."program"("tenant_id","program_country") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."prediction" ADD CONSTRAINT "prediction_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."prediction" ADD CONSTRAINT "prediction_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."prediction" ADD CONSTRAINT "prediction_program_fk" FOREIGN KEY ("tenant_id","program_country") REFERENCES "game"."program"("tenant_id","program_country") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."program" ADD CONSTRAINT "program_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."program_achievement" ADD CONSTRAINT "program_achievement_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."program_achievement" ADD CONSTRAINT "program_achievement_program_fk" FOREIGN KEY ("tenant_id","program_country") REFERENCES "game"."program"("tenant_id","program_country") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."rule_version" ADD CONSTRAINT "rule_version_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."rule_version" ADD CONSTRAINT "rule_version_program_fk" FOREIGN KEY ("tenant_id","program_country") REFERENCES "game"."program"("tenant_id","program_country") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."step_grant" ADD CONSTRAINT "step_grant_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."step_grant" ADD CONSTRAINT "step_grant_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game"."step_grant" ADD CONSTRAINT "step_grant_program_fk" FOREIGN KEY ("tenant_id","program_country") REFERENCES "game"."program"("tenant_id","program_country") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "achievement_progress_rarity_idx" ON "game"."achievement_progress" USING btree ("tenant_id","program_country","achievement_id","season");--> statement-breakpoint
CREATE INDEX "audit_log_program_idx" ON "game"."audit_log" USING btree ("tenant_id","program_country","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_profile_idx" ON "game"."audit_log" USING btree ("tenant_id","profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "card_grant_profile_card_uq" ON "game"."card_grant" USING btree ("tenant_id","program_country","profile_id","card_key","season");--> statement-breakpoint
CREATE INDEX "card_grant_card_idx" ON "game"."card_grant" USING btree ("tenant_id","program_country","card_key");--> statement-breakpoint
CREATE INDEX "catalog_achievement_sport_idx" ON "game"."catalog_achievement" USING btree ("sport","active");--> statement-breakpoint
CREATE INDEX "fraud_signal_open_idx" ON "game"."fraud_signal" USING btree ("tenant_id","program_country","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "level_def_min_points_uq" ON "game"."level_def" USING btree ("min_points");--> statement-breakpoint
CREATE INDEX "participation_daily_day_idx" ON "game"."participation_daily" USING btree ("tenant_id","program_country","profile_id","day");--> statement-breakpoint
CREATE INDEX "period_points_rank_idx" ON "game"."period_points" USING btree ("tenant_id","program_country","period","points" desc,"full_hits" desc,"reached_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prediction_profile_event_uq" ON "game"."prediction" USING btree ("tenant_id","program_country","profile_id","event_id","kind","subject");--> statement-breakpoint
CREATE INDEX "prediction_event_idx" ON "game"."prediction" USING btree ("tenant_id","program_country","event_id","state");--> statement-breakpoint
CREATE INDEX "prediction_lock_idx" ON "game"."prediction" USING btree ("event_id","state","lock_at");--> statement-breakpoint
CREATE INDEX "step_grant_recent_idx" ON "game"."step_grant" USING btree ("tenant_id","program_country","profile_id","granted_at");