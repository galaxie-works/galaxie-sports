/**
 * Listas da base de moderação (#969), só no servidor: a base da Galaxie (Ajustes → Conformidade → Moderação), com
 * versão e histórico, e o filtro montado com elas. As regras do filtro ficam em `@galaxie/engage` (`screen`); aqui a
 * leitura e a gravação, com versão otimista e histórico na mesma transação.
 */
import {
  DOMAIN_LISTS,
  LIST_LOCALES,
  MODERATION_LISTS,
  TERM_CATEGORIES,
  compileLists,
  normalizeDomain,
  normalizeTerm,
  type CompiledLists,
  type ListLocale,
  type ModerationListName,
  type ModerationListSet,
  type TermCategory,
} from '@galaxie/engage';

import { pool } from '@/lib/auth/db';

export interface ModerationListRow {
  id: string;
  list: ModerationListName;
  locale: ListLocale;
  terms: string[];
  version: number;
  updatedBy: string;
  updatedAt: string;
}

export interface ModerationListLogRow {
  list: ModerationListName;
  locale: ListLocale;
  version: number;
  count: number;
  changedBy: string;
  reason: string | null;
  changedAt: string;
}

export class ModerationListError extends Error {
  constructor(readonly code: 'invalid' | 'stale' | 'too_many' | 'reason') {
    super(code);
    this.name = 'ModerationListError';
  }
}

export const MAX_TERMS = 5000;

const isDomainList = (list: ModerationListName) => (DOMAIN_LISTS as readonly string[]).includes(list);

/** Forma canônica, sem repetidos, em ordem alfabética. Domínio inválido e termo vazio saem. */
export function canonicalTerms(list: ModerationListName, terms: string[]): string[] {
  const norm = isDomainList(list) ? normalizeDomain : normalizeTerm;
  const out = new Set<string>();
  for (const raw of terms) {
    const v = norm(String(raw).slice(0, 200));
    if (!v) continue;
    if (isDomainList(list) && !/^([a-z0-9-]+\.)*[a-z0-9-]+$/.test(v)) continue;
    out.add(v);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Listas base da Galaxie, uma linha por lista e idioma. */
export async function listBaseLists(): Promise<ModerationListRow[]> {
  const { rows } = await pool.query<{
    id: string;
    list: ModerationListName;
    locale: ListLocale;
    terms: string[];
    version: number;
    updated_by: string;
    updated_at: Date;
  }>(
    `select id, list, locale, terms, version, updated_by, updated_at from engage.moderation_list
      where tenant_id is null`,
  );
  const order = (l: ModerationListName) => MODERATION_LISTS.indexOf(l);
  return rows
    .map((r) => ({
      id: r.id,
      list: r.list,
      locale: r.locale,
      terms: r.terms,
      version: r.version,
      updatedBy: r.updated_by,
      updatedAt: r.updated_at.toISOString(),
    }))
    .sort(
      (a, b) =>
        order(a.list) - order(b.list) || LIST_LOCALES.indexOf(a.locale) - LIST_LOCALES.indexOf(b.locale),
    );
}

export async function baseListLog(limit = 30): Promise<ModerationListLogRow[]> {
  const { rows } = await pool.query<{
    list: ModerationListName;
    locale: ListLocale;
    version: number;
    count: number;
    changed_by: string;
    reason: string | null;
    created_at: Date;
  }>(
    `select list, locale, version, cardinality(terms) as count, changed_by, reason, created_at
       from engage.moderation_list_log where tenant_id is null
      order by created_at desc, version desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    list: r.list,
    locale: r.locale,
    version: r.version,
    count: Number(r.count),
    changedBy: r.changed_by,
    reason: r.reason,
    changedAt: r.created_at.toISOString(),
  }));
}

/**
 * Grava uma lista base (nova ou nova versão). `expectedVersion` é a versão que a tela abriu (null = lista nova):
 * se outra pessoa gravou antes, recusa com `stale`. O motivo é obrigatório, porque a lista base vale para todos os
 * clientes.
 */
export async function saveBaseList(input: {
  list: string;
  locale: string;
  terms: string[];
  expectedVersion: number | null;
  reason: string | null;
  actor: string;
}): Promise<{ version: number; count: number }> {
  if (!(MODERATION_LISTS as readonly string[]).includes(input.list)) throw new ModerationListError('invalid');
  const list = input.list as ModerationListName;
  if (!(LIST_LOCALES as readonly string[]).includes(input.locale)) throw new ModerationListError('invalid');
  const locale = input.locale as ListLocale;
  if (!(TERM_CATEGORIES as readonly string[]).includes(list) && locale !== 'all')
    throw new ModerationListError('invalid');
  if (!Array.isArray(input.terms) || input.terms.length > MAX_TERMS * 2)
    throw new ModerationListError('too_many');
  const terms = canonicalTerms(list, input.terms);
  if (terms.length > MAX_TERMS) throw new ModerationListError('too_many');
  const reason = input.reason?.trim().slice(0, 500) || null;
  if (!reason) throw new ModerationListError('reason');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ id: string; version: number }>(
      `select id, version from engage.moderation_list
        where tenant_id is null and list = $1 and locale = $2 for update`,
      [list, locale],
    );
    const prev = rows[0] ?? null;
    if ((prev?.version ?? null) !== input.expectedVersion) throw new ModerationListError('stale');
    const version = (prev?.version ?? 0) + 1;
    const { rows: saved } = await client.query<{ id: string }>(
      prev
        ? `update engage.moderation_list set terms = $3::text[], version = $4, updated_by = $5, updated_at = now()
            where id = $6 returning id`
        : `insert into engage.moderation_list (list, locale, terms, version, updated_by)
            values ($1, $2, $3::text[], $4, $5) returning id`,
      prev
        ? [list, locale, terms, version, input.actor, prev.id]
        : [list, locale, terms, version, input.actor],
    );
    await client.query(
      `insert into engage.moderation_list_log (list_id, tenant_id, list, locale, version, terms, changed_by, reason)
       values ($1, null, $2, $3, $4, $5::text[], $6, $7)`,
      [saved[0]!.id, list, locale, version, terms, input.actor, reason],
    );
    await client.query('commit');
    return { version, count: terms.length };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    // duas criações da mesma lista ao mesmo tempo: a segunda bate no índice único
    if ((err as { code?: string }).code === '23505') throw new ModerationListError('stale');
    throw err;
  } finally {
    client.release();
  }
}

/** Monta o conjunto de listas a partir das linhas do banco. */
export function toListSet(
  rows: Array<{ list: ModerationListName; locale: ListLocale; terms: string[] }>,
): ModerationListSet {
  const set: ModerationListSet = { terms: {}, allowedDomains: [], betDomains: [], exceptions: [] };
  for (const r of rows) {
    if (r.list === 'allowed_domains') set.allowedDomains!.push(...r.terms);
    else if (r.list === 'bet_domains') set.betDomains!.push(...r.terms);
    else if (r.list === 'exceptions') set.exceptions!.push(...r.terms);
    else {
      const cat = r.list as TermCategory;
      const byLocale = (set.terms[cat] ??= {});
      (byLocale[r.locale] ??= []).push(...r.terms);
    }
  }
  return set;
}

/** Filtro com a base da Galaxie, para o "testar um texto" da tela. */
export async function compiledBaseLists(): Promise<CompiledLists> {
  return compileLists(toListSet(await listBaseLists()));
}
