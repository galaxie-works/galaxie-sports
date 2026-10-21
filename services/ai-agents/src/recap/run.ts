import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { competition, event, type Database } from '@galaxie/db';
import { AGENT_LOCALES, type AgentLocale } from '../guardrails/index.js';
import type { LlmClient } from '../llm/types.js';
import { loadEventCore } from '../context/event-core.js';
import {
  countOrigins,
  emptyReport,
  matchLabel,
  type AgentRunItem,
  type AgentRunReport,
} from '../context/run.js';
import { factsHash, latestFactsHashes, newRunInfo, saveEventContexts } from '../context/store.js';
import { writeLocalizedTexts } from '../context/writer.js';
import { buildRecapFacts, loadIncidents, loadStatistics } from './facts.js';
import {
  RECAP_PROMPT_VERSION,
  recapFactSheet,
  recapFallback,
  recapSystemPrompt,
  recapUserPrompt,
} from './recap.js';

/**
 * Execução do Agente Resumo: eventos encerrados nas últimas horas (ou um evento no gatilho de FT),
 * redação validada e gravação em enrich.event_context (kind = recap). Regenera quando a timeline
 * ou o placar mudam (correções do provedor).
 */

export interface RecapRunOptions {
  now?: Date;
  eventId?: string;
  /** Janela para trás, em horas, a partir do início do jogo (padrão 36). */
  lookbackHours?: number;
  maxTier?: number;
  locales?: readonly AgentLocale[];
  force?: boolean;
  plan?: boolean;
  llm: LlmClient | null;
  limit?: number;
}

export async function recapCandidates(
  db: Database,
  opts: { now: Date; lookbackHours: number; maxTier: number; limit: number },
): Promise<string[]> {
  const since = new Date(opts.now.getTime() - opts.lookbackHours * 3_600_000);
  const rows = await db
    .select({ id: event.id })
    .from(event)
    .innerJoin(competition, eq(competition.id, event.competitionId))
    .where(
      and(
        eq(event.sport, 'football'),
        eq(event.status, 'finished'),
        gte(event.startsAt, since),
        lte(event.startsAt, opts.now),
        lte(competition.tier, opts.maxTier),
      ),
    )
    .orderBy(desc(event.startsAt), desc(event.id))
    .limit(opts.limit);
  return rows.map((r) => r.id);
}

export async function runRecapAgent(db: Database, opts: RecapRunOptions): Promise<AgentRunReport> {
  const now = opts.now ?? new Date();
  const locales = opts.locales ?? AGENT_LOCALES;
  const report = emptyReport('recap');
  const ids = opts.eventId
    ? [opts.eventId]
    : await recapCandidates(db, {
        now,
        lookbackHours: opts.lookbackHours ?? 36,
        maxTier: opts.maxTier ?? 2,
        limit: opts.limit ?? 200,
      });

  for (const id of ids) {
    const core = await loadEventCore(db, id);
    if (!core) {
      report.items.push({
        eventId: id,
        label: '?',
        startsAt: '',
        action: 'skipped',
        reason: 'evento não encontrado',
      });
      continue;
    }
    const item: AgentRunItem = {
      eventId: id,
      label: matchLabel(core),
      startsAt: core.startsAt.toISOString(),
      action: 'skipped',
    };
    report.items.push(item);
    try {
      if (core.status !== 'finished') {
        item.reason = `evento ainda não encerrado (${core.status})`;
        continue;
      }
      const facts = buildRecapFacts(
        core,
        await loadIncidents(db, id),
        await loadStatistics(db, core),
        locales,
      );
      if (!facts) {
        item.reason = 'evento encerrado sem placar';
        continue;
      }
      item.summary = `${facts.final_score.home}-${facts.final_score.away}`;
      const hash = factsHash(facts, RECAP_PROMPT_VERSION);
      if (!opts.force) {
        const previous = await latestFactsHashes(db, id, 'recap');
        if (locales.every((l) => previous.get(l) === hash)) {
          item.reason = 'fatos inalterados desde a última geração';
          continue;
        }
      }
      if (opts.plan) {
        item.action = 'planned';
        continue;
      }
      const written = await writeLocalizedTexts({
        locales,
        system: recapSystemPrompt(),
        userPrompt: (ls) => recapUserPrompt(facts, ls),
        factsFor: (l) => recapFactSheet(core, facts, l),
        fallback: (l) => recapFallback(core, facts, l),
        surface: 'mobile',
        minSentences: 1,
        maxSentences: 4,
        llm: opts.llm,
        purpose: `context:recap:${id}`,
        tier: 'standard',
      });
      await saveEventContexts(db, {
        eventId: id,
        kind: 'recap',
        texts: written.texts,
        factsHash: hash,
        sources: [
          { kind: 'core', ref: `core.event:${id}` },
          { kind: 'core', ref: `core.event_incident:${id}` },
          ...(facts.statistics ? [{ kind: 'core' as const, ref: `core.football_fixture:${id}` }] : []),
        ],
        run: newRunInfo({
          llmCalls: written.llmCalls,
          usage: written.usage,
          model: written.model,
          errors: written.errors,
        }),
        data: {
          final_score: facts.final_score,
          decided_by: facts.decided_by,
          penalties: facts.penalties,
          goals: facts.goals,
        },
      });
      item.action = 'generated';
      item.origins = countOrigins(written.texts);
      item.llmCalls = written.llmCalls;
      report.generated++;
      report.llmCalls += written.llmCalls;
      report.usage.inputTokens += written.usage.inputTokens;
      report.usage.outputTokens += written.usage.outputTokens;
      report.usage.costUsd += written.usage.costUsd ?? 0;
    } catch (err) {
      item.action = 'error';
      item.reason = err instanceof Error ? err.message : String(err);
    }
  }
  return report;
}

/** Gatilho de FT (para o live poller/orquestrador): gera o resumo assim que o evento encerra. */
export async function onEventFinished(
  db: Database,
  eventId: string,
  llm: LlmClient | null,
  options: Omit<RecapRunOptions, 'eventId' | 'llm'> = {},
): Promise<AgentRunReport> {
  return runRecapAgent(db, { ...options, eventId, llm });
}
