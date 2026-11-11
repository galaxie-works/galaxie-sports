-- Carteira de pontos do torcedor (#938, B6): uma carteira por Perfil e programa (cliente + país), com Pontos
-- (só sobem; caem só por estorno) e Saldo (gastável no resgate), o extrato append-only e a marca de estorno que
-- chegou antes do crédito. Só expansão.
CREATE TABLE "fan"."points_ledger" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT public.uuid_generate_v7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"program_country" text NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"source_event" text NOT NULL,
	"reverts_id" uuid,
	"points_delta" bigint NOT NULL,
	"balance_delta" bigint NOT NULL,
	"points_after" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_ledger_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "points_ledger_reason" CHECK (reason in ('prediction', 'achievement', 'presence', 'poll', 'trivia', 'adjustment', 'redeem', 'revert')),
	CONSTRAINT "points_ledger_source" CHECK (source in ('live_chat', 'communities', 'gamification', 'cosmos_ai', 'galaxie')),
	CONSTRAINT "points_ledger_nonzero" CHECK ("fan"."points_ledger"."points_delta" <> 0 or "fan"."points_ledger"."balance_delta" <> 0),
	CONSTRAINT "points_ledger_shape" CHECK (("fan"."points_ledger"."reason" = 'revert' and "fan"."points_ledger"."reverts_id" is not null and "fan"."points_ledger"."points_delta" <= 0 and "fan"."points_ledger"."balance_delta" <= 0)
        or ("fan"."points_ledger"."reason" = 'redeem' and "fan"."points_ledger"."reverts_id" is null and "fan"."points_ledger"."points_delta" = 0 and "fan"."points_ledger"."balance_delta" < 0)
        or ("fan"."points_ledger"."reason" not in ('revert', 'redeem') and "fan"."points_ledger"."reverts_id" is null and "fan"."points_ledger"."points_delta" > 0 and "fan"."points_ledger"."balance_delta" = "fan"."points_ledger"."points_delta")),
	CONSTRAINT "points_ledger_after_nonneg" CHECK ("fan"."points_ledger"."points_after" >= 0 and "fan"."points_ledger"."balance_after" >= 0),
	CONSTRAINT "points_ledger_event_len" CHECK (length("fan"."points_ledger"."source_event") between 1 and 200),
	CONSTRAINT "points_ledger_note_len" CHECK ("fan"."points_ledger"."note" is null or length("fan"."points_ledger"."note") <= 200)
);
--> statement-breakpoint
CREATE TABLE "fan"."points_revoked_event" (
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"program_country" text NOT NULL,
	"source" text NOT NULL,
	"source_event" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_revoked_event_pkey" PRIMARY KEY("tenant_id","profile_id","program_country","source","source_event","reason"),
	CONSTRAINT "points_revoked_event_len" CHECK (length("fan"."points_revoked_event"."source_event") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "fan"."wallet" (
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"program_country" text NOT NULL,
	"points" bigint DEFAULT 0 NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_pkey" PRIMARY KEY("tenant_id","profile_id","program_country"),
	CONSTRAINT "wallet_country" CHECK ("fan"."wallet"."program_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "wallet_points_nonneg" CHECK ("fan"."wallet"."points" >= 0),
	CONSTRAINT "wallet_balance_nonneg" CHECK ("fan"."wallet"."balance" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fan"."points_ledger" ADD CONSTRAINT "points_ledger_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fan"."points_ledger" ADD CONSTRAINT "points_ledger_wallet_fk" FOREIGN KEY ("tenant_id","profile_id","program_country") REFERENCES "fan"."wallet"("tenant_id","profile_id","program_country") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fan"."points_ledger" ADD CONSTRAINT "points_ledger_reverts_fk" FOREIGN KEY ("tenant_id","reverts_id") REFERENCES "fan"."points_ledger"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fan"."points_revoked_event" ADD CONSTRAINT "points_revoked_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fan"."points_revoked_event" ADD CONSTRAINT "points_revoked_event_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fan"."wallet" ADD CONSTRAINT "wallet_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "api"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fan"."wallet" ADD CONSTRAINT "wallet_profile_fk" FOREIGN KEY ("tenant_id","profile_id") REFERENCES "fan"."profile"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_event_uq" ON "fan"."points_ledger" USING btree ("tenant_id","profile_id","program_country","source","source_event","reason") WHERE "fan"."points_ledger"."reverts_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "points_ledger_revert_uq" ON "fan"."points_ledger" USING btree ("tenant_id","reverts_id") WHERE "fan"."points_ledger"."reverts_id" is not null;--> statement-breakpoint
CREATE INDEX "points_ledger_wallet_idx" ON "fan"."points_ledger" USING btree ("tenant_id","profile_id","program_country","id");--> statement-breakpoint
-- extrato é append-only: lançamento errado se corrige com estorno. DELETE só em cascata (exclusão do Perfil ou do
-- cliente apaga a carteira, e a carteira leva o extrato); direto, nunca. TRUNCATE também não.
CREATE OR REPLACE FUNCTION "fan"."points_ledger_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'fan.points_ledger é append-only: corrija com um estorno';
END $$;--> statement-breakpoint
CREATE TRIGGER "points_ledger_no_update" BEFORE UPDATE ON "fan"."points_ledger"
  FOR EACH ROW EXECUTE FUNCTION "fan"."points_ledger_append_only"();--> statement-breakpoint
CREATE TRIGGER "points_ledger_no_delete" BEFORE DELETE ON "fan"."points_ledger"
  FOR EACH ROW EXECUTE FUNCTION "fan"."points_ledger_append_only"();--> statement-breakpoint
CREATE TRIGGER "points_ledger_no_truncate" BEFORE TRUNCATE ON "fan"."points_ledger"
  FOR EACH STATEMENT EXECUTE FUNCTION "fan"."points_ledger_append_only"();
