/**
 * Fila do job `review-suggestions`: as sugestões de edição em aberto. Módulo leve de propósito (só drizzle e o tipo do
 * banco): o scheduler usa `hasPendingSuggestions` antes de subir o job (idleCheck), e a CLI decide se há trabalho
 * antes de importar o modelo e a base semântica.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '@galaxie/db';
import type { SuggestionItem } from './validate.js';

export interface PendingOptions {
  /** Máximo de sugestões nesta execução. */
  max?: number;
  /** Só estes itens. */
  itemIds?: string[];
  /** Reavalia também as sugestões já recusadas pelo agente. */
  reevaluate?: boolean;
}

interface PendingRow {
  id: string;
  kind: SuggestionItem['kind'];
  key: string;
  locale: string | null;
  sport: string;
  market: string | null;
  title: string;
  source_file: string;
  content: Record<string, unknown>;
  original: Record<string, unknown> | null;
  original_locale: string | null;
  parent_kind: 'team' | 'derby' | null;
  review_hash: string;
  suggestion: SuggestionItem['suggestion'];
  decided_by: string | null;
  decided_at: Date | string | null;
  [key: string]: unknown;
}

/** Sugestão em aberto: sobre o conteúdo atual e, sem `reevaluate`, ainda sem veredito do agente. */
const pendingWhere = (opts: PendingOptions): SQL => {
  const ids = opts.itemIds?.length ? opts.itemIds : null;
  return sql`d.suggestion is not null
       and d.review_hash = i.review_hash
       and (${opts.reevaluate ?? false} or d.ai_verdict is null)
       ${ids ? sql`and i.id in ${ids}` : sql``}`;
};

/** Sugestões em aberto (sobre o conteúdo atual), das mais antigas para as mais novas. */
export async function pendingSuggestions(db: Database, opts: PendingOptions = {}): Promise<SuggestionItem[]> {
  const rows = await db.execute<PendingRow>(sql`
    select i.id, i.kind, i.key, i.locale, i.sport, i.market, i.title, i.source_file, i.content,
           i.original, i.original_locale, i.parent_kind, i.review_hash,
           d.suggestion, d.decided_by, d.decided_at
      from semantic.review_decision d
      join semantic.review_item i on i.id = d.item_id
     where ${pendingWhere(opts)}
     order by d.decided_at, i.id
     limit ${opts.max ?? 1000}`);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    key: r.key,
    locale: r.locale,
    sport: r.sport,
    market: r.market,
    title: r.title,
    sourceFile: r.source_file,
    content: r.content,
    original: r.original,
    originalLocale: r.original_locale,
    parentKind: r.parent_kind,
    reviewHash: r.review_hash,
    suggestion: r.suggestion,
    suggestedBy: r.decided_by,
    suggestedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
  }));
}

/** Há sugestão para o job agendado avaliar (o mesmo filtro de `pendingSuggestions`, sem `--reavaliar`)? */
export async function hasPendingSuggestions(db: Database, opts: PendingOptions = {}): Promise<boolean> {
  const rows = await db.execute<{ found: boolean; [key: string]: unknown }>(sql`
    select exists (
      select 1
        from semantic.review_decision d
        join semantic.review_item i on i.id = d.item_id
       where ${pendingWhere(opts)}
    ) as found`);
  return rows[0]?.found === true;
}
