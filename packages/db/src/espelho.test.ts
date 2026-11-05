import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema/index.js';

/**
 * A anonimização do espelho produção → dev (infra/ops/mirror-prod-to-dev.sql, #551) cita tabelas e colunas pelo nome,
 * em SQL que só roda no NAS. Estes testes conferem a lista contra o esquema real do Drizzle: tabela que sumiu ou
 * coluna renomeada reprova aqui, no CI, e não na madrugada de segunda. demo_auth (Better Auth, fora das migrations) e
 * espelho_tmp (o rascunho da própria SQL) ficam fora da conferência.
 */
const sqlPath = fileURLToPath(new URL('../../../infra/ops/mirror-prod-to-dev.sql', import.meta.url));
const scriptPath = fileURLToPath(new URL('../../../infra/ops/mirror-prod-to-dev.sh', import.meta.url));
const sql = readFileSync(sqlPath, 'utf8');
const script = readFileSync(scriptPath, 'utf8');

/** `schema.table` → colunas, de todas as tabelas exportadas pelo esquema. */
const tables = new Map<string, Set<string>>();
for (const value of Object.values(schema)) {
  if (!(value instanceof PgTable)) continue;
  const config = getTableConfig(value);
  tables.set(`${config.schema ?? 'public'}.${config.name}`, new Set(config.columns.map((c) => c.name)));
}

const FORA = /^(demo_auth|espelho_tmp|information_schema)\./;
/** Tabelas que a SQL muda (update/delete/truncate) ou lê (from), fora de demo_auth e espelho_tmp. */
function tabelasCitadas(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(
    /\b(?:update|delete from|truncate(?: table)?|from|join)\s+([a-z_]+\.[a-z_]+)/g,
  )) {
    if (!FORA.test(m[1]!)) found.add(m[1]!);
  }
  return [...found].sort();
}

/** Pares (tabela, coluna) de cada `update <tabela> set <coluna>` e `delete from <tabela> where <coluna>`. */
function colunasCitadas(text: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const m of text.matchAll(/\bupdate\s+([a-z_]+\.[a-z_]+)\s+set\s+([a-z_]+)/g))
    pairs.push([m[1]!, m[2]!]);
  for (const m of text.matchAll(/\bdelete from\s+([a-z_]+\.[a-z_]+)\s+where\s+([a-z_]+)/g))
    pairs.push([m[1]!, m[2]!]);
  for (const m of text.matchAll(/\bfrom\s+([a-z_]+\.[a-z_]+)\s+where\s+([a-z_]+)\s/g))
    pairs.push([m[1]!, m[2]!]);
  return pairs.filter(([t]) => !FORA.test(t));
}

describe('anonimização do espelho produção → dev (infra/ops/mirror-prod-to-dev.sql)', () => {
  it('toda tabela citada existe no esquema do Drizzle', () => {
    const citadas = tabelasCitadas(sql);
    expect(citadas.length).toBeGreaterThan(5);
    for (const t of citadas) expect(tables.has(t), `${t} não existe em packages/db/src/schema`).toBe(true);
  });

  it('toda coluna citada existe na tabela', () => {
    const pares = colunasCitadas(sql);
    expect(pares.length).toBeGreaterThan(5);
    for (const [t, c] of pares) expect(tables.get(t)?.has(c), `${t}.${c} não existe`).toBe(true);
  });

  it('o que guarda segredo ou sessão sai inteiro: chaves, webhooks, chaves publicáveis, sobrescritas do painel', () => {
    for (const t of [
      'api.api_key',
      'api.webhook_endpoint',
      'ops.publishable_key',
      'ops.runtime_setting',
      'ops.runtime_env',
    ])
      expect(sql, `delete from ${t} sem where`).toMatch(
        new RegExp(`^delete from ${t.replace('.', '\\.')};$`, 'm'),
      );
    // demo_auth inteiro, menos user e cache_feed_cursor: negar por padrão
    expect(sql).toMatch(/tablename not in \('user', 'cache_feed_cursor'\)/);
    expect(sql).toMatch(/truncate table demo_auth\.%I cascade/);
  });

  it('toda coluna de texto com e-mail de quem fez é anonimizada (ou a tabela sai inteira)', () => {
    // as colunas de autoria do esquema que guardam e-mail do painel (comentário "e-mail" no schema): quem criar
    // outra acrescenta um update na SQL ou a tabela na lista de apagadas
    const autoria: [string, string][] = [
      ['ops.widget', 'created_by'],
      ['ops.job_request', 'requested_by'],
      ['ops.lineup_review_request', 'resolved_by'],
      ['ops.runtime_setting', 'updated_by'],
      ['ops.runtime_setting_log', 'changed_by'],
      ['enrich.logo_upload', 'uploaded_by'],
      ['enrich.logo_upload', 'reverted_by'],
      ['enrich.related_channel_rule', 'updated_by'],
      ['semantic.review_decision', 'decided_by'],
      ['api.tenant_channel_list', 'uploaded_by'],
      ['api.tenant_channel_list', 'confirmed_by'],
    ];
    const apagadas = new Set([...sql.matchAll(/^delete from ([a-z_]+\.[a-z_]+);$/gm)].map((m) => m[1]!));
    for (const [t, c] of autoria) {
      expect(tables.get(t)?.has(c), `${t}.${c} não existe mais: tire da lista`).toBe(true);
      const anonimizada = new RegExp(
        `update ${t.replace('.', '\\.')} set ${c} = 'usuario@exemplo\\.invalid'`,
      ).test(sql);
      expect(anonimizada || apagadas.has(t), `${t}.${c} nem anonimizada nem apagada`).toBe(true);
    }
  });

  it('a conferência do script cobre sessões, chaves, webhooks, sobrescritas e pedidos pendentes', () => {
    const conferencia = script.slice(
      script.indexOf('# espelho:conferencia'),
      script.indexOf('# espelho:contagens'),
    );
    for (const t of tabelasCitadas(conferencia))
      expect(tables.has(t), `${t} na conferência não existe`).toBe(true);
    for (const nome of [
      'sessoes_codigos_e_afins',
      'usuarios_reais',
      'chaves_api_da_producao',
      'chaves_publicaveis_da_producao',
      'webhooks',
      'sobrescritas_do_painel',
      'pedidos_pendentes',
      'backfills_pendentes',
    ])
      expect(conferencia, nome).toContain(`'${nome}'`);
  });

  it('o que o dev preserva na cópia existe no esquema (contas de teste à parte)', () => {
    for (const [schema, table] of [
      ['api', 'tenant'],
      ['api', 'api_key'],
      ['ops', 'publishable_key'],
    ])
      expect(script).toContain(`preserva ${schema} ${table}`);
    for (const [t, cols] of [
      ['api.tenant', ['id', 'slug', 'operator_platform_id']],
      ['api.api_key', ['tenant_id', 'prefix']],
      ['ops.publishable_key', ['tenant_id', 'key_hash', 'widget_id']],
      ['enrich.platform', ['id']],
      ['ops.widget', ['id']],
    ] as [string, string[]][])
      for (const c of cols) expect(tables.get(t)?.has(c), `${t}.${c}`).toBe(true);
  });
});
