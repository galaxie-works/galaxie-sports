/**
 * Leitura e decisões da revisão semântica (só no servidor). Fala direto com o schema `semantic` do
 * mesmo Postgres, como o painel de Operação faz com `ops`: o catálogo `semantic.review_item` vem do
 * seed; as decisões (`semantic.review_decision`) e a auditoria (`semantic.review_log`) são gravadas
 * aqui. Desenho em docs/06 §2.1.
 *
 * Uma decisão vale enquanto o `review_hash` dela for o do conteúdo atual do YAML. Ao decidir, o status
 * também é gravado na hora nas tabelas que a API lê e o `ops.change_feed` recebe a mudança, então a API
 * purga o cache (tags) e passa a servir (ou deixa de servir) o item sem novo deploy.
 */
import { tagsForChange } from '@galaxie/db/change-feed';
import type { PoolClient } from 'pg';

import { pool } from '@/lib/auth/db';

import { findingCounts } from './findings';
import { reviewSummary, type SummaryWords } from './summary';
import {
  PAGE_SIZE,
  REVIEW_STATES,
  STATUS_OF_ACTION,
  type ReviewAction,
  type ReviewAiVerdict,
  type ReviewDetail,
  type ReviewFilters,
  type ReviewKind,
  type ReviewListItem,
  type ReviewListResult,
  type ReviewLogAction,
  type ReviewLogEntry,
  type ReviewOverride,
  type ReviewState,
  type ReviewSuggestion,
  type ServingFloor,
} from './types';

/** Tabelas da revisão ainda não criadas (migration 0025 pendente). */
export class ReviewUnavailableError extends Error {}

/** Erro de entrada de uma ação (o código vira texto no navegador). */
export class ReviewInputError extends Error {
  constructor(readonly code: 'not_found' | 'comment_required' | 'comment_too_long' | 'invalid_fields') {
    super(code);
  }
}

/** Tabela ou coluna ainda não criada (migrations 0025/0030 pendentes). */
const isMissingTable = (err: unknown) => ['42P01', '42703'].includes((err as { code?: string }).code ?? '');

async function query<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    return (await pool.query<T>(sql, params)).rows;
  } catch (err) {
    if (isMissingTable(err)) throw new ReviewUnavailableError(String(err));
    throw err;
  }
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * Itens com a situação efetiva: a decisão do painel quando foi tomada sobre o conteúdo atual (mesmo
 * review_hash); senão o status do YAML. O veredito da IA só vale com a decisão em vigor, e a edição do
 * banco só aparece quando é ela que está no ar (o hash do catálogo é o do conteúdo editado).
 */
const ITEMS = `
  select i.*,
         d.suggestion, d.decided_by, d.decided_at,
         case when d.review_hash = i.review_hash then d.ai_verdict end as ai_verdict,
         (d.item_id is not null and d.review_hash <> i.review_hash) as stale,
         case
           when d.item_id is not null and d.review_hash = i.review_hash
             then case when d.suggestion is not null then 'needs_review' else d.status::text end
           else i.yaml_status::text
         end as state,
         case when o.review_hash = i.review_hash then
           jsonb_build_object('fields', o.fields, 'base', o.base, 'source', o.source, 'reason', o.reason,
                              'at', o.updated_at)
         end as override
    from semantic.review_item i
    left join semantic.review_decision d on d.item_id = i.id
    left join semantic.review_override o on o.item_id = i.id`;

interface ItemRow {
  id: string;
  kind: ReviewKind;
  key: string;
  locale: string | null;
  sport: string;
  market: string | null;
  title: string;
  source_file: string;
  yaml_status: string;
  review_hash: string;
  content: Record<string, unknown>;
  original: Record<string, unknown> | null;
  original_locale: string | null;
  parent_kind: 'team' | 'derby' | null;
  suggestion: ReviewSuggestion | null;
  decided_by: string | null;
  decided_at: Date | null;
  ai_verdict: ReviewAiVerdict | null;
  override: (Omit<ReviewOverride, 'at'> & { at: string }) | null;
  stale: boolean;
  state: ReviewState;
}

/** Motivo da recusa da IA, quando ela recusou a sugestão que segue em aberto. */
const aiRejection = (r: ItemRow) =>
  r.state === 'needs_review' && r.ai_verdict?.outcome === 'rejected' ? r.ai_verdict.reason : null;

