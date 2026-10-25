/**
 * Agente de revisão de sugestões (job `review-suggestions`, docs/06 §2.1): pega as sugestões de edição
 * em aberto na Revisão semântica, pede ao modelo uma decisão estruturada (aceita, aceita com ajustes,
 * recusa) e passa a resposta pela validação determinística.
 *
 * - Aceita: grava a edição em semantic.review_override (o seed e a API a aplicam por cima do YAML, e o
 *   próximo deploy não a desfaz), aprova o item com o hash do conteúdo editado (autor = provedor do
 *   modelo, `gemini` em produção), publica o conteúdo nas tabelas que a API lê e avisa o
 *   ops.change_feed (a API purga o cache), tudo numa transação.
 * - Recusa (do modelo ou da validação): guarda o veredito na decisão, e o item segue "precisa de
 *   revisão" com o motivo à vista no painel.
 * Cada veredito vai para a auditoria (semantic.review_log). Uma sugestão é avaliada uma vez: o painel
 * apaga o veredito quando o admin registra outra sugestão ou decide o item.
 */
import { sql } from 'drizzle-orm';
import type { Database, ReviewAiVerdict } from '@galaxie/db';
import {
  applyReviewOverrides,
  buildReviewItems,
  canonicalJson,
  mergeOverride,
  publishSemanticContent,
  readReviewOverrides,
  validateKnowledge,
  type KnowledgeBase,
  type ReviewOverrideRef,
} from '@galaxie/knowledge';
import { BudgetExceededError } from '../llm/errors.js';
import type { LlmClient } from '../llm/types.js';
import { contractProblems } from './contract.js';
import { REVIEW_SYSTEM_PROMPT, reviewUserPrompt } from './prompt.js';
import { REVIEW_SUGGESTION_SCHEMA, REVIEW_SUGGESTION_SCHEMA_NAME, type ReviewModelOutput } from './schema.js';
import { finalFields, type SuggestionItem } from './validate.js';

export const reviewPurpose = (itemId: string) => `review:suggestion:${itemId}`;

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

