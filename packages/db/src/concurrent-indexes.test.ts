import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { concurrentIndexesOf, isConcurrentMigration, toConcurrent } from './concurrent-indexes.js';

describe('migration de índices concorrentes', () => {
  it('lê nome, schema e tabela de cada índice e ignora os comentários', () => {
    const text = `-- galaxie:concurrently
-- comentário
CREATE INDEX IF NOT EXISTS "a_idx" ON "core"."event" USING btree ("season_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "b_uq" ON "raw"."api_response" USING btree (coalesce("x", "y")) WHERE "raw"."api_response"."k" = 'live';`;
    expect(isConcurrentMigration(text)).toBe(true);
    expect(concurrentIndexesOf(text).map(({ name, schema, table }) => [name, schema, table])).toEqual([
      ['a_idx', 'core', 'event'],
      ['b_uq', 'raw', 'api_response'],
    ]);
  });

  it('recusa outro comando no arquivo marcado (ele é só de índices)', () => {
    expect(() =>
      concurrentIndexesOf(`-- galaxie:concurrently
ALTER TABLE "core"."event" ADD COLUMN "x" int;`),
    ).toThrow('só aceita CREATE');
    // sem IF NOT EXISTS o arquivo falharia depois do CONCURRENTLY
    expect(() => concurrentIndexesOf('CREATE INDEX "a" ON "core"."event" ("x")')).toThrow();
  });

  it('troca para CONCURRENTLY mantendo o resto do comando', () => {
    expect(toConcurrent('CREATE INDEX IF NOT EXISTS "a" ON "core"."event" ("x")')).toBe(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "a" ON "core"."event" ("x")',
    );
    expect(toConcurrent('CREATE UNIQUE INDEX IF NOT EXISTS "a" ON "s"."t" ("x")')).toBe(
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "a" ON "s"."t" ("x")',
    );
  });

  it('a 0060 do repositório é válida (só índices, todos com IF NOT EXISTS)', () => {
    const text = readFileSync(new URL('../drizzle/0060_indices_concorrentes.sql', import.meta.url), 'utf8');
    expect(isConcurrentMigration(text)).toBe(true);
    expect(concurrentIndexesOf(text).map((i) => i.name)).toEqual([
      'api_response_seen_idx',
      'api_response_live_seen_idx',
      'event_season_idx',
      'event_stage_idx',
      'event_incident_participant_idx',
      'event_incident_assist_person_idx',
      'person_season_stat_participant_idx',
      'standing_participant_idx',
    ]);
  });
});
