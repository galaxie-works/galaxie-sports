import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { destructiveStatements } from './destructive-migrations.js';

const rules = (sql: string) => destructiveStatements(sql).map((s) => s.rule);

describe('migrations que contraem o schema', () => {
  it.each([
    ['ALTER TABLE "core"."event" DROP COLUMN "x";', 'DROP COLUMN'],
    ['alter table core.event drop column if exists x;', 'DROP COLUMN'],
    ['ALTER TABLE "core"."event" DROP "x";', 'DROP COLUMN'],
    ['ALTER TABLE "core"."event"\n  DROP\n  COLUMN\n  "x";', 'DROP COLUMN'],
    ['DROP TABLE "core"."event";', 'DROP TABLE'],
    ['DROP TABLE IF EXISTS "core"."event" CASCADE;', 'DROP TABLE'],
    ['DROP SCHEMA "enrich" CASCADE;', 'DROP SCHEMA'],
    ['ALTER TABLE "core"."event" DROP CONSTRAINT "event_uq";', 'DROP CONSTRAINT'],
    ['DROP TYPE "core"."event_status";', 'DROP TYPE'],
    ['DROP MATERIALIZED VIEW "core"."v";', 'DROP MATERIALIZED VIEW'],
    ['ALTER TABLE "core"."event" RENAME COLUMN "a" TO "b";', 'RENAME COLUMN'],
    ['ALTER TABLE "core"."event" RENAME TO "match";', 'RENAME TO'],
    ['ALTER INDEX "core"."a_idx" RENAME TO "b_idx";', 'RENAME TO'],
    ['ALTER TABLE "core"."event" ALTER COLUMN "n" SET DATA TYPE bigint;', 'ALTER COLUMN TYPE'],
    ['ALTER TABLE "core"."event" ALTER COLUMN "n" TYPE bigint USING "n"::bigint;', 'ALTER COLUMN TYPE'],
    ['alter table core.event alter n type text;', 'ALTER COLUMN TYPE'],
    ['ALTER TABLE "core"."event" ALTER COLUMN "n" SET NOT NULL;', 'SET NOT NULL'],
    ['ALTER TABLE "core"."event" ADD COLUMN "n" integer NOT NULL;', 'ADD COLUMN NOT NULL sem DEFAULT'],
    [
      'ALTER TABLE "core"."event" ADD COLUMN IF NOT EXISTS "n" text NOT NULL;',
      'ADD COLUMN NOT NULL sem DEFAULT',
    ],
    ['TRUNCATE "core"."event";', 'TRUNCATE'],
  ])('%s → %s', (sql, rule) => {
    expect(rules(sql)).toEqual([rule]);
  });

  it('DROP INDEX conta, mesmo CONCURRENTLY IF EXISTS de um índice que foi trocado por outro', () => {
    // a versão antiga ainda pode usar o índice (e o único é o alvo do ON CONFLICT dela): sai no `contrair` seguinte
    expect(rules('DROP INDEX "core"."roster_uq";')).toEqual(['DROP INDEX']);
    expect(rules('DROP INDEX CONCURRENTLY IF EXISTS "core"."roster_uq";')).toEqual(['DROP INDEX']);
    expect(
      rules(`CREATE UNIQUE INDEX IF NOT EXISTS "roster_uq2" ON "core"."roster" ("a");--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "core"."roster_uq";`),
    ).toEqual(['DROP INDEX']);
  });

  it.each([
    'ALTER TABLE "core"."event" ALTER COLUMN "n" DROP DEFAULT;',
    'ALTER TABLE "core"."event" ALTER COLUMN "n" DROP NOT NULL;',
    'ALTER TABLE "core"."event" ALTER COLUMN "n" DROP IDENTITY IF EXISTS;',
    'ALTER TABLE "core"."event" ALTER COLUMN "n" DROP EXPRESSION;',
    'ALTER TABLE "core"."event" ALTER COLUMN "n" SET DEFAULT 0;',
  ])('afrouxar a coluna não é destrutivo: %s', (sql) => {
    expect(rules(sql)).toEqual([]);
  });

  it('expandir não é destrutivo', () => {
    expect(
      rules(`CREATE TABLE "core"."novo" ("id" uuid PRIMARY KEY NOT NULL, "n" integer NOT NULL, "t" text NOT NULL DEFAULT 'x');
--> statement-breakpoint
ALTER TABLE "core"."event" ADD COLUMN "a" text;--> statement-breakpoint
ALTER TABLE "core"."event" ADD COLUMN "b" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."event" ADD COLUMN "c" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."event" ADD COLUMN "d" integer GENERATED ALWAYS AS IDENTITY NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."event" ADD COLUMN "e" numeric(10, 2) CHECK ("e" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "core"."event" ADD COLUMN "f" text, ADD COLUMN "g" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "core"."event" ADD CONSTRAINT "event_fk" FOREIGN KEY ("a") REFERENCES "core"."x"("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_a_idx" ON "core"."event" USING btree ("a");--> statement-breakpoint
ALTER TYPE "core"."event_status" ADD VALUE 'novo';`),
    ).toEqual([]);
  });

  it('acha o ADD COLUMN NOT NULL sem DEFAULT no meio de vários comandos de um ALTER', () => {
    expect(
      rules(
        'ALTER TABLE "core"."event" ADD COLUMN "f" text DEFAULT \'\' NOT NULL, ADD COLUMN "g" text NOT NULL;',
      ),
    ).toEqual(['ADD COLUMN NOT NULL sem DEFAULT']);
  });

  it('ignora comentários, texto entre aspas simples e nomes entre aspas duplas', () => {
    expect(
      rules(`-- DROP TABLE "core"."event";
/* ALTER TABLE x RENAME TO y;
   TRUNCATE x; */
COMMENT ON COLUMN "core"."event"."a" IS 'não faça DROP COLUMN nem RENAME; SET NOT NULL, TRUNCATE';
ALTER TABLE "core"."event" ADD COLUMN "drop" text;--> statement-breakpoint
ALTER TABLE "core"."event" ADD COLUMN "rename column" text;--> statement-breakpoint
INSERT INTO "core"."t" ("a") VALUES ('it''s a DROP TABLE'), ('x');`),
    ).toEqual([]);
  });

  it('acha o destrutivo dentro de um bloco DO', () => {
    expect(
      rules(`DO $$ BEGIN
  ALTER TABLE "core"."event" DROP COLUMN "x";
END $$;`),
    ).toEqual(['DROP COLUMN']);
  });

  it('informa a linha e o trecho, na ordem do arquivo', () => {
    const found = destructiveStatements(`-- migration de teste
ALTER TABLE "core"."event" ADD COLUMN "ok" text;--> statement-breakpoint
ALTER TABLE "core"."event"
  RENAME COLUMN "a" TO "b";--> statement-breakpoint
ALTER TABLE "core"."event" DROP COLUMN "c";
`);
    expect(found).toEqual([
      { line: 4, rule: 'RENAME COLUMN', excerpt: 'RENAME COLUMN "a" TO "b"' },
      { line: 5, rule: 'DROP COLUMN', excerpt: 'DROP COLUMN "c"' },
    ]);
  });

  it('a 0005 do repositório troca o índice único por uma constraint: o DROP INDEX é pego', () => {
    const text = readFileSync(new URL('../drizzle/0005_event_state_and_roster.sql', import.meta.url), 'utf8');
    expect(destructiveStatements(text)).toMatchObject([{ line: 1, rule: 'DROP INDEX' }]);
  });

  it('a 0060 (índices concorrentes) e as demais migrations de só-acrescentar passam', () => {
    for (const name of ['0060_indices_concorrentes', '0061_pessoas_da_partida', '0063_logo_tema_escuro']) {
      const text = readFileSync(new URL(`../drizzle/${name}.sql`, import.meta.url), 'utf8');
      expect(destructiveStatements(text), name).toEqual([]);
    }
  });
});
