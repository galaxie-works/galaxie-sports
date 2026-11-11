/**
 * Filtro de texto do engajamento (#969) no servidor: monta as listas da Galaxie (base) mais as do cliente, lidas de
 * `engage.moderation_list`, e guarda o resultado por cliente em memória por 60 s. As regras do filtro ficam em
 * `@galaxie/engage` (`screen`); aqui só a leitura e o cache.
 *
 * Mudança de lista na tela de Ajustes chega aos servidores em até 60 s.
 */
import {
  DEFAULT_MODERATION_LISTS,
  compileLists,
  type CompiledLists,
  type ListLocale,
  type ModerationListName,
  type ModerationListSet,
  type TermCategory,
} from '@galaxie/engage';
import { moderationList, type Database } from '@galaxie/db';
import { isNull, or, eq } from 'drizzle-orm';

const TTL_MS = 60_000;
const MAX_ENTRIES = 1000;

interface Row {
  tenantId: string | null;
  list: string;
  locale: string;
  terms: string[];
}

function toSet(rows: Row[]): ModerationListSet {
  const set: ModerationListSet = { terms: {}, allowedDomains: [], betDomains: [], exceptions: [] };
  for (const r of rows) {
    const list = r.list as ModerationListName;
    if (list === 'allowed_domains') set.allowedDomains!.push(...r.terms);
    else if (list === 'bet_domains') set.betDomains!.push(...r.terms);
    else if (list === 'exceptions') set.exceptions!.push(...r.terms);
    else {
      const byLocale = (set.terms[list as TermCategory] ??= {});
      (byLocale[r.locale as ListLocale] ??= []).push(...r.terms);
    }
  }
  return set;
}

/** Listas base + do cliente, com cache curto por cliente. */
export class ModerationLists {
  private readonly cache = new Map<
    string,
    { at: number; lists: Promise<CompiledLists>; good?: CompiledLists }
  >();

  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  forTenant(tenantId: string): Promise<CompiledLists> {
    const hit = this.cache.get(tenantId);
    if (hit && this.now() - hit.at < TTL_MS) return hit.lists;
    const entry: { at: number; lists: Promise<CompiledLists>; good?: CompiledLists } = {
      at: this.now(),
      lists: Promise.resolve(null as never),
    };
    entry.lists = this.load(tenantId).then(
      (lists) => {
        entry.good = lists;
        return lists;
      },
      (err: unknown) => {
        // banco fora: vale a última lista boa; sem ela, a próxima chamada tenta de novo
        if (this.cache.get(tenantId) === entry) {
          if (hit?.good) {
            entry.good = hit.good;
            return hit.good;
          }
          this.cache.delete(tenantId);
        }
        throw err;
      },
    );
    if (!hit && this.cache.size >= MAX_ENTRIES) this.cache.clear();
    this.cache.set(tenantId, entry);
    return entry.lists;
  }

  private async load(tenantId: string): Promise<CompiledLists> {
    const rows = await this.db
      .select({
        tenantId: moderationList.tenantId,
        list: moderationList.list,
        locale: moderationList.locale,
        terms: moderationList.terms,
      })
      .from(moderationList)
      .where(or(isNull(moderationList.tenantId), eq(moderationList.tenantId, tenantId)));
    const base = rows.filter((r) => r.tenantId === null);
    const tenant = rows.filter((r) => r.tenantId !== null);
    // banco sem as listas (migration ainda não rodou): vale a lista inicial, nunca o filtro vazio
    return compileLists(
      base.length ? toSet(base) : DEFAULT_MODERATION_LISTS,
      tenant.length ? toSet(tenant) : null,
    );
  }
}
