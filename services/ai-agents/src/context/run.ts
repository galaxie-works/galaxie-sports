import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { competition, event, type Database } from '@galaxie/db';
import { AGENT_LOCALES, type AgentLocale } from '../guardrails/index.js';
import type { LlmClient } from '../llm/types.js';
import { loadEventCore, type EventCore } from './event-core.js';
import {
  buildScenarioFacts,
  SCENARIO_PROMPT_VERSION,
  scenarioFactSheet,
  scenarioFallback,
  scenarioStakes,
  scenarioSystemPrompt,
  scenarioUserPrompt,
} from './scenario.js';
import { loadLastFinalBetween } from './history.js';
import { computeEventStakes } from './stakes.js';
import { factsHash, latestFactsHashes, newRunInfo, saveEventContexts, type ContextSource } from './store.js';
import { writeLocalizedTexts, type LocaleText } from './writer.js';

/**
 * Execução do Agente Cenário: escolhe os eventos (próximas horas, tier da competição), calcula
 * stakes, redige (LLM + validador + fallback) e grava em enrich.event_context (kind = scenario).
 */

export interface AgentRunItem {
  eventId: string;
  label: string;
  startsAt: string;
  action: 'generated' | 'planned' | 'skipped' | 'error';
  reason?: string;
  /** Códigos de stakes (cenário) ou placar (resumo). */
  summary?: string;
  origins?: { llm: number; fallback: number };
  llmCalls?: number;
}

export interface AgentRunReport {
  agent: 'scenario' | 'recap';
  items: AgentRunItem[];
  generated: number;
  llmCalls: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

export interface ScenarioRunOptions {
  now?: Date;
  /** Um evento específico (ignora janela e tier). */
  eventId?: string;
  /** Janela à frente, em horas (padrão 72). */
  horizonHours?: number;
  /** Tier máximo da competição (padrão 2: tiers 1 e 2). */
  maxTier?: number;
  locales?: readonly AgentLocale[];
  /** Regenera mesmo se os fatos não mudaram. */
  force?: boolean;
  /** Só mostra o que seria feito (sem LLM e sem gravar). */
  plan?: boolean;
  /** null = sem LLM (texto determinístico). */
  llm: LlmClient | null;
  rulesDir?: string;
  limit?: number;
}

export function emptyReport(agent: AgentRunReport['agent']): AgentRunReport {
  return {
    agent,
    items: [],
    generated: 0,
    llmCalls: 0,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
}

export function eventMatchLabel(core: EventCore): string {
  return `${core.home.name} x ${core.away.name}`;
}

export function countOrigins(texts: readonly LocaleText[]) {
  return {
    llm: texts.filter((t) => t.origin === 'llm').length,
    fallback: texts.filter((t) => t.origin === 'fallback').length,
  };
}

/** IDs dos eventos de futebol agendados na janela, das competições até o tier informado. */
export async function scenarioCandidates(
  db: Database,
  opts: { now: Date; horizonHours: number; maxTier: number; limit: number },
): Promise<string[]> {
  const until = new Date(opts.now.getTime() + opts.horizonHours * 3_600_000);
  const rows = await db
    .select({ id: event.id })
    .from(event)
    .innerJoin(competition, eq(competition.id, event.competitionId))
    .where(
      and(
        eq(event.sport, 'football'),
        inArray(event.status, ['scheduled', 'starting']),
        gte(event.startsAt, opts.now),
        lte(event.startsAt, until),
        lte(competition.tier, opts.maxTier),
      ),
    )
    .orderBy(asc(event.startsAt), asc(event.id))
    .limit(opts.limit);
  return rows.map((r) => r.id);
}

export async function runScenarioAgent(db: Database, opts: ScenarioRunOptions): Promise<AgentRunReport> {
  const now = opts.now ?? new Date();
  const locales = opts.locales ?? AGENT_LOCALES;
  const report = emptyReport('scenario');
  const ids = opts.eventId
    ? [opts.eventId]
    : await scenarioCandidates(db, {
        now,
        horizonHours: opts.horizonHours ?? 72,
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
      label: eventMatchLabel(core),
      startsAt: core.startsAt.toISOString(),
      action: 'skipped',
    };
    report.items.push(item);
    try {
      if (core.status === 'finished' || core.status === 'cancelled') {
        item.reason = `evento ${core.status}`;
        continue;
      }
      const stakes = await computeEventStakes(db, core, {
        titles: true,
        ...(opts.rulesDir ? { rulesDir: opts.rulesDir } : {}),
      });
      if (!stakes.stakes.length) {
        item.reason = stakes.reason ?? 'nenhum stake calculado';
        continue;
      }
      // o texto conta só os salientes (até 3 por time); o resumo do item mostra todos
      const chosen = scenarioStakes(stakes);
      item.summary = stakes.stakes
        .map((s) => `${s.team}:${s.code}${chosen.includes(s) ? '' : ' (não saliente)'}`)
        .join(', ');
      const lastFinal = stakes.knockout?.decidesTitle ? await loadLastFinalBetween(db, core) : null;
      const facts = buildScenarioFacts(core, stakes, locales, { lastFinal });
      const hash = factsHash(facts, SCENARIO_PROMPT_VERSION);
      if (!opts.force) {
        const previous = await latestFactsHashes(db, id, 'scenario');
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
        system: scenarioSystemPrompt(),
        userPrompt: (ls) => scenarioUserPrompt(facts, ls),
        factsFor: (l) => scenarioFactSheet(core, facts, chosen, l),
        fallback: (l) => scenarioFallback(core, facts, chosen, l),
        surface: 'tv',
        minSentences: 1,
        maxSentences: 3,
        llm: opts.llm,
        purpose: `context:scenario:${id}`,
        tier: 'standard',
      });
      const sources: ContextSource[] = [
        { kind: 'core', ref: `core.event:${id}` },
        ...(stakes.rules
          ? [
              { kind: 'rules' as const, ref: `config/rules/${stakes.rules.slug}.yaml` },
              ...stakes.rules.sources.map((url) => ({ kind: 'rules' as const, ref: 'regulamento', url })),
            ]
          : []),
        // títulos anteriores: edições do Wikidata (P1346) gravadas em core.competition_title
        ...(facts.history?.titles ? [{ kind: 'core' as const, ref: 'core.competition_title' }] : []),
      ];
      await saveEventContexts(db, {
        eventId: id,
        kind: 'scenario',
        texts: written.texts,
        factsHash: hash,
        sources,
        run: newRunInfo({
          llmCalls: written.llmCalls,
          usage: written.usage,
          model: written.model,
          errors: written.errors,
        }),
        data: {
          stakes: chosen,
          stakes_all: stakes.stakes,
          knockout: facts.knockout ?? null,
          league: facts.league ?? null,
          history: facts.history ?? null,
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
