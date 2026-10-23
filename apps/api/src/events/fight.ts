import { eq, inArray, or } from 'drizzle-orm';
import type { EventFight } from '@galaxie/contracts';
import { event, sportEventDetail, type Database } from '@galaxie/db';
import { mmaCardPlacement, mmaFightResult, mmaWeightClass, type MmaMethod } from '@galaxie/providers';
import { pickText } from '../i18n.js';

const METHOD_NAMES: Readonly<Record<Exclude<MmaMethod, 'other'>, Record<string, string>>> = {
  ko: { 'pt-BR': 'Nocaute', es: 'Nocaut', en: 'Knockout' },
  submission: { 'pt-BR': 'Finalização', es: 'Sumisión', en: 'Submission' },
  decision_unanimous: { 'pt-BR': 'Decisão unânime', es: 'Decisión unánime', en: 'Unanimous decision' },
  decision_split: { 'pt-BR': 'Decisão dividida', es: 'Decisión dividida', en: 'Split decision' },
  decision_majority: { 'pt-BR': 'Decisão majoritária', es: 'Decisión mayoritaria', en: 'Majority decision' },
  disqualification: { 'pt-BR': 'Desclassificação', es: 'Descalificación', en: 'Disqualification' },
  draw: { 'pt-BR': 'Empate', es: 'Empate', en: 'Draw' },
  no_contest: { 'pt-BR': 'Sem resultado', es: 'Sin resultado', en: 'No contest' },
};

/** Ordem de exibição no card: luta principal, card principal, preliminares, preliminares iniciais. */
export function fightRank(f: EventFight | null | undefined): number {
  if (!f) return 4;
  if (f.main_event) return 0;
  return f.segment === 'main_card' ? 1 : f.segment === 'prelims' ? 2 : 3;
}

export interface FightSource {
  id: string;
  stageId: string | null;
  /** Nome do card (`core.stage.name`). */
  stageName: Record<string, string> | null;
}

/**
 * Bloco `fight` das lutas de MMA: o segmento sai das lutas irmãs do mesmo card (o espelho de cada uma em
 * `sport_event_detail`), a categoria e o desfecho do espelho da própria luta.
 */
export async function loadFights(
  db: Database,
  sources: FightSource[],
  locale: string,
): Promise<Map<string, EventFight>> {
  const out = new Map<string, EventFight>();
  if (!sources.length) return out;
  const stageIds = [...new Set(sources.map((s) => s.stageId).filter((s): s is string => !!s))];
  const ids = sources.map((s) => s.id);
  const rows = await db
    .select({
      eventId: sportEventDetail.eventId,
      stageId: event.stageId,
      summary: sportEventDetail.summary,
      detail: sportEventDetail.detail,
    })
    .from(sportEventDetail)
    .innerJoin(event, eq(event.id, sportEventDetail.eventId))
    .where(
      stageIds.length ? or(inArray(event.stageId, stageIds), inArray(event.id, ids)) : inArray(event.id, ids),
    );
  const byStage = new Map<string, Record<string, unknown>[]>();
  const byEvent = new Map(rows.map((r) => [r.eventId, r]));
  for (const r of rows) {
    if (!r.stageId) continue;
    byStage.set(r.stageId, [...(byStage.get(r.stageId) ?? []), r.summary as Record<string, unknown>]);
  }
  const placements = new Map<string, ReturnType<typeof mmaCardPlacement>>();
  for (const s of sources) {
    const mirror = byEvent.get(s.id);
    if (!mirror) continue;
    const summary = mirror.summary as Record<string, unknown>;
    const cardName = s.stageName ? (s.stageName.en ?? Object.values(s.stageName)[0] ?? '') : '';
    let placement = s.stageId ? placements.get(s.stageId) : undefined;
    if (!placement) {
      placement = mmaCardPlacement(cardName, s.stageId ? (byStage.get(s.stageId) ?? [summary]) : [summary]);
      if (s.stageId) placements.set(s.stageId, placement);
    }
    const p = placement.get(String(summary.id ?? ''));
    const weight = mmaWeightClass(summary.category);
    const result = mmaFightResult((mirror.detail as { result?: unknown } | null)?.result);
    out.set(s.id, {
      card:
        s.stageId && s.stageName ? { id: s.stageId, name: pickText(s.stageName, locale, cardName)! } : null,
      segment: p?.segment ?? 'main_card',
      main_event: p?.mainEvent ?? false,
      weight_class: weight
        ? { code: weight.code, name: pickText(weight.name as Record<string, string>, locale, weight.code)! }
        : null,
      result: result
        ? {
            method: result.method,
            method_name:
              result.method === 'other'
                ? (result.methodRaw ?? result.method)
                : pickText(METHOD_NAMES[result.method], locale, result.methodRaw ?? '')!,
            detail: result.detail,
            round: result.round,
            time: result.time,
            scorecards: result.scorecards,
          }
        : null,
    });
  }
  return out;
}
