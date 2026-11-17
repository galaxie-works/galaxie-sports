import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { competition, event, type Database } from '@galaxie/db';
import { effectiveTiers, tierCondition } from '../common/tiers.js';
import { AGENT_LOCALES, type AgentLocale } from '../guardrails/index.js';
import type { BudgetDay } from '@galaxie/runtime-config';
import type { AiPriority, PriorityResolver } from '../llm/priority.js';
import type { LlmClient } from '../llm/types.js';
import { loadEventCore } from '../context/event-core.js';
import {
  byPriority,
  countWritten,
  emptyReport,
  eventMatchLabel,
  usesLlm,
  type AgentRunItem,
  type AgentRunReport,
} from '../context/run.js';
import {
  localeFactsHashes,
  latestContents,
  latestFactsHashes,
  newRunInfo,
  saveEventContexts,
  withoutBudgetDowngrade,
} from '../context/store.js';
import { writeLocalizedTexts } from '../context/writer.js';
import {
  buildRecapFacts,
  loadIncidents,
  loadRecapKnockout,
  loadRecapLeague,
  loadStatistics,
} from './facts.js';
import {
  DEFAULT_RECAP_INPUT_MAX_AGE_HOURS,
  pruneRecapInputStamps,
  recapInputStates,
  saveRecapInputStamps,
} from './input-stamp.js';
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
 * ou o placar mudam (correções do provedor). Antes de montar os fatos de cada jogo, uma consulta só descarta os jogos
 * cujo insumo não mudou desde a última montagem (`recapInputStates`, input-stamp.ts): sem isso, a cada 5 min os ~100
 * jogos da janela de 36 h refaziam umas 7 consultas e a conta da tabela para descobrir que nada mudou.
 */

export interface RecapRunOptions {
  now?: Date;
  eventId?: string;
  /** Janela para trás, em horas, a partir do início do jogo (padrão 36). */
  lookbackHours?: number;
  maxTier?: number;
  /** Tiers do módulo `ai-content` do painel (MODULES_FOOTBALL); a opção `maxTier` da CLI vale por cima. */
  tiers?: readonly number[];
  locales?: readonly AgentLocale[];
  force?: boolean;
  plan?: boolean;
  llm: LlmClient | null;
  limit?: number;
  /** Prioridade por competição (#357): fila P0 → P1 → resto; só P0 e P1 chamam o LLM. */
  priorityOf?: PriorityResolver;
  /** Virada do dia de orçamento: o determinístico por orçamento só volta a tentar o LLM depois dela. */
  budgetDay?: BudgetDay;
  /** Validade do carimbo do insumo (RECAP_INPUT_MAX_AGE_HOURS, `recapInputMaxAgeMs`; padrão 6 h). */
  inputMaxAgeMs?: number;
}

/** Eventos encerrados na janela, por prioridade (P0 → P1 → resto) e, dentro dela, do mais recente. */
export async function recapCandidates(
  db: Database,
  opts: {
    now: Date;
    lookbackHours: number;
    tiers: readonly number[];
    limit: number;
    priorityOf?: PriorityResolver;
  },
): Promise<{ id: string; priority: AiPriority }[]> {
  const since = new Date(opts.now.getTime() - opts.lookbackHours * 3_600_000);
  const rows = await db
    .select({ id: event.id, startsAt: event.startsAt, sport: competition.sport, slug: competition.slug })
    .from(event)
    .innerJoin(competition, eq(competition.id, event.competitionId))
    .where(
      and(
        eq(event.sport, 'football'),
        eq(event.status, 'finished'),
        gte(event.startsAt, since),
        lte(event.startsAt, opts.now),
        tierCondition(opts.tiers),
      ),
    )
    .orderBy(desc(event.startsAt), desc(event.id));
  return byPriority(rows, opts.priorityOf, opts.limit);
}