const toListItem = (r: ItemRow): ReviewListItem => ({
  id: r.id,
  kind: r.kind,
  key: r.key,
  title: r.title,
  sport: r.sport,
  market: r.market,
  locale: r.locale,
  state: r.state,
  stale: r.stale,
  decidedBy: r.decided_by,
  decidedAt: iso(r.decided_at),
  edited: r.override !== null,
});

/** Condições SQL dos filtros (`withState` = false para as contagens por situação). */
function where(filters: ReviewFilters, withState: boolean) {
  const conds: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    conds.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.kind) add('kind = ?', filters.kind);
  if (filters.sport) add('sport = ?', filters.sport);
  if (filters.market) add('market = ?', filters.market);
  if (filters.locale) add('locale = ?', filters.locale);
  if (withState && filters.state) add('state = ?', filters.state);
  if (filters.q) {
    params.push(`%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    conds.push(`(title ilike $${params.length} or key ilike $${params.length})`);
  }
  return { sql: conds.length ? `where ${conds.join(' and ')}` : '', params };
}

export async function listReviewItems(
  filters: ReviewFilters,
  words: SummaryWords,
): Promise<ReviewListResult> {
  const list = where(filters, true);
  const counted = where(filters, false);
  const offset = (filters.page - 1) * PAGE_SIZE;
  const [rows, total, counts, sports, markets, locales] = await Promise.all([
    query<ItemRow>(
      `with x as (${ITEMS}) select * from x ${list.sql}
        order by case state when 'needs_review' then 0 when 'draft' then 1 when 'reviewed' then 2 else 3 end,
                 kind, sport, market nulls first, title, id
        limit ${PAGE_SIZE} offset ${offset}`,
      list.params,
    ),
    query<{ n: number }>(`with x as (${ITEMS}) select count(*)::int as n from x ${list.sql}`, list.params),
    query<{ state: ReviewState; n: number }>(
      `with x as (${ITEMS}) select state, count(*)::int as n from x ${counted.sql} group by state`,
      counted.params,
    ),
    query<{ v: string }>('select distinct sport as v from semantic.review_item order by 1'),
    query<{ v: string }>(
      'select distinct market as v from semantic.review_item where market is not null order by 1',
    ),
    query<{ v: string }>(
      'select distinct locale as v from semantic.review_item where locale is not null order by 1',
    ),
  ]);
  const byState = Object.fromEntries(REVIEW_STATES.map((s) => [s, 0])) as Record<ReviewState, number>;
  for (const c of counts) byState[c.state] = c.n;
  return {
    items: rows.map((r) => ({
      ...toListItem(r),
      summary: reviewSummary(r.kind, r.content, words),
      openSuggestion: r.state === 'needs_review' ? (r.suggestion?.comment ?? null) : null,
      aiRejection: aiRejection(r),
      findings: findingCounts(r.content),
    })),
    total: total[0]?.n ?? 0,
    counts: byState,
    options: {
      sports: sports.map((r) => r.v),
      markets: markets.map((r) => r.v),
      locales: locales.map((r) => r.v),
    },
  };
}

/** Piso editorial que a API relatou na partida (o mesmo `ops.runtime_env` do painel de Operação). */
export async function readServingFloor(): Promise<ServingFloor> {
  const [row] = await pool
    .query<{ value: string | null; reported_at: Date }>(
      `select value, reported_at from ops.runtime_env
        where service = 'api' and key = 'SEMANTIC_MIN_REVIEW_STATUS'`,
    )
    .then((r) => r.rows)
    .catch(() => []);
  const floor =
    row?.value === 'draft' || row?.value === 'reviewed' || row?.value === 'approved' ? row.value : null;
  return { floor, reportedAt: floor ? iso(row!.reported_at) : null };
}

export async function getReviewItem(id: string): Promise<ReviewDetail | null> {
  const [row] = await query<ItemRow>(`with x as (${ITEMS}) select * from x where id = $1`, [id]);
  if (!row) return null;
  const log = await query<{
    id: string;
    action: ReviewLogAction;
    from_status: string | null;
    to_status: string;
    comment: string | null;
    proposed: Record<string, unknown> | null;
    actor: string;
    created_at: Date;
  }>(
    `select id::text, action, from_status, to_status::text, comment, proposed, actor, created_at
       from semantic.review_log where item_id = $1 order by created_at desc limit 50`,
    [id],
  );
  return {
    ...toListItem(row),
    sourceFile: row.source_file,
    yamlStatus: row.yaml_status,
    content: row.content,
    original: row.original,
    originalLocale: row.original_locale,
    parentKind: row.parent_kind,
    // sugestão de uma decisão desatualizada não vale mais (o conteúdo mudou)
    suggestion: row.state === 'needs_review' ? row.suggestion : null,
    aiVerdict: row.ai_verdict,
    override: row.override ? { ...row.override, at: iso(row.override.at)! } : null,
    log: log.map<ReviewLogEntry>((l) => ({
      id: l.id,
      action: l.action,
      fromStatus: l.from_status,
      toStatus: l.to_status,
      comment: l.comment,
      proposed: l.proposed,
      actor: l.actor,
      createdAt: iso(l.created_at)!,
    })),
  };
}

export interface DecideInput {
  itemId: string;
  action: ReviewAction;
  comment?: string | null;
  /** Edição proposta, campo a campo (só na sugestão). */
  fields?: Record<string, unknown> | null;
  actor: { id: string; email: string };
}

export interface DecideResult {
  state: ReviewState;
  /** A situação já era essa: nada foi gravado. */
  unchanged: boolean;
  /**
   * Tags de cache da mudança publicada no change feed (as que a API purga): a rota revalida o cache da
   * demo com elas na hora, sem esperar o seguidor do change feed.
   */
  tags: string[];
}

const COMMENT_MAX = 2000;
const FIELDS_MAX = 20_000;

/** Valida comentário e edição proposta contra os campos do item. */
export function checkSuggestion(
  input: Pick<DecideInput, 'action' | 'comment' | 'fields'>,
  content: Record<string, unknown>,
): ReviewSuggestion | null {
  const comment = input.comment?.trim() ?? '';
  if (comment.length > COMMENT_MAX) throw new ReviewInputError('comment_too_long');
  if (input.action !== 'suggest') return null;
  if (!comment) throw new ReviewInputError('comment_required');
  const fields = input.fields ?? null;
  if (fields !== null) {
    if (typeof fields !== 'object' || Array.isArray(fields)) throw new ReviewInputError('invalid_fields');
    const unknown = Object.keys(fields).filter((k) => !(k in content));
    if (unknown.length || JSON.stringify(fields).length > FIELDS_MAX)
      throw new ReviewInputError('invalid_fields');
  }
  return { comment, fields: fields && Object.keys(fields).length ? fields : null };
}

/** Tabela servida pela API e tags de cache de cada tipo (convenções de tag em docs/05 §7). */
async function applyLive(
  client: PoolClient,
  row: ItemRow,
  status: 'approved' | 'draft',
): Promise<{ entityType: string; entityId: string } | null> {
  const one = async (sql: string, params: unknown[]) =>
    (await client.query<{ k: string }>(sql, params)).rows[0];
  switch (row.kind) {
    case 'team':
      await one(
        `update semantic.team_profile set review_status = $2, updated_at = now() where slug = $1 returning slug as k`,
        [row.key, status],
      );
      return { entityType: 'team_profile', entityId: row.key };
    case 'derby': {
      const d = await one(
        `update semantic.derby set review_status = $2, updated_at = now() where slug = $1 returning id::text as k`,
        [row.key, status],
      );
      return d ? { entityType: 'derby', entityId: d.k } : null;
    }
    case 'all-time': {
      // histórico geral: `derby:<slug>` fica no clássico; `pair:<slug>`, na lista de confrontos
      const [owner, slug] = [row.key.slice(0, row.key.indexOf(':')), row.key.slice(row.key.indexOf(':') + 1)];
      if (owner === 'derby') {
        const d = await one(
          `update semantic.derby set all_time = jsonb_set(all_time, '{review_status}', to_jsonb($2::text)),
                updated_at = now()
            where slug = $1 and all_time is not null returning id::text as k`,
          [slug, status],
        );
        return d ? { entityType: 'derby', entityId: d.k } : null;
      }
      await one(
        `update semantic.head_to_head
            set review_status = $2::text::semantic.review_status,
                all_time = jsonb_set(all_time, '{review_status}', to_jsonb($2::text)),
                updated_at = now()
          where slug = $1 returning slug as k`,
        [slug, status],
      );
      return { entityType: 'head_to_head', entityId: slug };
    }
    case 'competition':
      await one(
        `update semantic.competition_profile set review_status = $2, updated_at = now()
          where slug = $1 returning slug as k`,
        [row.key, status],
      );
      return { entityType: 'competition_profile', entityId: row.key };
    case 'copy':
      await one(
        `update semantic.copy_template set review_status = $2, updated_at = now() where key = $1 returning key as k`,
        [row.key, status],
      );
      return { entityType: 'copy_template', entityId: row.key };
    case 'glossary':
      // a API lê o glossário do YAML e aplica as decisões por cima; só falta purgar o cache
      return { entityType: 'glossary', entityId: row.key };
    case 'editorial':
      // o perfil editorial da F1 também é lido do YAML pela API (tag `f1_editorial`)
      return { entityType: 'f1_editorial', entityId: row.key };
    case 'translation': {
      const slug = row.key.slice(row.key.indexOf(':') + 1);
      const table = row.parent_kind === 'derby' ? 'semantic.derby' : 'semantic.team_profile';
      const t = await one(
        `update ${table}
            set texts = jsonb_set(texts, array[$2::text, 'review_status'], to_jsonb($3::text)), updated_at = now()
          where slug = $1 and texts ? $2
          returning ${row.parent_kind === 'derby' ? 'id::text' : 'slug'} as k`,
        [slug, row.locale, status],
      );
      if (!t) return null;
      return row.parent_kind === 'derby'
        ? { entityType: 'derby', entityId: t.k }
        : { entityType: 'team_profile', entityId: t.k };
    }
  }
}

/**
 * Aprova, volta para rascunho ou registra uma sugestão de edição, numa transação: decisão vigente,
 * linha de auditoria, status nas tabelas da API e aviso no change feed (purga do cache).
 */
export async function decideReview(input: DecideInput): Promise<DecideResult> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    // trava o item: duas decisões ao mesmo tempo sobre ele saem uma depois da outra
    await client.query('select 1 from semantic.review_item where id = $1 for update', [input.itemId]);
    const { rows } = await client.query<ItemRow>(`with x as (${ITEMS}) select * from x where id = $1`, [
      input.itemId,
    ]);
    const row = rows[0];
    if (!row) throw new ReviewInputError('not_found');
    const suggestion = checkSuggestion(input, row.content);
    const status = STATUS_OF_ACTION[input.action];
    const state: ReviewState = input.action === 'suggest' ? 'needs_review' : status;
    if (state === row.state && input.action !== 'suggest') {
      await client.query('rollback');
      return { state, unchanged: true, tags: [] };
    }

    await client.query(
      // decisão nova: o veredito da IA sobre a anterior não vale mais (uma sugestão nova é reavaliada)
      `insert into semantic.review_decision (item_id, status, review_hash, suggestion, decided_by, decided_by_id, decided_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (item_id) do update set status = excluded.status, review_hash = excluded.review_hash,
         suggestion = excluded.suggestion, decided_by = excluded.decided_by,
         decided_by_id = excluded.decided_by_id, decided_at = now(), ai_verdict = null`,
      [row.id, status, row.review_hash, suggestion, input.actor.email, input.actor.id],
    );
    await client.query(
      `insert into semantic.review_log
         (item_id, action, from_status, to_status, review_hash, comment, proposed, actor, actor_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.id,
        input.action,
        row.state,
        status,
        row.review_hash,
        suggestion?.comment ?? (input.comment?.trim() || null),
        suggestion?.fields ?? null,
        input.actor.email,
        input.actor.id,
      ],
    );
    const entity = await applyLive(client, row, status);
    const payload = { item_id: row.id, review_status: status };
    if (entity)
      await client.query('select ops.publish_change($1, $2, $3, $4::jsonb)', [
        'semantic.review',
        entity.entityType,
        entity.entityId,
        JSON.stringify(payload),
      ]);
    await client.query('commit');
    return { state, unchanged: false, tags: entity ? tagsForChange({ ...entity, payload }) : [] };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    if (isMissingTable(err)) throw new ReviewUnavailableError(String(err));
    throw err;
  } finally {
    client.release();
  }
}