/** Sugestões em aberto (sobre o conteúdo atual), das mais antigas para as mais novas. */
export async function pendingSuggestions(db: Database, opts: PendingOptions = {}): Promise<SuggestionItem[]> {
  const ids = opts.itemIds?.length ? opts.itemIds : null;
  const rows = await db.execute<PendingRow>(sql`
    select i.id, i.kind, i.key, i.locale, i.sport, i.market, i.title, i.source_file, i.content,
           i.original, i.original_locale, i.parent_kind, i.review_hash,
           d.suggestion, d.decided_by, d.decided_at
      from semantic.review_decision d
      join semantic.review_item i on i.id = d.item_id
     where d.suggestion is not null
       and d.review_hash = i.review_hash
       and (${opts.reevaluate ?? false} or d.ai_verdict is null)
       ${ids ? sql`and i.id in ${ids}` : sql``}
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

export type SuggestionOutcomeKind = 'accepted' | 'adjusted' | 'rejected' | 'skipped' | 'failed';

export interface SuggestionOutcome {
  itemId: string;
  title: string;
  kind: SuggestionItem['kind'];
  outcome: SuggestionOutcomeKind;
  reason: string;
  /** Campos finais aplicados (aceita) ou propostos pelo modelo (recusa). */
  fields: Record<string, unknown> | null;
  adjustments: string[];
  /** Problemas da validação determinística (recusa depois do modelo). */
  validation: string[];
  model: string | null;
  costUsd: number | null;
}

export interface SuggestionReviewerOptions {
  db: Database;
  llm: LlmClient;
  /** Base lida do YAML (sem as edições do banco: elas vêm do banco a cada item). */
  knowledge: KnowledgeBase;
  log?: (message: string) => void;
  now?: () => Date;
}

const REASON_MAX = 600;
const issueKey = (i: { code: string; file: string | null; message: string }) =>
  `${i.code}|${i.file}|${i.message}`;

interface Evaluation {
  verdict: ReviewAiVerdict;
  /** Na aceitação: a edição a gravar (null = aprovar o conteúdo atual sem edição; `remove` = a edição volta ao YAML). */
  override: { fields: Record<string, unknown>; base: Record<string, unknown>; remove: boolean } | null;
  reviewHash: string;
}

export class SuggestionReviewer {
  private readonly log: (message: string) => void;
  private readonly now: () => Date;
  private baseline: { key: string; errors: Set<string> } | null = null;

  constructor(private readonly opts: SuggestionReviewerOptions) {
    this.log = opts.log ?? (() => {});
    this.now = opts.now ?? (() => new Date());
  }

  /** Avalia as sugestões em aberto (até `max`). Para no orçamento de tokens esgotado. */
  async run(options: PendingOptions = {}): Promise<SuggestionOutcome[]> {
    const items = await pendingSuggestions(this.opts.db, options);
    const out: SuggestionOutcome[] = [];
    for (const item of items) {
      try {
        out.push(await this.review(item, options.reevaluate ?? false));
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          this.log(`orçamento de tokens esgotado: ${err.message}`);
          break;
        }
        out.push(this.outcome(item, 'failed', err instanceof Error ? err.message : String(err)));
      }
    }
    return out;
  }

  /** Avalia uma sugestão e grava o veredito (e a edição, se aceita). */
  async review(item: SuggestionItem, reevaluate = false): Promise<SuggestionOutcome> {
    const result = await this.opts.llm.generateJson<ReviewModelOutput>({
      tier: 'standard',
      system: REVIEW_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: reviewUserPrompt(item) }],
      schema: REVIEW_SUGGESTION_SCHEMA,
      schemaName: REVIEW_SUGGESTION_SCHEMA_NAME,
      maxOutputTokens: 8_000,
      temperature: 0.1,
      purpose: reviewPurpose(item.id),
    });
    const cost = result.usage.costUsd ?? null;
    const actor = result.provider;
    const evaluation = await this.evaluate(item, result.data, { model: result.model, by: actor });
    const written = await this.write(item, evaluation, actor, reevaluate);
    const v = evaluation.verdict;
    if (!written)
      return { ...this.outcome(item, 'skipped', 'a sugestão mudou durante a avaliação'), costUsd: cost };
    this.log(`${item.id}: ${v.outcome} — ${v.reason}`);
    return {
      itemId: item.id,
      title: item.title,
      kind: item.kind,
      outcome: v.outcome,
      reason: v.reason,
      fields: v.fields,
      adjustments: v.adjustments,
      validation: v.validation,
      model: result.model,
      costUsd: cost,
    };
  }

  /** Decisão do modelo + validação determinística → veredito e edição a gravar. */
  async evaluate(
    item: SuggestionItem,
    output: ReviewModelOutput,
    { model, by }: { model: string; by: string },
  ): Promise<Evaluation> {
    const reason = output.reason.trim().slice(0, REASON_MAX) || '(sem motivo)';
    const at = this.now().toISOString();
    const adjustments = output.adjustments
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 20);
    const reject = (fields: Record<string, unknown> | null, validation: string[] = []): Evaluation => ({
      verdict: {
        outcome: 'rejected',
        reason: validation.length
          ? `Validação automática: ${validation.join('; ')}`.slice(0, REASON_MAX)
          : reason,
        fields,
        adjustments,
        validation,
        by,
        model,
        at,
      },
      override: null,
      reviewHash: item.reviewHash,
    });

    const final = finalFields(item, output);
    if (output.decision === 'reject')
      return reject(final.fields && Object.keys(final.fields).length ? final.fields : null);
    if (!final.ok) return reject(final.fields, final.problems);

    const accepted = (override: Evaluation['override'], reviewHash: string): Evaluation => ({
      verdict: {
        outcome: final.adjusted ? 'adjusted' : 'accepted',
        reason,
        fields: Object.keys(final.fields).length ? final.fields : null,
        adjustments,
        validation: [],
        by,
        model,
        at,
      },
      override,
      reviewHash,
    });
    // aceita sem mudar nada: aprova o conteúdo atual
    if (!Object.keys(final.fields).length) return accepted(null, item.reviewHash);

    const yaml = this.opts.knowledge;
    const overrides = await readReviewOverrides(this.opts.db);
    const previous = overrides.find((o) => o.itemId === item.id) ?? null;
    const merged = mergeOverride(previous, final.fields, item.content);
    const remove = Object.entries(merged.fields).every(
      ([k, v]) => canonicalJson(v ?? null) === canonicalJson(merged.base[k] ?? null),
    );
    const others = overrides.filter((o) => o.itemId !== item.id);
    const candidate: ReviewOverrideRef[] = remove ? others : [...others, { itemId: item.id, ...merged }];

    const current = applyReviewOverrides(yaml, overrides).kb;
    const next = applyReviewOverrides(yaml, candidate);
    const problems: string[] = [];
    // a edição desta sugestão tem de entrar inteira (campo em conflito com o YAML não entraria)
    const conflicted = next.partial.find((p) => p.itemId === item.id)?.fields ?? [];
    if (!remove && (!next.applied.includes(item.id) || conflicted.some((f) => f in final.fields)))
      problems.push('a edição não se encaixa no YAML atual (ele mudou desde a sugestão)');
    const edited = buildReviewItems(next.kb).find((i) => i.id === item.id);
    if (!edited) problems.push('item não encontrado na base com a edição');
    else problems.push(...contractProblems(item.kind, item.content, edited.content, item.parentKind));

    // schema da base semântica: só os erros que a edição cria
    const before = await this.baselineErrors(current, overrides);
    const report = await validateKnowledge(next.kb);
    for (const e of report.errors)
      if (!before.has(issueKey(e))) problems.push(`${e.file ?? 'base'}: ${e.message}`.slice(0, 300));
    if (problems.length || !edited) return reject(final.fields, problems.slice(0, 8));

    return accepted({ ...merged, remove }, edited.reviewHash);
  }

  private async baselineErrors(kb: KnowledgeBase, overrides: ReviewOverrideRef[]): Promise<Set<string>> {
    const key = canonicalJson(overrides);
    if (this.baseline?.key !== key) {
      const report = await validateKnowledge(kb);
      this.baseline = { key, errors: new Set(report.errors.map(issueKey)) };
    }
    return this.baseline.errors;
  }

  /** Grava o veredito numa transação; devolve false se a sugestão mudou enquanto o modelo pensava. */
  private async write(
    item: SuggestionItem,
    e: Evaluation,
    actor: string,
    reevaluate: boolean,
  ): Promise<boolean> {
    const v = e.verdict;
    return this.opts.db.transaction(async (tx) => {
      const [row] = await tx.execute<{
        suggestion: unknown;
        review_hash: string;
        item_hash: string;
        ai_verdict: unknown;
      }>(sql`
        select d.suggestion, d.review_hash, i.review_hash as item_hash, d.ai_verdict
          from semantic.review_item i
          join semantic.review_decision d on d.item_id = i.id
         where i.id = ${item.id}
           for update of i, d`);
      if (
        !row ||
        canonicalJson(row.suggestion) !== canonicalJson(item.suggestion) ||
        row.review_hash !== item.reviewHash ||
        row.item_hash !== item.reviewHash ||
        (!reevaluate && row.ai_verdict && (row.ai_verdict as { outcome?: string }).outcome)
      )
        return false;

      const log = (action: string, toStatus: string, hash: string) =>
        tx.execute(sql`
          insert into semantic.review_log
            (item_id, action, from_status, to_status, review_hash, comment, proposed, actor, actor_id)
          values (${item.id}, ${action}, 'needs_review', ${toStatus}, ${hash},
                  ${[v.reason, ...v.adjustments.map((a) => `• ${a}`)].join('\n')},
                  ${v.fields ? JSON.stringify(v.fields) : null}::jsonb, ${actor}, null)`);

      if (v.outcome === 'rejected') {
        await tx.execute(sql`
          update semantic.review_decision set ai_verdict = ${JSON.stringify(v)}::jsonb where item_id = ${item.id}`);
        await log('ai_reject', 'draft', item.reviewHash);
        return true;
      }

      if (e.override?.remove)
        await tx.execute(sql`delete from semantic.review_override where item_id = ${item.id}`);
      else if (e.override)
        await tx.execute(sql`
          insert into semantic.review_override (item_id, fields, base, review_hash, source, reason, suggestion)
          values (${item.id}, ${JSON.stringify(e.override.fields)}::jsonb, ${JSON.stringify(e.override.base)}::jsonb,
                  ${e.reviewHash}, ${actor}, ${v.reason}, ${JSON.stringify(item.suggestion)}::jsonb)
          on conflict (item_id) do update set fields = excluded.fields, base = excluded.base,
            review_hash = excluded.review_hash, source = excluded.source, reason = excluded.reason,
            suggestion = excluded.suggestion, updated_at = now()`);
      await tx.execute(sql`
        update semantic.review_decision
           set status = 'approved', review_hash = ${e.reviewHash}, suggestion = null, decided_by = ${actor},
               decided_by_id = null, decided_at = now(), ai_verdict = ${JSON.stringify(v)}::jsonb
         where item_id = ${item.id}`);
      await log('ai_approve', 'approved', e.reviewHash);

      // conteúdo e status nas tabelas da API (e o catálogo da revisão com o conteúdo editado)
      const published = await publishSemanticContent(tx, this.opts.knowledge);
      const after = published.items.find((i) => i.id === item.id);
      if (after?.reviewHash !== e.reviewHash)
        throw new Error(`${item.id}: o conteúdo publicado não bate com o avaliado`);
      const entity = await changeEntity(tx, item);
      if (entity)
        await tx.execute(sql`
          select ops.publish_change('semantic.review', ${entity.type}, ${entity.id},
            ${JSON.stringify({ item_id: item.id, review_status: 'approved', edited: !!e.override })}::jsonb)`);
      return true;
    });
  }

  private outcome(item: SuggestionItem, outcome: SuggestionOutcomeKind, reason: string): SuggestionOutcome {
    return {
      itemId: item.id,
      title: item.title,
      kind: item.kind,
      outcome,
      reason,
      fields: null,
      adjustments: [],
      validation: [],
      model: null,
      costUsd: null,
    };
  }
}

type Executor = Pick<Database, 'execute'>;

/** Entidade do change feed de cada tipo de item (as mesmas tags de cache do painel, docs/05 §7). */
async function changeEntity(
  tx: Executor,
  item: SuggestionItem,
): Promise<{ type: string; id: string } | null> {
  const slugAfter = (key: string) => key.slice(key.indexOf(':') + 1);
  const derbyId = async (slug: string) =>
    (await tx.execute<{ id: string }>(sql`select id::text as id from semantic.derby where slug = ${slug}`))[0]
      ?.id;
  switch (item.kind) {
    case 'team':
      return { type: 'team_profile', id: item.key };
    case 'derby': {
      const id = await derbyId(item.key);
      return id ? { type: 'derby', id } : null;
    }
    case 'all-time': {
      const slug = slugAfter(item.key);
      if (!item.key.startsWith('derby:')) return { type: 'head_to_head', id: slug };
      const id = await derbyId(slug);
      return id ? { type: 'derby', id } : null;
    }
    case 'competition':
      return { type: 'competition_profile', id: item.key };
    case 'copy':
      return { type: 'copy_template', id: item.key };
    case 'glossary':
      return { type: 'glossary', id: item.key };
    case 'translation': {
      const slug = slugAfter(item.key);
      if (item.parentKind !== 'derby') return { type: 'team_profile', id: slug };
      const id = await derbyId(slug);
      return id ? { type: 'derby', id } : null;
    }
    case 'editorial':
      // a API lê o perfil do YAML e aplica a edição e a decisão por cima; só falta purgar o cache
      return { type: 'f1_editorial', id: item.key };
  }
}
