import type { KnowledgeBase, LocatedCopyTemplate } from '../load.js';
import type { CopyTemplate } from './select-copy.js';

/** Converte um item de data/knowledge/copy/<locale>.yaml para o formato usado por selectCopy. */
export function toCopyTemplate(t: LocatedCopyTemplate): CopyTemplate {
  const e = t.entry;
  return {
    key: `${t.locale}.${e.key}`,
    locale: t.locale,
    sport: t.sport,
    intent: e.intent,
    tone: e.tone,
    template: e.template,
    affinityType: e.affinity_type ?? null,
    affinitySource: e.affinity_source ?? null,
    momentum: e.momentum ?? null,
    competitionContext: e.competition_context ?? null,
    confidence: e.confidence,
    reviewStatus: e.review_status,
  };
}

/** Todos os templates de copy da base carregada. */
export function copyTemplatesFromKnowledge(kb: KnowledgeBase): CopyTemplate[] {
  return kb.copyTemplates.map(toCopyTemplate);
}