export async function runRecapAgent(db: Database, opts: RecapRunOptions): Promise<AgentRunReport> {
  const now = opts.now ?? new Date();
  const locales = opts.locales ?? AGENT_LOCALES;
  const report = emptyReport('recap');
  const queue = opts.eventId
    ? [{ id: opts.eventId, priority: undefined }]
    : await recapCandidates(db, {
        now,
        lookbackHours: opts.lookbackHours ?? 36,
        tiers: effectiveTiers(opts),
        limit: opts.limit ?? 200,
        ...(opts.priorityOf ? { priorityOf: opts.priorityOf } : {}),
      });
  // descarte antes do caminho caro: jogo com o insumo igual ao da última montagem dos fatos sai da fila sem consulta
  // própria (com --forcar, todos passam). Os carimbos novos são gravados de uma vez no fim
  const maxAgeMs = opts.inputMaxAgeMs ?? DEFAULT_RECAP_INPUT_MAX_AGE_HOURS * 3_600_000;
  const inputs = opts.force
    ? new Map<string, { stamp: string; unchanged: boolean }>()
    : await recapInputStates(
        db,
        queue.map((q) => q.id),
        { now, locales, version: RECAP_PROMPT_VERSION, maxAgeMs },
      );
  const stamped: { eventId: string; stamp: string; noFacts?: boolean }[] = [];
  const stamp = (eventId: string, noFacts = false) => {
    const s = inputs.get(eventId);
    if (s && !opts.plan) stamped.push({ eventId, stamp: s.stamp, ...(noFacts ? { noFacts } : {}) });
  };

  for (const { id, priority: queued } of queue) {
    if (inputs.get(id)?.unchanged) {
      report.unchanged = (report.unchanged ?? 0) + 1;
      continue;
    }
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
    const competitionRef = core.competition ? { sport: 'football', slug: core.competition.slug } : null;
    const priority = queued ?? (opts.priorityOf ? opts.priorityOf(competitionRef) : ('p1' as const));
    item.priority = priority;
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
        await loadRecapKnockout(db, core),
        await loadRecapLeague(db, core),
      );
      if (!facts) {
        item.reason = 'evento encerrado sem placar';
        stamp(id, true);
        continue;
      }
      item.summary = `${facts.final_score.home}-${facts.final_score.away}`;
      const hashes = localeFactsHashes(facts, RECAP_PROMPT_VERSION);
      // só os locales cujos fatos mudaram (ou que faltam, como o `en` na chegada do inglês)
      let pending: readonly AgentLocale[] = locales;
      if (!opts.force) {
        const llm = usesLlm(priority) ? opts.llm : null;
        const previous = await latestFactsHashes(db, id, 'recap', {
          now,
          ...(opts.budgetDay ? { budgetDay: opts.budgetDay } : {}),
          // determinístico por orçamento: tenta de novo no mesmo dia se a faixa tiver saldo agora
          ...(llm?.hasRoom ? { hasRoom: (need) => llm.hasRoom!('context', competitionRef, need) } : {}),
        });
        pending = locales.filter((l) => !hashes.isFresh(l, previous.get(l)));
        if (!pending.length) {
          item.reason = 'fatos inalterados desde a última geração';
          stamp(id);
          continue;
        }
      }
      if (opts.plan) {
        item.action = 'planned';
        continue;
      }
      const written = await writeLocalizedTexts({
        locales: pending,
        system: recapSystemPrompt(),
        userPrompt: (ls) => recapUserPrompt(facts, ls),
        factsFor: (l) => recapFactSheet(core, facts, l),
        fallback: (l) => recapFallback(core, facts, l),
        surface: 'mobile',
        minSentences: 1,
        maxSentences: 4,
        // só P0 e P1 chamam o LLM; o resto sai com o texto determinístico
        llm: usesLlm(priority) ? opts.llm : null,
        purpose: `context:recap:${id}`,
        tier: 'standard',
        competition: competitionRef,
      });
      // a recusa do orçamento nunca troca o texto do LLM com os mesmos fatos pelo determinístico
      const texts = written.budgetSkipped
        ? withoutBudgetDowngrade(written.texts, await latestContents(db, id, 'recap'), hashes.isFresh)
        : written.texts;
      if (!texts.length) {
        item.reason = 'orçamento de IA recusou; fica o texto do LLM com os mesmos fatos';
        item.budgetSkipped = true;
        report.budgetSkipped++;
        continue;
      }
      await saveEventContexts(db, {
        eventId: id,
        kind: 'recap',
        texts,
        ...(written.budgetRefusal ? { budgetRefusal: written.budgetRefusal } : {}),
        factsHash: hashes.hashOf,
        sources: [
          { kind: 'core', ref: `core.event:${id}` },
          { kind: 'core', ref: `core.event_incident:${id}` },
          ...(facts.statistics ? [{ kind: 'core' as const, ref: `core.football_fixture:${id}` }] : []),
          // tabela de antes e de depois do jogo, calculadas pelo motor de regras a partir de core.standing
          ...(facts.league ? [{ kind: 'core' as const, ref: 'core.standing' }] : []),
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
          flow: facts.flow ?? null,
          league: facts.league ?? null,
        },
      });
      countWritten(report, item, written);
      stamp(id);
    } catch (err) {
      item.action = 'error';
      item.reason = err instanceof Error ? err.message : String(err);
    }
  }
  await saveRecapInputStamps(db, stamped, now);
  if (!opts.plan && !opts.eventId) await pruneRecapInputStamps(db, now, maxAgeMs);
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
